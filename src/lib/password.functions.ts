import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * איפוס סיסמה בקישור חד-פעמי.
 *
 * הזרימה: יוצרים טוקן אקראי, שומרים במסד רק את ה-hash שלו (SHA-256) עם
 * תוקף של 3 שעות, ושולחים למשתמש קישור עם הטוקן הגולמי. בכניסה לקישור
 * מוצג שם המשתמש (לקריאה בלבד) ושדות סיסמה חדשה + אימות. אחרי השינוי
 * הטוקן מסומן כמנוצל, כל הטוקנים הפתוחים האחרים של אותו משתמש מבוטלים,
 * ונשלח מייל אישור.
 */

type TokenRow = {
  id: string;
  user_id: string;
  expires_at: string;
  used_at: string | null;
};

/** "שכחתי סיסמה" מדף ההתחברות — לפי אימייל או שם משתמש */
export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((input: { identifier: string }) => {
    const identifier = String(input?.identifier ?? "").trim();
    if (identifier.length < 3) throw new Error("נא להזין אימייל או שם משתמש");
    return { identifier };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");

    const ip = await requestIp();
    if (!allowAction(`reset-request:${ip}`, 10, 60 * 60 * 1000)) {
      // תשובה זהה לתשובה המוצלחת, כדי לא לחשוף מידע דרך הגבלת הקצב
      return { ok: true };
    }

    const identifier = data.identifier.toLowerCase();

    const query = supabaseAdmin.from("user_roles").select("user_id, is_blocked");
    const { data: user } = identifier.includes("@")
      ? await query.eq("email", identifier).maybeSingle()
      : await query.eq("username", identifier).maybeSingle();

    // תמיד מחזירים את אותה תשובה, גם אם המשתמש לא קיים או חסום — כדי לא
    // לחשוף אילו כתובות/שמות משתמש רשומים במערכת.
    if (user && !user.is_blocked) {
      const { sendPasswordResetLinkInternal } = await import("@/lib/reset-link.server");
      const result = await sendPasswordResetLinkInternal(user.user_id, null);
      // כלפי חוץ התשובה תמיד זהה, אבל כשל שליחה חייב להופיע בלוג השרת
      // (אחרת "ביקשתי איפוס ולא קיבלתי מייל" נשאר בלי שום עקבות).
      if (!result.sent) {
        console.error("[password-reset] send failed:", result.reason);
      }
    }
    return { ok: true };
  });

/** שליחת קישור איפוס/כניסה יזומה ע"י מנהל (כל משתמש) או סוכן (הלקוחות שלו בלבד) */
export const sendPasswordResetLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; purpose?: "reset" | "login_link" }) => {
    const userId = String(input?.userId ?? "").trim();
    if (!userId) throw new Error("חסר מזהה משתמש");
    const purpose: "reset" | "login_link" =
      input?.purpose === "login_link" ? "login_link" : "reset";
    return { userId, purpose };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { loadCaller } = await import("@/lib/caller.server");
    const caller = await loadCaller(context.userId);
    if (caller?.role !== "admin" && caller?.role !== "agent") throw new Error("אין הרשאה");

    if (caller.role === "agent") {
      const { data: profile } = await supabaseAdmin
        .from("customer_profiles")
        .select("agent_id")
        .eq("user_id", data.userId)
        .maybeSingle();
      if (profile?.agent_id !== context.userId)
        throw new Error("אפשר לאפס סיסמה ללקוחות המשויכים אליך בלבד");
    }

    const { sendPasswordResetLinkInternal } = await import("@/lib/reset-link.server");
    const result = await sendPasswordResetLinkInternal(data.userId, context.userId, data.purpose);
    if (!result.sent) throw new Error(result.reason ?? "שליחת הקישור נכשלה");
    return { sent: true };
  });

/** בדיקת תקינות הטוקן בכניסה לעמוד — מחזירה את שם המשתמש להצגה בלבד */
export const verifyPasswordResetToken = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => {
    const token = String(input?.token ?? "").trim();
    if (!token) throw new Error("קישור לא תקין");
    return { token };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { hashResetToken, maskEmail } = await import("@/lib/reset-link.server");
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");

    // חסימת ניסיונות ניחוש טוקנים
    if (!allowAction(`reset-verify:${await requestIp()}`, 30, 60 * 60 * 1000)) {
      throw new Error("יותר מדי ניסיונות. נסו שוב מאוחר יותר.");
    }

    const { data: row } = await supabaseAdmin
      .from("password_reset_tokens")
      .select("id, user_id, expires_at, used_at")
      .eq("token_hash", hashResetToken(data.token))
      .maybeSingle();
    const tokenRow = row as TokenRow | null;

    if (!tokenRow) throw new Error("הקישור אינו תקין");
    if (tokenRow.used_at) throw new Error("כבר נעשה שימוש בקישור הזה. יש לבקש קישור חדש.");
    if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
      throw new Error("תוקף הקישור פג (3 שעות). יש לבקש קישור חדש.");
    }

    const { data: user } = await supabaseAdmin
      .from("user_roles")
      .select("username, email")
      .eq("user_id", tokenRow.user_id)
      .maybeSingle();
    if (!user) throw new Error("המשתמש לא נמצא");

    return { username: user.username, maskedEmail: maskEmail(user.email) };
  });

/** קביעת הסיסמה החדשה בפועל */
export const completePasswordReset = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string; password: string }) => {
    const token = String(input?.token ?? "").trim();
    const password = String(input?.password ?? "");
    if (!token) throw new Error("קישור לא תקין");
    if (password.length < 8) throw new Error("הסיסמה חייבת להכיל לפחות 8 תווים");
    if (password.length > 72) throw new Error("הסיסמה ארוכה מדי");
    return { token, password };
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendEmail, renderEmailHtml, escapeHtml } = await import("@/lib/email.server");
    const { hashResetToken } = await import("@/lib/reset-link.server");

    const tokenHash = hashResetToken(data.token);
    const { data: row } = await supabaseAdmin
      .from("password_reset_tokens")
      .select("id, user_id, expires_at, used_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    const tokenRow = row as TokenRow | null;

    if (!tokenRow) throw new Error("הקישור אינו תקין");
    if (tokenRow.used_at) throw new Error("כבר נעשה שימוש בקישור הזה. יש לבקש קישור חדש.");
    if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
      throw new Error("תוקף הקישור פג (3 שעות). יש לבקש קישור חדש.");
    }

    // סימון הטוקן כמנוצל *לפני* שינוי הסיסמה, ורק אם הוא עדיין פנוי —
    // כך שני לחיצות במקביל לא יוכלו לשנות סיסמה פעמיים.
    const { data: claimed, error: claimError } = await supabaseAdmin
      .from("password_reset_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("id", tokenRow.id)
      .is("used_at", null)
      .select("id")
      .maybeSingle();
    if (claimError || !claimed) throw new Error("כבר נעשה שימוש בקישור הזה. יש לבקש קישור חדש.");

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(tokenRow.user_id, {
      password: data.password,
    });
    if (updateError) throw new Error(updateError.message);

    // מי שקבע סיסמה בעצמו דרך הקישור כבר לא צריך להחליף סיסמה זמנית
    await supabaseAdmin
      .from("user_roles")
      .update({ must_change_password: false })
      .eq("user_id", tokenRow.user_id);

    // ביטול כל הקישורים הפתוחים האחרים של אותו משתמש
    await supabaseAdmin
      .from("password_reset_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("user_id", tokenRow.user_id)
      .is("used_at", null);

    const { data: user } = await supabaseAdmin
      .from("user_roles")
      .select("email, username")
      .eq("user_id", tokenRow.user_id)
      .maybeSingle();

    if (user?.email) {
      // לבקשת בעל המערכת נשלחת גם הסיסמה עצמה לשמירה. שימו לב: סיסמה
      // שנשלחת במייל נשארת בתיבה לצמיתות וקריאה לכל מי שנכנס אליה.
      await sendEmail({
        to: [user.email],
        subject: "הסיסמה שלך שונתה",
        logFor: { userId: tokenRow.user_id, kind: "password_changed" },
        html: await renderEmailHtml(
          "הסיסמה שונתה בהצלחה",
          `
            <p>שלום,</p>
            <p>הסיסמה של המשתמש <strong dir="ltr">${escapeHtml(user.username ?? user.email)}</strong> שונתה זה עתה.</p>
            <p>הסיסמה החדשה שלך לשמירה:</p>
            <p style="font-size:18px;font-weight:bold;letter-spacing:1px;background:#f3f5f3;padding:12px 16px;border-radius:8px;display:inline-block;" dir="ltr">${escapeHtml(data.password)}</p>
            <p style="color:#6b7280;font-size:13px;">מומלץ לשמור את ההודעה במקום בטוח או למחוק אותה אחרי שהסיסמה נשמרה אצלכם.</p>
            <p style="color:#6b7280;font-size:13px;">אם לא אתם ביצעתם את השינוי, יש לפנות מיד למנהל המערכת.</p>
          `,
        ),
      });
    }

    return { ok: true, username: user?.username ?? null };
  });
