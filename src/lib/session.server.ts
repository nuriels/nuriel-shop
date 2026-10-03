/**
 * פתיחת חיבור (session) רגיל של GoTrue למשתמש לפי אימייל — צד שרת בלבד.
 *
 * משמש כשהשרת כבר וידא את הזהות בדרך אחרת:
 *  - כניסה מפאנל הפלטפורמה לניהול חנות (קוד חד-פעמי, handoff.functions.ts)
 *  - התחברות בקוד למייל (login-code.functions.ts)
 *
 * השיטה: קישור כניסה (magic link) שנוצר עם service role ומאומת מיד כאן בשרת
 * עם המפתח הציבורי — GoTrue מחזיר חיבור אמיתי (access + refresh), ושום מייל
 * של GoTrue לא נשלח.
 */

import { supabaseAdminUnscoped } from "@/integrations/supabase/client.server";

export type IssuedSession = { accessToken: string; refreshToken: string; userId: string };

export async function sessionForEmail(email: string, logTag: string): Promise<IssuedSession> {
  const { data: link, error: linkError } = await supabaseAdminUnscoped.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) {
    console.error(`[${logTag}] generateLink failed`, linkError?.message);
    throw new Error("יצירת החיבור נכשלה. נסו שוב.");
  }

  const SUPABASE_URL = process.env["SUPABASE_URL"];
  const SUPABASE_PUBLISHABLE_KEY = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) throw new Error("תקלת הגדרות בשרת");
  const { createClient } = await import("@supabase/supabase-js");
  const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: verified, error: verifyError } = await client.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (verifyError || !verified.session) {
    console.error(`[${logTag}] verifyOtp failed`, verifyError?.message);
    throw new Error("החיבור נכשל. נסו שוב.");
  }

  return {
    accessToken: verified.session.access_token,
    refreshToken: verified.session.refresh_token,
    userId: verified.session.user.id,
  };
}
