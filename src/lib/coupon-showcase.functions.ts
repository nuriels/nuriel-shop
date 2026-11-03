import { createServerFn } from "@tanstack/react-start";
import { normalizeCouponCode } from "@/lib/coupons";
import type { CouponShowcase } from "@/lib/coupon-showcase.server";

/**
 * קופון "להצגה" (פס ההודעות והחלון הקופץ) + שליחתו במייל.
 * מוצג רק קופון שעובד לכל מבקר: פעיל, בתוקף, לא נוצל עד הסוף, וזמין לכולם
 * (קופון לרשומים בלבד / לאורחים בלבד לא מוצג — אנחנו לא יודעים מי המבקר).
 * הטעינה והשליחה — ב-coupon-showcase.server.ts (שרת בלבד).
 */

export type { CouponShowcase };

async function loadShowcase(rawCode: string | null): Promise<CouponShowcase | null> {
  const { loadShowcase: load } = await import("@/lib/coupon-showcase.server");
  return load(rawCode);
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
 * SEC-H5 (אישור כפול): כתובת שעוד לא אישרה דיוור מקבלת קודם מייל אישור אחד (לא פרסומת);
 * הקופון נשלח רק אחרי הלחיצה על הקישור (/marketing/confirm). כך אי אפשר "לרשום" כתובת זרה.
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

    const mailing = await import("@/lib/marketing-consent.server");
    const { deliverShowcaseCoupon } = await import("@/lib/coupon-showcase.server");

    // כבר מנוי שאישר דיוור — הקופון נשלח מיד
    const token = await mailing.marketingSendToken(data.email);
    if (token) {
      const delivery = await deliverShowcaseCoupon(data.email, coupon.code, token);
      if (delivery === "sent") return { ok: true, message: "שלחנו לכם את הקופון למייל 🎁" };
      if (delivery === "already_sent") {
        return { ok: true, message: "הקופון כבר נשלח לכתובת הזו — בדקו את תיבת הדואר (וגם ספאם)" };
      }
      if (delivery === "unavailable") return { ok: false, message: "הקופון כבר לא זמין" };
      return { ok: false, message: "השליחה נכשלה — נסו שוב בעוד רגע" };
    }

    // עוד לא אישר — מייל אישור אחד; הקופון נשלח אחרי הלחיצה. מקור "account" = "הטבות וקופונים"
    const consent = await mailing.recordMarketingConsent({
      email: data.email,
      subscribed: true,
      source: "account",
      method: "popup",
      context: { coupon: coupon.code },
    });
    if (!consent) return { ok: false, message: "לא הצלחנו לרשום את הבקשה — נסו שוב" };
    if (consent.throttled) {
      return {
        ok: true,
        message: "כבר שלחנו לכתובת הזו מייל לאישור — בדקו את תיבת הדואר (וגם ספאם)",
      };
    }
    if (!consent.confirmSent) {
      return { ok: false, message: "השליחה נכשלה — נסו שוב בעוד רגע" };
    }
    return {
      ok: true,
      message: "שלחנו לכם מייל לאישור ההרשמה — אחרי הלחיצה על הקישור הקופון יגיע למייל 🎁",
    };
  });
