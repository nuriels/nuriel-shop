import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * קליטת מלאי בסריקה.
 *
 * הזרימה: סורקים ברקודים (במצלמה או מתמונה), המערכת מזהה מה קיים בקטלוג
 * ומה לא, ומציגה טבלה לאישור. באישור:
 *  - מוצר קיים שסומן "אזל" חוזר אוטומטית להיות במלאי, והכמות שנסרקה
 *    מתווספת למלאי.
 *  - ברקוד שאינו מוכר נשמר כ"מוצר ממתין לאישור", והמנהל משלים אותו
 *    למוצר אמיתי בלשונית ייעודית. לא נוצר מוצר חלקי שמופיע ללקוחות.
 */

type ScanLine = { barcode: string; quantity: number; suggestedName?: string };

async function assertStaff(userId: string): Promise<"admin" | "agent"> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: caller } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  if (caller?.role !== "admin" && caller?.role !== "agent") throw new Error("אין הרשאה");
  return caller.role;
}

/** בדיקה מהירה מול הקטלוג: אילו ברקודים מוכרים ואילו לא */
export const lookupScannedBarcodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { barcodes: string[] }) => {
    const barcodes = (Array.isArray(input?.barcodes) ? input.barcodes : [])
      .map((code) => String(code).trim())
      .filter((code) => code !== "" && code.length <= 64)
      .slice(0, 500);
    if (barcodes.length === 0) throw new Error("לא התקבלו ברקודים");
    return { barcodes };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertStaff(context.userId);

    const { data: products } = await supabaseAdmin
      .from("global_products")
      .select("id, name, sku, barcode, category, image_url, stock_quantity, is_out_of_stock")
      .in("barcode", data.barcodes);

    const { data: pending } = await supabaseAdmin
      .from("pending_products")
      .select("id, barcode, suggested_name, scanned_count")
      .eq("status", "pending")
      .in("barcode", data.barcodes);

    return {
      products: (products ?? []).map((product) => ({
        id: product.id,
        barcode: product.barcode,
        name: product.name,
        sku: product.sku,
        category: product.category,
        imageUrl: product.image_url,
        stockQuantity: product.stock_quantity,
        isOutOfStock: product.is_out_of_stock,
      })),
      pending: (pending ?? []).map((row) => ({
        barcode: row.barcode,
        suggestedName: row.suggested_name,
        scannedCount: row.scanned_count,
      })),
    };
  });

/** אישור סופי של הסריקה: עדכון מלאי לקיימים, בקשות אישור לחדשים */
export const applyScanSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { lines: ScanLine[]; addToStock?: boolean }) => {
    const lines = (Array.isArray(input?.lines) ? input.lines : [])
      .map((line) => ({
        barcode: String(line?.barcode ?? "").trim(),
        quantity: Math.max(0, Math.min(9999, Math.round(Number(line?.quantity ?? 1)))),
        suggestedName: String(line?.suggestedName ?? "")
          .trim()
          .slice(0, 200),
      }))
      .filter((line) => line.barcode !== "")
      .slice(0, 500);
    if (lines.length === 0) throw new Error("אין שורות לאישור");
    return { lines, addToStock: input?.addToStock !== false };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertStaff(context.userId);

    const barcodes = data.lines.map((line) => line.barcode);
    const { data: products } = await supabaseAdmin
      .from("global_products")
      .select("id, barcode, stock_quantity, is_out_of_stock")
      .in("barcode", barcodes);

    let updated = 0;
    let restocked = 0;

    for (const product of products ?? []) {
      const line = data.lines.find((candidate) => candidate.barcode === product.barcode);
      if (!line) continue;

      const patch: { stock_quantity?: number; is_out_of_stock?: boolean } = {};
      if (data.addToStock && line.quantity > 0) {
        patch.stock_quantity = (product.stock_quantity ?? 0) + line.quantity;
      }
      // סחורה שהתקבלה = המוצר חזר להיות זמין
      if (product.is_out_of_stock) {
        patch.is_out_of_stock = false;
        restocked += 1;
      }
      if (Object.keys(patch).length === 0) continue;

      const { error } = await supabaseAdmin
        .from("global_products")
        .update(patch)
        .eq("id", product.id);
      if (error) throw new Error(error.message);
      updated += 1;
    }

    const knownBarcodes = new Set((products ?? []).map((product) => product.barcode));
    const missing = data.lines.filter((line) => !knownBarcodes.has(line.barcode));

    let createdRequests = 0;
    for (const line of missing) {
      const { data: existing } = await supabaseAdmin
        .from("pending_products")
        .select("id, scanned_count, suggested_name")
        .eq("barcode", line.barcode)
        .eq("status", "pending")
        .maybeSingle();

      if (existing) {
        // סריקה חוזרת של אותו ברקוד מגדילה את המונה במקום לפתוח בקשה נוספת
        const { error } = await supabaseAdmin
          .from("pending_products")
          .update({
            scanned_count: existing.scanned_count + Math.max(1, line.quantity),
            suggested_name: existing.suggested_name || line.suggestedName,
          })
          .eq("id", existing.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabaseAdmin.from("pending_products").insert({
          barcode: line.barcode,
          suggested_name: line.suggestedName,
          scanned_count: Math.max(1, line.quantity),
          created_by: context.userId,
        });
        if (error) throw new Error(error.message);
        createdRequests += 1;
      }
    }

    return { updated, restocked, createdRequests, missingCount: missing.length };
  });

/** סימון בקשה כמאושרת (אחרי שנוצר ממנה מוצר) או כנדחית */
export const resolvePendingProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; status: "approved" | "rejected" }) => {
    const id = String(input?.id ?? "").trim();
    if (!id) throw new Error("חסר מזהה בקשה");
    if (input?.status !== "approved" && input?.status !== "rejected")
      throw new Error("סטטוס לא תקין");
    return { id, status: input.status };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const role = await assertStaff(context.userId);
    if (role !== "admin") throw new Error("רק מנהל יכול לאשר או לדחות מוצרים");

    const { error } = await supabaseAdmin
      .from("pending_products")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
