/**
 * חלק 44: ביצוע מה שהמשתמש אישר מסריקת אתר מקור — צד שרת.
 *
 *  - מוצרים חדשים: דרך importRows (אותו מנגנון של ייבוא CSV — import_products במסד:
 *    בדיקת כפילות ברקוד / מק"ט, הורדת תמונות בטוחה לאחסון שלנו, יצירת קטגוריות).
 *  - עדכוני מוצרים קיימים: רק שדות שאושרו, ורק למוצרים של החנות הפעילה (supabaseAdmin
 *    מוגבל לחנות; הכתיבה עצמה בחיבור של המנהל — RLS). שום מחיקה, ושום שינוי מלאי בלי כמות
 *    מפורשת מהמקור. שדה שאי אפשר ליישם (למשל קטגוריה שלא קיימת) — מדולג ומדווח.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { currentTenantId } from "@/integrations/supabase/tenant.server";
import type { Database } from "@/integrations/supabase/types";
import type { ImportRow } from "@/lib/csv-import";
import type { ApplyInput, ApplyResult } from "@/lib/source-scan.functions";
import { normBarcode, normText, type DiffField, type SourceProduct } from "@/lib/source-scan";
import { importDescriptionHtml } from "@/lib/url-import";
import { importRows } from "@/server/services/csv-import";
import { describeImageError, saveImportedImage } from "@/server/services/image-fetch";

type Patch = Database["public"]["Tables"]["global_products"]["Update"];

/** שורת ייבוא למוצר חדש — כל הערכים כמחרוזות, כמו בקובץ CSV */
export function importRowFor(source: SourceProduct, index: number): ImportRow {
  const category = source.category ?? "";
  return {
    row: index + 1,
    name: source.name,
    price: source.price === null ? "" : String(source.price),
    category,
    categories: category ? [[category]] : [],
    description: importDescriptionHtml(source.description, [], { description: true, specs: false }),
    // המק"ט של החנות נוצר אוטומטית (8 ספרות); מק"ט המקור לא נכפה
    sku: "",
    barcode: normBarcode(source.barcode) ?? "",
    // מלאי: לא משוער מהמקור (כמות לא אמינה) — מוצר חדש נכנס בלי מלאי ואפשר לעדכן אחר כך
    stock: "",
    image_url: source.images[0] ?? source.image ?? "",
    images: source.images.length > 0 ? source.images : source.image ? [source.image] : [],
    sale_price: "",
    sale_ends_at: "",
    cost_price: "",
    hidden: "",
    show_in_zap: "",
    seo_title: "",
    seo_description: "",
  };
}

export async function applyApproved(
  data: ApplyInput,
  supabase: SupabaseClient<Database>,
): Promise<ApplyResult> {
  const result: ApplyResult = { added: null, updated: [] };

  if (data.adds.length > 0) {
    const rows = data.adds.map((source, index) => importRowFor(source, index));
    result.added = await importRows(rows, supabase);
  }

  if (data.updates.length === 0) return result;
  const tenantId = currentTenantId();
  const ids = data.updates.map((u) => u.productId);
  // רק מוצרים של החנות הפעילה (supabaseAdmin מוגבל לחנות של הבקשה)
  const { data: owned } = await supabaseAdmin
    .from("global_products")
    .select("id, name, barcode, image_url, images, category, uniform_price")
    .in("id", ids);
  const byId = new Map((owned ?? []).map((p) => [p.id, p]));
  const { data: cats } = await supabaseAdmin.from("categories").select("name");
  const storeCategories = (cats ?? []).map((c) => c.name);

  for (const update of data.updates) {
    const local = byId.get(update.productId);
    if (!local) {
      result.updated.push({ productId: update.productId, ok: false, error: "המוצר לא נמצא בחנות" });
      continue;
    }
    const patch: Patch = {};
    const applied: DiffField[] = [];
    const skipped: string[] = [];
    const { source } = update;
    try {
      for (const field of update.fields) {
        if (field === "name") {
          if (source.name.trim()) {
            patch.name = source.name.trim().slice(0, 200);
            applied.push(field);
          }
        } else if (field === "price") {
          if (source.price !== null && source.price > 0) {
            patch.price_tier1 = source.price;
            // מוצר עם מחיר אחיד — כל הדרגות זהות (כמו בעריכת מוצר)
            if (local.uniform_price) {
              patch.price_tier2 = source.price;
              patch.price_tier3 = source.price;
            }
            applied.push(field);
          }
        } else if (field === "description") {
          const html = importDescriptionHtml(source.description, [], {
            description: true,
            specs: false,
          });
          if (html) {
            patch.description = html;
            applied.push(field);
          }
        } else if (field === "image") {
          if (local.image_url) skipped.push("תמונה: בחנות כבר יש תמונה");
          else if (source.image) {
            try {
              const saved = await saveImportedImage(tenantId, source.image);
              patch.image_url = saved.url;
              patch.images = [saved.url, ...(local.images ?? [])];
              applied.push(field);
            } catch (error) {
              skipped.push(`תמונה: ${describeImageError(error)}`);
            }
          }
        } else if (field === "barcode") {
          const barcode = normBarcode(source.barcode);
          if (local.barcode) skipped.push("ברקוד: בחנות כבר יש ברקוד");
          else if (barcode) {
            const { data: taken } = await supabaseAdmin
              .from("global_products")
              .select("id")
              .eq("barcode", barcode)
              .neq("id", local.id)
              .limit(1);
            if ((taken ?? []).length > 0) skipped.push("ברקוד: כבר קיים במוצר אחר בחנות");
            else {
              patch.barcode = barcode;
              applied.push(field);
            }
          }
        } else if (field === "category") {
          const match = storeCategories.find(
            (name) => normText(name) === normText(source.category),
          );
          if (match) {
            patch.category = match;
            applied.push(field);
          } else skipped.push("קטגוריה: לא קיימת בחנות");
        } else if (field === "stock") {
          if (source.stock !== null) {
            patch.stock_quantity = source.stock;
            applied.push(field);
          } else skipped.push("מלאי: אין כמות מפורשת במקור");
        }
      }
      if (applied.length === 0) {
        result.updated.push({
          productId: update.productId,
          ok: false,
          error: skipped.join(" · ") || "אין מה לעדכן",
        });
        continue;
      }
      const { data: rows, error } = await supabase
        .from("global_products")
        .update(patch)
        .eq("id", update.productId)
        .select("id");
      if (error) {
        result.updated.push({ productId: update.productId, ok: false, error: error.message });
      } else if (!rows || rows.length === 0) {
        result.updated.push({
          productId: update.productId,
          ok: false,
          error: "העדכון לא בוצע (הרשאה)",
        });
      } else {
        result.updated.push({
          productId: update.productId,
          ok: true,
          ...(skipped.length > 0 ? { error: `חלק מהשדות דולגו: ${skipped.join(" · ")}` } : {}),
        });
      }
    } catch (error) {
      result.updated.push({
        productId: update.productId,
        ok: false,
        error: error instanceof Error ? error.message : "העדכון נכשל",
      });
    }
  }
  return result;
}
