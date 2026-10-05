/**
 * פאנל הפלטפורמה — צד שרת בלבד: חשבון מנהל לחנות חדשה, וניקוי חשבונות
 * וקבצים של חנות שנמחקה.
 *
 * נעשה כאן (ולא ב-SQL) כי צריך את ה-Auth API ואת ה-Storage API של Supabase.
 * הסיסמה הזמנית מוצגת למנהל-העל פעם אחת; בכניסה הראשונה מנהל החנות חייב
 * לקבוע סיסמה משלו.
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

// ============================================================
// מחיקת חנות: חשבונות התחברות וקבצים (המידע במסד כבר נמחק ב-platform_delete_tenant)
// ============================================================

/** הדליים שבהם לכל חנות תיקייה משלה: <tenant_id>/... */
export const TENANT_BUCKETS = [
  "product-images",
  "branding",
  "contact-attachments",
  "payment-receipts",
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type ListedItem = { name: string; id: string | null };
/** החלק של ה-Storage API שצריך כאן (מאפשר בדיקה בלי שרת) */
export type BucketApi = {
  list(
    path: string,
    options: { limit: number; offset: number },
  ): Promise<{ data: ListedItem[] | null; error: { message: string } | null }>;
  remove(paths: string[]): Promise<{ error: { message: string } | null }>;
};

async function listFilesRecursive(bucket: BucketApi, prefix: string): Promise<string[]> {
  const PAGE = 1000;
  const files: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await bucket.list(prefix, { limit: PAGE, offset });
    if (error) throw new Error(error.message);
    const items = data ?? [];
    for (const item of items) {
      const path = `${prefix}/${item.name}`;
      // תיקייה = פריט בלי id
      if (item.id === null) files.push(...(await listFilesRecursive(bucket, path)));
      else files.push(path);
    }
    if (items.length < PAGE) break;
  }
  return files;
}

/** מוחק את כל הקבצים של החנות (התיקייה <tenant_id>/ בכל דלי) */
export async function removeTenantStorage(
  tenantId: string,
  bucketFor: (bucket: string) => BucketApi = (b) => supabaseAdminUnscoped.storage.from(b),
): Promise<{ files: number; errors: string[] }> {
  // בלי מזהה תקין התיקייה הייתה "" = כל הקבצים של כל החנויות
  if (!UUID.test(tenantId)) throw new Error("מזהה חנות לא תקין");
  let files = 0;
  const errors: string[] = [];
  for (const name of TENANT_BUCKETS) {
    try {
      const bucket = bucketFor(name);
      const paths = await listFilesRecursive(bucket, tenantId);
      for (let i = 0; i < paths.length; i += 500) {
        const chunk = paths.slice(i, i + 500);
        const { error } = await bucket.remove(chunk);
        if (error) throw new Error(error.message);
        files += chunk.length;
      }
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { files, errors };
}

/** מוחק את חשבונות ההתחברות של החנות (מנהלי-על לא מגיעים לכאן — ראו platform_delete_tenant) */
export async function deleteAuthUsers(
  userIds: string[],
): Promise<{ users: number; errors: string[] }> {
  let users = 0;
  const errors: string[] = [];
  for (const id of userIds) {
    const { error } = await supabaseAdminUnscoped.auth.admin.deleteUser(id);
    if (!error || /not.?found/i.test(error.message)) users += 1;
    else errors.push(`${id}: ${error.message}`);
  }
  return { users, errors };
}
