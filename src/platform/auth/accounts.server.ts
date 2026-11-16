// חשבון התחברות (auth) לפי אימייל — מתאם ללקוח ה-service role הקיים, בדיוק כמו
// ההרשמה בקוד מייל הקיימת: אימייל מאומת, בלי סיסמה (נכנסים בקוד במייל).
// לא מתחבר, לא כותב user_roles, לא שולח מייל. מי שקורא אחראי לבדוק הרשאה לפני.
import { supabaseAdminUnscoped } from "@/integrations/supabase/client.server";

export async function ensureAccount(
  email: string,
  meta: Record<string, string> = {},
): Promise<{ created: boolean; existed: boolean }> {
  const { error } = await supabaseAdminUnscoped.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: meta,
    // SEC-H1: סימון חסין-זיוף (app_metadata — המשתמש אינו יכול לשנותו ב-updateUser) שהחשבון
    // נוצר בידי המערכת. שיוך תפקיד/בעלות לפי אימייל מקשר רק לחשבון מסומן כזה.
    app_metadata: { platform: true },
  });
  // נוצר בינתיים (בקשה מקבילה) — החשבון קיים, וזה מה שצריך
  if (error && !/already|exists|registered/i.test(error.message)) {
    throw new Error("פתיחת החשבון נכשלה. נסו שוב.");
  }
  // existed: כבר יש חשבון עם הכתובת. אם הוא לא "מאומת" (SEC-H1 — לא נוצר בידי המערכת, לא Google
  // ולא נכנס פעם בקוד למייל), המסד לא יקשר אליו תפקיד — ומי שקורא מסביר מה לעשות
  return { created: !error, existed: Boolean(error) };
}

/**
 * SEC-H1: לכתובת יש חשבון שעוד לא אומת — המסד לא מקשר אליו תפקיד לפי אימייל (כדי שמי שפתח חשבון
 * עם כתובת של אדם אחר לא יקבל את התפקיד). כניסה אחת בקוד למייל מוכיחה שהכתובת שלו ומאמתת את החשבון.
 */
export const UNVERIFIED_ACCOUNT_MESSAGE =
  "לכתובת הזו כבר יש חשבון במערכת שעדיין לא אומת. בעל הכתובת צריך להיכנס פעם אחת עם קוד שנשלח " +
  "למייל (בכניסה לניהול), ואז לנסות שוב.";

/**
 * שלב א' 3: סיסמה חדשה לחשבון של החיבור — רק אחרי שמי שקורא אימת את המשתמש (קוד חד-פעמי למייל) ובדק
 * הרשאה. הטוקן נבדק מול שרת ההתחברות (GoTrue); הסיסמה עצמה לא נרשמת בשום מקום מלבדו.
 */
export async function setPasswordForSession(accessToken: string, password: string): Promise<void> {
  const { data, error } = await supabaseAdminUnscoped.auth.getUser(accessToken);
  if (error || !data.user) throw new Error("החיבור לא אומת. נסו שוב.");
  const { error: updateError } = await supabaseAdminUnscoped.auth.admin.updateUserById(
    data.user.id,
    { password },
  );
  if (updateError) {
    // GoTrue מחזיר הודעה באנגלית (למשל סיסמה חלשה מדי) — בלי פרטים נוספים
    throw new Error(
      /weak|short|least/i.test(updateError.message)
        ? "הסיסמה חלשה מדי — בחרו סיסמה ארוכה יותר"
        : "שמירת הסיסמה נכשלה. נסו שוב.",
    );
  }
}

/**
 * מיגרציה 198 — הזמנת בעלת אתר: חשבון חדש עם סיסמה שהמשתמשת בחרה. הסיסמה עוברת רק ל-GoTrue (לא נרשמת).
 * email_confirm: הכרחי כדי שתוכל להתחבר בסיסמה (GoTrue חוסם כניסה לחשבון "לא מאושר") — זה לא אימות המייל: האימות
 * האמיתי נרשם בנפרד (קוד שנשלח לתיבה), וההרשאות עד אז באות מההזמנה, לא מהמייל. לכן גם לא מסומן platform (SEC-H1)
 * — שיוך לפי אימייל לא יגיע לחשבון הזה לפני שהמייל אומת.
 */
export async function createInvitedAccount(
  email: string,
  password: string,
): Promise<{ userId: string } | { exists: true }> {
  const { data, error } = await supabaseAdminUnscoped.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { signup_method: "site_owner_invite" },
    app_metadata: { invited_owner: true },
  });
  if (error) {
    if (/already|exists|registered/i.test(error.message)) return { exists: true };
    throw new Error(
      /weak|short|least|password/i.test(error.message)
        ? "הסיסמה לא התקבלה — בחרו סיסמה ארוכה וחזקה יותר"
        : "פתיחת החשבון נכשלה. נסו שוב.",
    );
  }
  if (!data.user?.id) throw new Error("פתיחת החשבון נכשלה. נסו שוב.");
  return { userId: data.user.id };
}

/** ביטול חשבון שנפתח רגע קודם כשההזמנה לא מומשה (קישור שנוצל בינתיים וכו') — לא משאירים חשבון יתום */
export async function deleteNewAccount(userId: string): Promise<void> {
  const { error } = await supabaseAdminUnscoped.auth.admin.deleteUser(userId);
  if (error)
    console.error("[accounts] could not delete an unused new account", userId, error.message);
}
