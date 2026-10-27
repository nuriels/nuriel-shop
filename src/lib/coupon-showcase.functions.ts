import { createServerFn } from "@tanstack/react-start";
import { couponLabel, normalizeCouponCode, type CouponType } from "@/lib/coupons";

/**
 * קופון "להצגה" (פס ההודעות והחלון הקופץ) + שליחתו במייל.
 * מוצג רק קופון שעובד לכל מבקר: פעיל, בתוקף, לא נוצל עד הסוף, וזמין לכולם
 * (קופון לרשומים בלבד / לאורחים בלבד לא מוצג — אנחנו לא יודעים מי המבקר).
 */

export type CouponShowcase = {
  code: string;
  label: string;
  /** "בהזמנה מעל ₪500 · בתוקף עד 1.1.2027" — או ריק */
  conditions: string;
};

async function loadShowcase(rawCode: string | null): Promise<CouponShowcase | null> {
  const code = normalizeCouponCode(rawCode ?? "");
  if (code.length < 3 || code.length > 32) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: c } = await supabaseAdmin
    .from("coupons")
    .select(
      "id, code, discount_type, discount_value, is_active, starts_at, expires_at, min_order_total, max_uses, audience",
    )
    .eq("code", code)
    .maybeSingle();
  if (!c || !c.is_active || c.audience !== "all") return null;
  const now = Date.now();
  if (c.starts_at && Date.parse(c.starts_at) > now) return null;
  if (c.expires_at && Date.parse(c.expires_at) <= now) return null;
  if (c.max_uses !== null) {
    const { count } = await supabaseAdmin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("coupon_id", c.id)
      .neq("status", "cancelled");
    if ((count ?? 0) >= c.max_uses) return null;
  }
  const type: CouponType = (["percent", "fixed", "free_shipping"] as const).includes(
    c.discount_type as CouponType,
  )
    ? (c.discount_type as CouponType)
    : "percent";
  const conditions = [
    c.min_order_total ? `בהזמנה מעל ₪${Number(c.min_order_total).toFixed(0)}` : "",
    c.expires_at
      ? `בתוקף עד ${new Date(c.expires_at).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" })}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return { code: c.code, label: couponLabel(type, Number(c.discount_value)), conditions };
}

export const getCouponShowcase = createServerFn({ method: "GET" })
  .inputValidator((input: { code: string | null }) => ({
    code: typeof input?.code === "string" ? input.code : null,
  }))
  .handler(async ({ data }): Promise<CouponShowcase | null> => {
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    if (!allowAction(`showcase:${await requestIp()}`, 120, 10 * 60 * 1000)) return null;
    return loadShowcase(data.code);
  });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EmailCouponResult = { ok: boolean; message: string };

/**
 * "שלחו לי במייל": הקופון נשלח פעם אחת לכל כתובת (coupon_email_claim — גם
 * ברענון, ניסיון חוזר או לחיצה כפולה), רק אחרי הסכמה מפורשת לדיוור, דרך
 * מנגנון המייל הקיים. כשל בשליחה משחרר את התפיסה — אפשר לנסות שוב.
 */
export const emailCouponToMe = createServerFn({ method: "POST" })
  .inputValidator((input: { code: string; email: string; consent: boolean }) => ({
    code: normalizeCouponCode(input?.code ?? ""),
    email: String(input?.email ?? "")
      .trim()
      .toLowerCase()
      .slice(0, 254),
    consent: input?.consent === true,
  }))
  .handler(async ({ data }): Promise<EmailCouponResult> => {
    if (!EMAIL.test(data.email)) return { ok: false, message: "כתובת האימייל לא תקינה" };
    if (!data.consent) {
      return { ok: false, message: "כדי לקבל את הקופון במייל יש לאשר קבלת דיוור" };
    }
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    const ip = await requestIp();
    if (
      !allowAction(`coupon-mail-ip:${ip}`, 10, 60 * 60 * 1000) ||
      !allowAction(`coupon-mail:${data.email}`, 3, 60 * 60 * 1000)
    ) {
      return { ok: false, message: "יותר מדי בקשות — נסו שוב מאוחר יותר" };
    }
    const coupon = await loadShowcase(data.code);
    if (!coupon) return { ok: false, message: "הקופון כבר לא זמין" };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const mailing = await import("@/lib/marketing-consent.server");

    // רישום ההסכמה (עם הנוסח) — מקור "account" = "הטבות וקופונים"
    const consent = await mailing.recordMarketingConsent({
      email: data.email,
      subscribed: true,
      source: "account",
    });
    const token = consent?.subscribed ? await mailing.marketingSendToken(data.email) : null;
    if (!token) return { ok: false, message: "לא הצלחנו לרשום את ההסכמה — נסו שוב" };

    const { data: claimed } = await supabaseAdmin.rpc("coupon_email_claim", {
      _email: data.email,
      _code: coupon.code,
    });
    if (claimed !== true) {
      return { ok: true, message: "הקופון כבר נשלח לכתובת הזו — בדקו את תיבת הדואר (וגם ספאם)" };
    }
    try {
      const sent = await mailing.sendCouponEmail(data.email, coupon, token);
      if (!sent) throw new Error("send failed");
    } catch (error) {
      await supabaseAdmin.rpc("coupon_email_release", { _email: data.email, _code: coupon.code });
      console.error("[coupon-email] failed", error);
      return { ok: false, message: "השליחה נכשלה — נסו שוב בעוד רגע" };
    }
    return { ok: true, message: "שלחנו לכם את הקופון למייל 🎁" };
  });
