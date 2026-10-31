// החיבור של המשתמש בדפדפן (Stage 2 plan §1.3) — מתאם ללקוח ה-Supabase הקיים
// (src/integrations/supabase/client): אותו אחסון, אותו רענון טוקן, אותו x-tenant-id.
// הטוקן מצורף לכל קריאה לפונקציית שרת ע"י attachSupabaseAuth (src/start.ts).
import { cleanAscii, supabase } from "@/integrations/supabase/client";

export interface BrowserSession {
  userId: string;
  email: string | null;
}

export async function getBrowserSession(): Promise<BrowserSession | null> {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  return user ? { userId: user.id, email: user.email ?? null } : null;
}

/** החיבור שהשרת פתח (סיסמה / קוד במייל / handoff) נשמר בדפדפן */
export async function applyServerSession(accessToken: string, refreshToken: string): Promise<void> {
  const { error } = await supabase.auth.setSession({
    access_token: cleanAscii(accessToken, "access_token") ?? "",
    refresh_token: cleanAscii(refreshToken, "refresh_token") ?? "",
  });
  if (error) throw error;
}

/** התנתקות מהאתר הזה בלבד (החיבור נשמר לכל כתובת בנפרד) */
export async function signOutHere(): Promise<void> {
  await supabase.auth.signOut({ scope: "local" });
}

/** הודעה כשהחיבור משתנה (התנתקות בלשונית אחרת, פקיעה) — מחזיר ביטול הרשמה */
export function onSessionChange(listener: (signedIn: boolean) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => listener(session !== null));
  return () => data.subscription.unsubscribe();
}
