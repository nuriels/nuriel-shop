// זהות המשתמש של הבקשה (צד שרת) — בלי כללי השיוך של החנויות.
// אורח באתר אירוח יכול להיות חבר צוות באתר אחר; ההרשאה נבדקת במסד לפי
// request_tenant() + auth.uid() (plan A10 / B9), לא לפי השיוך שלו.
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { publishableKey, supabaseUrl } from "../supabase/env.server";

export interface UserSession {
  userId: string;
  accessToken: string;
}

/** null = אין משתמש מחובר; טוקן לא תקין → שגיאה (לא ממשיכים כאנונימי) */
export async function sessionFromRequest(): Promise<UserSession | null> {
  const header = getRequest()?.headers.get("authorization");
  if (!header) return null;
  if (!header.startsWith("Bearer "))
    throw new Error("Unauthorized: Only Bearer tokens are supported");
  const token = header.slice("Bearer ".length).trim();
  if (token.split(".").length !== 3) throw new Error("Unauthorized: Invalid token");
  const client = createClient(supabaseUrl(), publishableKey(), {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getClaims(token);
  const sub = data?.claims?.sub;
  if (error || typeof sub !== "string" || !sub) throw new Error("Unauthorized: Invalid token");
  return { userId: sub, accessToken: token };
}

export async function requireSession(): Promise<UserSession> {
  const session = await sessionFromRequest();
  if (!session) throw new Error("נדרשת התחברות");
  return session;
}
