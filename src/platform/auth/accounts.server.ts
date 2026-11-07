// חשבון התחברות (auth) לפי אימייל — מתאם ללקוח ה-service role הקיים, בדיוק כמו
// ההרשמה בקוד מייל הקיימת: אימייל מאומת, בלי סיסמה (נכנסים בקוד במייל).
// לא מתחבר, לא כותב user_roles, לא שולח מייל. מי שקורא אחראי לבדוק הרשאה לפני.
import { supabaseAdminUnscoped } from "@/integrations/supabase/client.server";

export async function ensureAccount(
  email: string,
  meta: Record<string, string> = {},
): Promise<{ created: boolean }> {
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
  return { created: !error };
}

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
