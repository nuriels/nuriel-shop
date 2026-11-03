/**
 * קופון "להצגה" (פס ההודעות והחלון הקופץ) — צד שרת בלבד.
 *  - loadShowcase: הקופון אם הוא עובד לכל מבקר (פעיל, בתוקף, לא נוצל עד הסוף, לכולם).
 *  - deliverShowcaseCoupon: שליחת הקופון במייל לכתובת שכבר אישרה דיוור (SEC-H5) — פעם אחת
 *    לכל כתובת (coupon_email_claim), שחרור אם השליחה נכשלה.
 * רק בתוך בקשה של חנות (supabaseAdmin מוגבל לחנות של הבקשה).
 */
import { couponLabel, normalizeCouponCode, type CouponType } from "@/lib/coupons";

export type CouponShowcase = {
  code: string;
  label: string;
  /** "בהזמנה מעל ₪500 · בתוקף עד 1.1.2027" — או ריק */
  conditions: string;
};

export async function loadShowcase(rawCode: string | null): Promise<CouponShowcase | null> {
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

export type CouponDelivery = "sent" | "already_sent" | "unavailable" | "failed";

/**
 * שליחת הקופון לכתובת שכבר מנויה (יש לה טוקן הסרה — כלומר אישרה דיוור). פעם אחת לכל כתובת;
 * כשל בשליחה משחרר את התפיסה, כך שאפשר לנסות שוב.
 */
export async function deliverShowcaseCoupon(
  email: string,
  rawCode: string,
  unsubscribeToken: string,
): Promise<CouponDelivery> {
  const coupon = await loadShowcase(rawCode);
  if (!coupon) return "unavailable";
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: claimed } = await supabaseAdmin.rpc("coupon_email_claim", {
    _email: email,
    _code: coupon.code,
  });
  if (claimed !== true) return "already_sent";
  try {
    const { sendCouponEmail } = await import("@/lib/marketing-consent.server");
    const sent = await sendCouponEmail(email, coupon, unsubscribeToken);
    if (!sent) throw new Error("send failed");
    return "sent";
  } catch (error) {
    await supabaseAdmin.rpc("coupon_email_release", { _email: email, _code: coupon.code });
    console.error("[coupon-email] failed", error);
    return "failed";
  }
}
