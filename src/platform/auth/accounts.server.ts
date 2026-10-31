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
  });
  // נוצר בינתיים (בקשה מקבילה) — החשבון קיים, וזה מה שצריך
  if (error && !/already|exists|registered/i.test(error.message)) {
    throw new Error("פתיחת החשבון נכשלה. נסו שוב.");
  }
  return { created: !error };
}
