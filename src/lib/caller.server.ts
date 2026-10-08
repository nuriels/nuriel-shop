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
import {
  NO_PERMISSION_MESSAGE,
  staffCan,
  staffRoleOf,
  type StaffPermission,
  type StaffRole,
} from "@/lib/permissions";

export type CallerRole = "admin" | "agent" | "customer" | "warehouse" | "cashier";

export type Caller = {
  /** התפקיד בחנות הנוכחית; מנהל-על שאינו בצוות = "admin" */
  role: CallerRole | null;
  /**
   * חלק 33: התפקיד בצוות — owner / manager / cashier / warehouse / agent.
   * מנהל-על (God Mode) = owner; לקוח או חשבון חסום = null.
   */
  staffRole: StaffRole | null;
  email: string | null;
  /** true = פועל כמנהל-על בחנות שאינו רשום בה */
  godMode: boolean;
  /** המזהה לעמודות "בוצע ע"י" — null כשהקורא אינו רשום בחנות */
  memberId: string | null;
};

export async function loadCaller(userId: string): Promise<Caller> {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role, email, is_protected, is_blocked")
    .eq("user_id", userId)
    .maybeSingle();
  const platform = await isPlatformAdminUser(userId);
  if (data) {
    return {
      role: data.role as CallerRole,
      // מנהל-על — בעלים בכל חנות, גם כשהוא רשום בצוות שלה (כמו store_staff_role במסד)
      staffRole: platform ? "owner" : staffRoleOf(data.role, data.is_protected, data.is_blocked),
      email: data.email,
      godMode: false,
      memberId: userId,
    };
  }
  if (platform) {
    const { data: auth } = await supabaseAdminUnscoped.auth.admin.getUserById(userId);
    return {
      role: "admin",
      staffRole: "owner",
      email: auth.user?.email ?? null,
      godMode: true,
      memberId: null,
    };
  }
  return { role: null, staffRole: null, email: null, godMode: false, memberId: null };
}

/**
 * שומר הרשאות לפעולות שרת (Guard): הקורא חייב את ההרשאה בחנות הנוכחית —
 * אחרת "אין לך הרשאה מתאימה" (או הודעה ייעודית). המסד בודק שוב בעצמו.
 */
export async function requireStaffPermission(
  userId: string,
  permission: StaffPermission,
  message: string = NO_PERMISSION_MESSAGE,
): Promise<Caller> {
  const caller = await loadCaller(userId);
  if (!staffCan(caller.staffRole, permission)) throw new Error(message);
  return caller;
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
