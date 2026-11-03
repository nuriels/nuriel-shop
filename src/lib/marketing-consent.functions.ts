import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CONFIRM_TOKEN_FORMAT, UUID_FORMAT } from "@/lib/marketing-consent";

/**
 * חלק 40: דיוור — פעולות מהדפדפן.
 *  - unsubscribeMarketing: הסרה מקישור במייל (בלי התחברות — הטוקן הוא ההוכחה)
 *  - myMarketingConsent / setMyMarketingConsent: הלקוח המחובר רואה ומשנה את
 *    ההסכמה שלו ב"החשבון שלי"
 *  - confirmMarketing: הלחיצה על קישור האישור במייל (SEC-H5 — אישור כפול). רק אז ההצטרפות
 *    בתוקף, ונשלחים "ברוכים הבאים" / הקופון שביקשו.
 *  - requestCheckoutMarketingConsent: אישור דיוור בקופה — רק אחרי שההזמנה נשלחה (לא בהקלדה)
 */

const UUID_LOWER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const unsubscribeMarketing = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => {
    const token = String(input?.token ?? "").trim();
    if (!UUID_FORMAT.test(token)) throw new Error("הקישור לא תקין");
    return { token };
  })
  .handler(async ({ data }) => {
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    const ip = await requestIp();
    if (!allowAction(`unsubscribe:${ip}`, 30, 10 * 60 * 1000)) {
      throw new Error("יותר מדי בקשות — נסו שוב בעוד כמה דקות");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: email, error } = await supabaseAdmin.rpc("marketing_unsubscribe", {
      _token: data.token,
    });
    if (error) throw new Error("ההסרה נכשלה — נסו שוב");
    return { removed: typeof email === "string" && email !== "" };
  });

async function myEmail(context: { userId: string; claims: unknown }): Promise<string | null> {
  const claims = (context.claims ?? {}) as { email?: unknown };
  if (typeof claims.email === "string" && claims.email.includes("@")) {
    return claims.email.trim().toLowerCase();
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("email")
    .eq("user_id", context.userId)
    .maybeSingle();
  return data?.email?.trim().toLowerCase() || null;
}

export const myMarketingConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = await myEmail(context);
    if (!email) return { email: null, subscribed: false };
    const { marketingSendToken } = await import("@/lib/marketing-consent.server");
    return { email, subscribed: (await marketingSendToken(email)) !== null };
  });

export const setMyMarketingConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { subscribed: boolean }) => ({ subscribed: input?.subscribed === true }))
  .handler(async ({ data, context }) => {
    const { allowAction } = await import("@/lib/rate-limit.server");
    if (!allowAction(`consent:${context.userId}`, 20, 60 * 60 * 1000)) {
      throw new Error("יותר מדי שינויים — נסו שוב מאוחר יותר");
    }
    const email = await myEmail(context);
    if (!email) throw new Error("לא נמצא אימייל לחשבון");
    const { recordMarketingConsent } = await import("@/lib/marketing-consent.server");
    const result = await recordMarketingConsent({
      email,
      subscribed: data.subscribed,
      source: "account",
      userId: context.userId,
      method: "account",
    });
    if (!result) throw new Error("השמירה נכשלה — נסו שוב");
    // SEC-H5: הצטרפות ממתינה לאישור במייל — עד אז לא מנוי
    if (data.subscribed && !result.subscribed && !result.pending) {
      throw new Error("שליחת מייל האישור נכשלה — נסו שוב בעוד רגע");
    }
    return { subscribed: result.subscribed, pending: result.pending, email };
  });

/** הלחיצה על קישור האישור במייל — בלי התחברות (האסימון החד-פעמי הוא ההוכחה) */
export const confirmMarketing = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => {
    const token = String(input?.token ?? "")
      .trim()
      .toLowerCase();
    if (!CONFIRM_TOKEN_FORMAT.test(token)) throw new Error("הקישור לא תקין");
    return { token };
  })
  .handler(async ({ data }) => {
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    if (!allowAction(`marketing-confirm:${await requestIp()}`, 30, 10 * 60 * 1000)) {
      throw new Error("יותר מדי בקשות — נסו שוב בעוד כמה דקות");
    }
    const { confirmMarketingConsent } = await import("@/lib/marketing-consent.server");
    return confirmMarketingConsent(data.token);
  });

/**
 * אישור דיוור בקופה (SEC-H5): נרשם רק אחרי שההזמנה נשלחה — לא בזמן ההקלדה — ורק לכתובת של
 * ההזמנה עצמה (לא לכתובת שהדפדפן שולח). שולח מייל אישור אחד; עד הלחיצה לא נשלח דיוור.
 */
export const requestCheckoutMarketingConsent = createServerFn({ method: "POST" })
  .inputValidator((input: { orderId: string }) => {
    const orderId = String(input?.orderId ?? "")
      .trim()
      .toLowerCase();
    if (!UUID_LOWER.test(orderId)) throw new Error("הזמנה לא תקינה");
    return { orderId };
  })
  .handler(async ({ data }) => {
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    if (
      !allowAction(`checkout-consent-ip:${await requestIp()}`, 20, 60 * 60 * 1000) ||
      !allowAction(`checkout-consent:${data.orderId}`, 1, 60 * 60 * 1000)
    ) {
      return { pending: false };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("id, customer_email, customer_id, created_at")
      .eq("id", data.orderId)
      .maybeSingle();
    // הזמנה של החנות הזו, שנוצרה עכשיו (לא קישור ישן שמנסים לנצל)
    if (!order || Date.now() - Date.parse(order.created_at) > 30 * 60 * 1000) {
      return { pending: false };
    }
    let email = order.customer_email?.trim().toLowerCase() || "";
    if (!email && order.customer_id) {
      const { data: account } = await supabaseAdmin.auth.admin.getUserById(order.customer_id);
      email = account?.user?.email?.trim().toLowerCase() ?? "";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { pending: false };

    const { recordMarketingConsent } = await import("@/lib/marketing-consent.server");
    const result = await recordMarketingConsent({
      email,
      subscribed: true,
      source: "checkout",
      userId: order.customer_id ?? null,
      method: "checkout",
    });
    return { pending: result?.pending === true, subscribed: result?.subscribed === true };
  });
