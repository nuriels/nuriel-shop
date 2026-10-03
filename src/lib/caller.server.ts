/**
 * מי מבצע את פעולת השרת — בחנות של הבקשה הנוכחית. צד שרת בלבד.
 *
 * חבר צוות / לקוח: לפי השורה שלו ב-user_roles של החנות.
 * מנהל-על (platform_admins) שאינו רשום בחנות — "מנהל" מלא בכל חנות
 * (God Mode), בלי שורה בצוות שלה. במקרה כזה memberId הוא null: עמודות
 * "בוצע ע"י" שמפנות לצוות החנות (מפתח זר ל-user_roles) נשמרות כ-NULL.
 */

import {
  isPlatformAdminUser,
  supabaseAdmin,
  supabaseAdminUnscoped,
} from "@/integrations/supabase/client.server";

export type CallerRole = "admin" | "agent" | "customer" | "warehouse";

export type Caller = {
  /** התפקיד בחנות הנוכחית; מנהל-על שאינו בצוות = "admin" */
  role: CallerRole | null;
  email: string | null;
  /** true = פועל כמנהל-על בחנות שאינו רשום בה */
  godMode: boolean;
  /** המזהה לעמודות "בוצע ע"י" — null כשהקורא אינו רשום בחנות */
  memberId: string | null;
};

export async function loadCaller(userId: string): Promise<Caller> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role, email")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) {
    return {
      role: data.role as CallerRole,
      email: data.email,
      godMode: false,
      memberId: userId,
    };
  }
  if (await isPlatformAdminUser(userId)) {
    const { data: auth } = await supabaseAdminUnscoped.auth.admin.getUserById(userId);
    return { role: "admin", email: auth.user?.email ?? null, godMode: true, memberId: null };
  }
  return { role: null, email: null, godMode: false, memberId: null };
}

/** המשתמש אם הוא רשום בחנות הנוכחית, אחרת null (לעמודות "בוצע ע"י") */
export async function memberIdOrNull(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.user_id ?? null;
}
