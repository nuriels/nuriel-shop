/**
 * פאנל הפלטפורמה — צד שרת בלבד: יצירת חשבון מנהל לחנות.
 *
 * נוצר כאן (ולא ב-SQL) כי צריך את ה-Auth API של Supabase. הסיסמה הזמנית
 * מוצגת למנהל-העל פעם אחת; בכניסה הראשונה מנהל החנות חייב לקבוע סיסמה משלו.
 */

import { randomInt } from "node:crypto";
import { supabaseAdminUnscoped } from "@/integrations/supabase/client.server";
import { originForTenant, type Tenant } from "@/integrations/supabase/tenant.server";

export type StoreAdminCredentials = { email: string; tempPassword: string; loginUrl: string };

const ALREADY_REGISTERED = "כתובת האימייל הזו כבר רשומה במערכת (בחנות זו או בחנות אחרת)";

function tempPassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const block = () =>
    Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join("");
  return `${block()}-${block()}-${block()}`;
}

/**
 * בדיקה מוקדמת (לפני שמקימים חנות): האם כבר יש חשבון עם האימייל הזה.
 * חשבון התחברות אחד לכל אימייל בכל הפלטפורמה. ההכרעה הסופית היא של
 * Auth ביצירה עצמה — זו רק כדי לא להשאיר חנות בלי מנהל במקרה הנפוץ.
 */
export async function storeAdminEmailProblem(email: string): Promise<string | null> {
  const { data } = await supabaseAdminUnscoped
    .from("user_roles")
    .select("user_id")
    .eq("email", email)
    .limit(1);
  return data && data.length > 0 ? ALREADY_REGISTERED : null;
}

/** חשבון חדש (אימייל + סיסמה זמנית) עם תפקיד admin בחנות הנתונה */
export async function provisionStoreAdmin(
  tenant: Pick<Tenant, "id" | "slug" | "domain" | "is_default">,
  email: string,
): Promise<StoreAdminCredentials> {
  const password = tempPassword();
  const { data: created, error: createError } = await supabaseAdminUnscoped.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created.user) {
    const message = createError?.message ?? "";
    if (/already|exists|registered|duplicate/i.test(message)) throw new Error(ALREADY_REGISTERED);
    throw new Error(message || "יצירת המשתמש נכשלה");
  }

  const { error: roleError } = await supabaseAdminUnscoped.from("user_roles").insert({
    tenant_id: tenant.id,
    user_id: created.user.id,
    email,
    role: "admin",
    is_approved: true,
    is_blocked: false,
    must_change_password: true,
  });
  if (roleError) {
    // לא משאירים חשבון התחברות בלי שיוך לחנות
    await supabaseAdminUnscoped.auth.admin.deleteUser(created.user.id);
    throw new Error(roleError.message);
  }

  return { email, tempPassword: password, loginUrl: `${originForTenant(tenant)}/login` };
}
