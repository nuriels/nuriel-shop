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
