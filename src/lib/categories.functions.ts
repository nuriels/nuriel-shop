import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** ניהול קטגוריות גלובליות (אדמין בלבד): שינוי שם ומחיקה בטוחה של קטגוריה ריקה */

function validName(input: unknown, field: string): string {
  const name = String(input ?? "")
    .trim()
    .replace(/\s{2,}/g, " ");
  if (name.length < 1 || name.length > 30) throw new Error(`${field}: 1 עד 30 תווים`);
  return name;
}

/** שינוי שם קטגוריה — מתעדכן אוטומטית בכל המוצרים (ON UPDATE CASCADE) */
export const renameCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { oldName: string; newName: string }) => ({
    oldName: validName(input?.oldName, "השם הנוכחי"),
    newName: validName(input?.newName, "השם החדש"),
  }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (role?.role !== "admin") throw new Error("אין הרשאה");
    const { data: updated, error } = await supabaseAdmin.rpc("rename_category", {
      _old: data.oldName,
      _new: data.newName,
    });
    if (error) {
      if (error.message.includes("categories_pkey") || error.message.includes("duplicate")) {
        throw new Error("קטגוריה בשם הזה כבר קיימת");
      }
      throw new Error(error.message);
    }
    return { productsUpdated: (updated as number | null) ?? 0 };
  });

/** מחיקת קטגוריה — רק אם אין מוצרים שמשתמשים בה */
export const deleteCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { name: string }) => ({ name: validName(input?.name, "שם הקטגוריה") }))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (role?.role !== "admin") throw new Error("אין הרשאה");
    const { count } = await supabaseAdmin
      .from("global_products")
      .select("id", { count: "exact", head: true })
      .eq("category", data.name);
    if ((count ?? 0) > 0) {
      throw new Error(
        `יש ${count} מוצרים בקטגוריה "${data.name}" — העבירו אותם לקטגוריה אחרת לפני המחיקה`,
      );
    }
    const { count: children } = await supabaseAdmin
      .from("categories")
      .select("name", { count: "exact", head: true })
      .eq("parent_name", data.name);
    if ((children ?? 0) > 0) {
      throw new Error(
        `יש ${children} תת-קטגוריות תחת "${data.name}" — העבירו או מחקו אותן לפני המחיקה`,
      );
    }
    const { error } = await supabaseAdmin.from("categories").delete().eq("name", data.name);
    if (error) throw new Error("מחיקת הקטגוריה נכשלה");
    return { ok: true };
  });
