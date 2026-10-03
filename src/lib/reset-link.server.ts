/**
 * לוגיקת קישור איפוס הסיסמה — צד שרת בלבד.
 * נמצאת במודול נפרד כדי שגם פאנל הניהול (יצירת משתמש חדש) וגם דף
 * ההתחברות ("שכחתי סיסמה") ישתמשו באותו מנגנון טוקן חד-פעמי.
 */

import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendEmail, renderEmailHtml, escapeHtml } from "@/lib/email.server";
import { tenantSiteOrigin } from "@/integrations/supabase/tenant.server";

/** תוקף הקישור: 3 שעות בדיוק */
export const RESET_TOKEN_TTL_MS = 3 * 60 * 60 * 1000;
/** הגבלת קצב: מספר קישורים מקסימלי לאותו משתמש בשעה */
const MAX_REQUESTS_PER_HOUR = 5;

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** מסתיר את רוב כתובת המייל: n****l@gmail.com */
export function maskEmail(email: string): string {
  const [name = "", domain = ""] = email.split("@");
  if (name.length <= 2) return `${name[0] ?? ""}***@${domain}`;
  return `${name[0]}${"*".repeat(Math.min(6, name.length - 2))}${name[name.length - 1]}@${domain}`;
}

/** כתובת הבסיס של האתר, לבניית הקישור במייל */
async function resolveSiteOrigin(): Promise<string> {
  // חשוב: לא נגזר מכותרות הבקשה. כותרת Origin/Host נשלטת ע"י הפונה,
  // ולכן קודם אפשר היה לבקש איפוס סיסמה עם Origin מזויף ולקבל קישור
  // שמצביע לדומיין של התוקף — עם טוקן תקף. הכתובת נבנית מרשומת החנות במסד.
  return tenantSiteOrigin();
}

/**
 * יצירת טוקן חד-פעמי ושליחת מייל עם הקישור.
 * במסד נשמר רק ה-hash של הטוקן, כך שגם קריאה לטבלה לא מאפשרת התחברות.
 */
export async function sendPasswordResetLinkInternal(
  userId: string,
  createdBy: string | null,
  purpose: "reset" | "welcome" | "login_link" = "reset",
): Promise<{ sent: boolean; reason?: string }> {
  const { data: user } = await supabaseAdmin
    .from("user_roles")
    .select("user_id, email, username")
    .eq("user_id", userId)
    .maybeSingle();
  if (!user) return { sent: false, reason: "המשתמש לא נמצא" };

  const sinceIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabaseAdmin
    .from("password_reset_tokens")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", sinceIso);
  if ((count ?? 0) >= MAX_REQUESTS_PER_HOUR) {
    return { sent: false, reason: "נשלחו יותר מדי בקשות איפוס בשעה האחרונה. נסו שוב מאוחר יותר." };
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  const { error: insertError } = await supabaseAdmin.from("password_reset_tokens").insert({
    user_id: userId,
    token_hash: hashResetToken(token),
    expires_at: expiresAt.toISOString(),
    created_by: createdBy,
  });
  if (insertError) return { sent: false, reason: insertError.message };

  const origin = await resolveSiteOrigin();
  const link = `${origin}/reset-password?token=${encodeURIComponent(token)}`;
  const expiresLabel = expiresAt.toLocaleString("he-IL", {
    dateStyle: "short",
    timeStyle: "short",
  });
  const isWelcome = purpose === "welcome";
  const isLoginLink = purpose === "login_link";

  const subject = isWelcome
    ? "החשבון שלך נפתח — קביעת סיסמה"
    : isLoginLink
      ? "קישור כניסה למערכת ההזמנות"
      : "איפוס סיסמה";
  const title = isWelcome
    ? "ברוכים הבאים — קביעת סיסמה"
    : isLoginLink
      ? "קישור כניסה"
      : "איפוס סיסמה";
  const intro = isWelcome
    ? `נפתח עבורכם חשבון במערכת ההזמנות. שם המשתמש שלכם: <strong dir="ltr">${escapeHtml(user.username ?? user.email)}</strong>.`
    : isLoginLink
      ? `יש לכם חשבון פעיל במערכת ההזמנות (שם משתמש: <strong dir="ltr">${escapeHtml(user.username ?? user.email)}</strong>). אם שכחתם איך נכנסים, אפשר להשתמש בקישור הבא כדי להתחבר ולקבוע סיסמה חדשה במידת הצורך.`
      : `התקבלה בקשה לאיפוס הסיסמה של המשתמש <strong dir="ltr">${escapeHtml(user.username ?? user.email)}</strong>.`;
  const buttonLabel = isWelcome ? "קביעת סיסמה" : isLoginLink ? "כניסה למערכת" : "קביעת סיסמה חדשה";
  const footNote = isWelcome
    ? "אם תוקף הקישור פג, אפשר ללחוץ על שכחתי סיסמה בדף ההתחברות ולקבל קישור חדש."
    : isLoginLink
      ? "אם תוקף הקישור פג, אפשר ללחוץ על שכחתי סיסמה בדף ההתחברות ולקבל קישור חדש."
      : "אם לא ביקשתם לאפס סיסמה, אפשר להתעלם מהודעה זו — הסיסמה הקיימת נשארת בתוקף.";

  return sendEmail({
    to: [user.email],
    subject,
    logFor: { userId, kind: "password_reset", sentBy: createdBy },
    html: await renderEmailHtml(
      title,
      `
      <p>שלום,</p>
      <p>${intro}</p>
      <p style="margin:20px 0;">
        <a href="${link}" style="background:#12211F;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;display:inline-block;">
          ${buttonLabel}
        </a>
      </p>
      <p>הקישור תקף עד <strong>${escapeHtml(expiresLabel)}</strong> (3 שעות), וניתן לשימוש פעם אחת בלבד.</p>
      <p style="color:#6b7280;font-size:13px;">${footNote}</p>
    `,
    ),
  });
}

/**
 * שליחת הסיסמה הזמנית למייל של הלקוח (אופציונלי, לפי בחירת המנהל).
 * מודגש בהודעה שיהיה עליו להחליף אותה בכניסה הראשונה.
 */
export async function sendTempPasswordEmail(
  userId: string,
  tempPassword: string,
): Promise<{ sent: boolean; reason?: string }> {
  const { data: user } = await supabaseAdmin
    .from("user_roles")
    .select("email, username")
    .eq("user_id", userId)
    .maybeSingle();
  if (!user) return { sent: false, reason: "המשתמש לא נמצא" };

  const origin = await resolveSiteOrigin();

  return sendEmail({
    to: [user.email],
    subject: "פרטי הכניסה שלך למערכת ההזמנות",
    // הסיסמה הזמנית עצמה לא נשמרת ביומן — רק העובדה שנשלח מייל כניסה
    logFor: { userId, kind: "temp_password" },
    html: await renderEmailHtml(
      "החשבון שלך נפתח",
      `
        <p>שלום,</p>
        <p>נפתח עבורכם חשבון במערכת ההזמנות. אלו פרטי הכניסה:</p>
        <p style="margin:14px 0;">
          שם משתמש: <strong dir="ltr">${escapeHtml(user.username ?? user.email)}</strong><br/>
          סיסמה זמנית:
          <strong dir="ltr" style="display:inline-block;background:#f3f5f3;padding:6px 12px;border-radius:6px;letter-spacing:1px;">${escapeHtml(tempPassword)}</strong>
        </p>
        <p style="margin:20px 0;">
          <a href="${origin}/login" style="background:#12211F;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;display:inline-block;">
            כניסה למערכת
          </a>
        </p>
        <p><strong>בכניסה הראשונה</strong> תתבקשו להחליף את הסיסמה הזמנית לסיסמה קבועה ולהשלים את פרטי העסק.</p>
      `,
    ),
  });
}
