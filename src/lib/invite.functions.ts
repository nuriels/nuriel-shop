import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * יצירת הזמנה ללקוח חדש (מנהל או סוכן).
 * עם email — נשלח ללקוח מייל עם קישור הרשמה. בלי email — נוצר קישור
 * חד-פעמי פתוח שמעתיקים ושולחים ללקוח (למשל בוואטסאפ).
 * בשני המקרים הקישור מוחזר, כדי שאפשר יהיה להעתיק אותו גם אם המייל לא הגיע.
 */
export const createCustomerInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { email?: string | null; priceTier?: 1 | 2 | 3 | null; agentId?: string | null }) => {
      const rawEmail = String(input?.email ?? "")
        .trim()
        .toLowerCase();
      if (rawEmail !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
        throw new Error("כתובת אימייל לא תקינה");
      }
      const tier = input?.priceTier ?? null;
      if (tier !== null && ![1, 2, 3].includes(tier)) throw new Error("קבוצת מחיר לא תקינה");
      const agentId = String(input?.agentId ?? "").trim();
      return { email: rawEmail || null, priceTier: tier, agentId: agentId || null };
    },
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { allowAction } = await import("@/lib/rate-limit.server");
    const { createInvite, sendInviteEmail } = await import("@/lib/invite.server");

    const { data: caller } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (caller?.role !== "admin" && caller?.role !== "agent") throw new Error("אין הרשאה");

    if (!allowAction(`invite:${context.userId}`, 40, 60 * 60 * 1000)) {
      throw new Error("נוצרו יותר מדי הזמנות בשעה האחרונה. נסו שוב מאוחר יותר.");
    }

    if (data.email) {
      const { data: existing } = await supabaseAdmin
        .from("user_roles")
        .select("user_id")
        .eq("email", data.email)
        .maybeSingle();
      if (existing) {
        throw new Error(
          'כבר קיים חשבון עם המייל הזה. אפשר לשלוח לו "קישור כניסה" מרשימת המשתמשים.',
        );
      }
    }

    // סוכן מזמין תמיד לעצמו; מנהל בוחר מי יטפל (או אף אחד)
    let agentId = data.agentId;
    if (caller.role === "agent") {
      agentId = context.userId;
    } else if (agentId) {
      const { data: handler } = await supabaseAdmin
        .from("user_roles")
        .select("role")
        .eq("user_id", agentId)
        .maybeSingle();
      if (handler?.role !== "agent" && handler?.role !== "admin") {
        throw new Error("גורם הטיפול שנבחר אינו סוכן או מנהל");
      }
    }

    const { link, expiresAt } = await createInvite({
      email: data.email,
      priceTier: data.priceTier,
      agentId,
      createdBy: context.userId,
    });

    if (!data.email) return { link, expiresAt, emailed: false, reason: null as string | null };

    const result = await sendInviteEmail(data.email, link, expiresAt);
    return {
      link,
      expiresAt,
      emailed: result.sent,
      reason: result.sent ? null : (result.reason ?? "שליחת המייל נכשלה"),
    };
  });

/** בדיקת קישור הזמנה מדף ההרשמה (ציבורי) — בלי לחשוף פרטים מעבר למייל המוזמן */
export const checkCustomerInvite = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => {
    const token = String(input?.token ?? "").trim();
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new Error("קישור ההזמנה לא תקין.");
    return { token };
  })
  .handler(async ({ data }) => {
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    const { findValidInvite } = await import("@/lib/invite.server");
    const ip = await requestIp();
    if (!allowAction(`invite-check:${ip}`, 30, 15 * 60 * 1000)) {
      return {
        valid: false as const,
        email: null,
        reason: "יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.",
      };
    }
    const result = await findValidInvite(data.token);
    if ("reason" in result) return { valid: false as const, email: null, reason: result.reason };
    return { valid: true as const, email: result.invite.email, reason: null };
  });
