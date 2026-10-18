import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { UUID_FORMAT } from "@/lib/marketing-consent";

/**
 * חלק 40: דיוור — פעולות מהדפדפן.
 *  - unsubscribeMarketing: הסרה מקישור במייל (בלי התחברות — הטוקן הוא ההוכחה)
 *  - myMarketingConsent / setMyMarketingConsent: הלקוח המחובר רואה ומשנה את
 *    ההסכמה שלו ב"החשבון שלי" (הצטרפות ראשונה → קופון ברוכים הבאים, אם הוגדר)
 */

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
    });
    if (!result) throw new Error("השמירה נכשלה — נסו שוב");
    return { subscribed: result.subscribed };
  });
