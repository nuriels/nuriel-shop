/**
 * ייבוא מוצרים מ-CSV בצד השרת (חלק 18) — מנה אחת בכל קריאה.
 *
 * הדפדפן מחלק את הקובץ למנות קטנות (planImportBatches) ושולח כל מנה עם
 * שורת הכותרות ומספר השורה הראשונה. כאן:
 *   1. השורות מפוענחות מחדש (prepareImport) — לא סומכים על הדפדפן.
 *   2. שורות שייכשלו במסד בכל מקרה (מחיר לא תקין, ברקוד / מק"ט שכבר קיים
 *      בחנות) — לא מורידים להן תמונות.
 *   3. כל קישורי התמונות של המנה (בלי כפילויות) יורדים במקביל — עד 6
 *      בו-זמנית, Promise.allSettled: תמונה שנכשלה לא עוצרת את האחרות —
 *      ונשמרים ב-Storage של החנות (saveImportedImage). במוצר נשמרים רק
 *      הקישורים אצלנו, אף פעם לא הקישור החיצוני.
 *   4. import_products במסד (בהרשאות המנהל): יוצר את המוצרים, את
 *      הקטגוריות החסרות (כולל עץ "אב > ילד") ומקשר כל מוצר לכל הקטגוריות
 *      שלו (product_categories).
 * תמונה שדולגה — אזהרה בשורה של המוצר (עם הסיבה), המוצר עצמו נוצר.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { currentTenantId } from "@/integrations/supabase/tenant.server";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  BATCH_MAX_IMAGES,
  BATCH_MAX_PRODUCTS,
  IMPORT_MAX_LISTED,
  detectMapping,
  emptyImportSummary,
  fieldLabel,
  prepareImport,
  type ImportIssue,
  type ImportRow,
  type ImportSummary,
} from "@/lib/csv-import";
import { describeImageError, saveImportedImage, settledPool } from "@/server/services/image-fetch";

/** כמה תמונות יורדות בו-זמנית */
const IMAGE_CONCURRENCY = 6;
/** כמה זמן לכל ההורדות של מנה (השרת מאחורי Nginx עם 120 שניות) */
const BATCH_IMAGES_DEADLINE_MS = 55_000;
/** כמו בבדיקה במסד */
const PRICE_FORMAT = /^[0-9]{1,8}(\.[0-9]{1,4})?$/;

export type CsvBatchInput = {
  headers: string[];
  rows: string[][];
  /** מספר השורה בקובץ של השורה הראשונה במנה (שורה 1 = הכותרות) */
  firstRow: number;
};

function issuesOf(value: unknown): ImportIssue[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    return {
      row: Number(row["row"] ?? 0),
      name: String(row["name"] ?? ""),
      message: String(row["message"] ?? ""),
    };
  });
}

/** קישור מקוצר להודעה: "example.com/…/photo.jpg" */
function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const file = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
    const tail = file.length > 40 ? `${file.slice(0, 37)}…` : file;
    return tail ? `${parsed.hostname}/…/${tail}` : parsed.hostname;
  } catch {
    return url.slice(0, 60);
  }
}

/**
 * שורות שהמסד ידחה בכל מקרה — לא מורידים להן תמונות (חוסך זמן ולא משאיר
 * קבצים יתומים). המסד עדיין מקבל אותן ומחזיר את השגיאה הרגילה.
 */
async function rowsThatWillFail(rows: ImportRow[]): Promise<Set<number>> {
  const blocked = new Set<number>();
  for (const row of rows) {
    if (!PRICE_FORMAT.test(row.price)) blocked.add(row.row);
  }
  const barcodes = [...new Set(rows.map((row) => row.barcode).filter(Boolean))];
  const skus = [
    ...new Set(rows.map((row) => row.sku.trim()).filter((sku) => /^[0-9]{8}$/.test(sku))),
  ];
  const existingBarcodes = new Set<string>();
  const existingSkus = new Set<string>();
  try {
    if (barcodes.length > 0) {
      const { data } = await supabaseAdmin
        .from("global_products")
        .select("barcode")
        .in("barcode", barcodes);
      for (const entry of data ?? []) if (entry.barcode) existingBarcodes.add(entry.barcode);
    }
    if (skus.length > 0) {
      const { data } = await supabaseAdmin.from("global_products").select("sku").in("sku", skus);
      for (const entry of data ?? []) if (entry.sku) existingSkus.add(entry.sku);
    }
  } catch (error) {
    // הבדיקה המוקדמת היא רק חיסכון — המסד בודק שוב בכל מקרה
    console.warn(
      "[csv-import] duplicate pre-check failed",
      error instanceof Error ? error.message : error,
    );
  }
  // גם כפילות בתוך אותה מנה — המסד ידחה את השנייה
  const seenBarcodes = new Set<string>();
  const seenSkus = new Set<string>();
  for (const row of rows) {
    const sku = row.sku.trim();
    if (row.barcode && (existingBarcodes.has(row.barcode) || seenBarcodes.has(row.barcode))) {
      blocked.add(row.row);
    }
    if (/^[0-9]{8}$/.test(sku) && (existingSkus.has(sku) || seenSkus.has(sku)))
      blocked.add(row.row);
    if (row.barcode) seenBarcodes.add(row.barcode);
    if (/^[0-9]{8}$/.test(sku)) seenSkus.add(sku);
  }
  return blocked;
}

/**
 * מנה אחת: פענוח → הורדת תמונות במקביל → יצירה במסד.
 * `supabase` — הלקוח עם ההרשאות של המנהל (import_products בודק שהוא מנהל
 * החנות, ומגבלת המוצרים של החבילה נאכפת בטריגרים).
 */
export async function importCsvBatch(
  input: CsvBatchInput,
  supabase: SupabaseClient<Database>,
): Promise<ImportSummary> {
  const tenantId = currentTenantId();
  const prepared = prepareImport(
    { headers: input.headers, rows: input.rows, delimiter: "," },
    detectMapping(input.headers),
    input.firstRow,
  );
  if (prepared.missing.length > 0) {
    throw new Error(
      `חסרות עמודות חובה: ${prepared.missing.map(fieldLabel).join(", ")}. בדקו ששורת הכותרות תואמת לקובץ הדוגמה.`,
    );
  }
  if (prepared.rows.length > BATCH_MAX_PRODUCTS) {
    throw new Error(`עד ${BATCH_MAX_PRODUCTS} מוצרים בכל מנה`);
  }

  const summary = emptyImportSummary();
  summary.total = prepared.rows.length;
  summary.skipped = prepared.skipped.slice(0, IMPORT_MAX_LISTED);
  if (prepared.rows.length === 0) return summary;

  // 1) שורות שייכשלו בכל מקרה — בלי הורדת תמונות
  const blocked = await rowsThatWillFail(prepared.rows);

  // 2) כל הקישורים של המנה, בלי כפילויות (אותה תמונה בכמה מוצרים — הורדה אחת)
  const urls = [
    ...new Set(prepared.rows.filter((row) => !blocked.has(row.row)).flatMap((row) => row.images)),
  ];
  if (urls.length > BATCH_MAX_IMAGES) {
    throw new Error(`עד ${BATCH_MAX_IMAGES} תמונות בכל מנה`);
  }

  // 3) הורדה + שמירה במקביל (Promise.allSettled — כל תמונה לחוד)
  const deadline = Date.now() + BATCH_IMAGES_DEADLINE_MS;
  const outcomes = await settledPool(urls, IMAGE_CONCURRENCY, (url) =>
    saveImportedImage(tenantId, url, { deadline }),
  );
  const saved = new Map<string, string>();
  const failed = new Map<string, string>();
  outcomes.forEach((outcome, index) => {
    const url = urls[index]!;
    if (outcome.status === "fulfilled") saved.set(url, outcome.value.url);
    else failed.set(url, describeImageError(outcome.reason));
  });

  // 4) השורות למסד — עם הקישורים אצלנו בלבד
  const imageWarnings = new Map<number, ImportIssue[]>();
  const imageCounts = new Map<number, { saved: number; failed: number }>();
  const rpcRows = prepared.rows.map((row) => {
    if (blocked.has(row.row)) return { ...row, images: [], image_url: "" };
    const local: string[] = [];
    const warnings: ImportIssue[] = [];
    row.images.forEach((url, index) => {
      const ours = saved.get(url);
      if (ours) {
        if (!local.includes(ours)) local.push(ours);
        return;
      }
      warnings.push({
        row: row.row,
        name: row.name,
        // הקישור בכיווניות משמאל לימין בתוך הטקסט העברי (U+2066 … U+2069)
        message: `תמונה ${index + 1} דולגה (\u2066${shortUrl(url)}\u2069): ${failed.get(url) ?? "הורדת התמונה נכשלה"}`,
      });
    });
    imageWarnings.set(row.row, warnings);
    imageCounts.set(row.row, { saved: local.length, failed: warnings.length });
    return { ...row, images: local, image_url: local[0] ?? "" };
  });

  const { data, error } = await supabase.rpc("import_products", {
    _rows: rpcRows as unknown as Json,
  });
  if (error) throw new Error(error.message);

  const result = (data ?? {}) as Record<string, unknown>;
  summary.created = Number(result["created"] ?? 0);
  summary.failed = Number(result["failed"] ?? 0);
  summary.duplicates = Number(result["duplicates"] ?? 0);
  summary.skuReplaced = Number(result["sku_replaced"] ?? 0);
  summary.limitReached = result["limit_reached"] === true;
  summary.newCategories = ((result["new_categories"] as string[] | undefined) ?? []).filter(
    (name, index, list) => list.indexOf(name) === index,
  );
  summary.errors = issuesOf(result["errors"]).slice(0, IMPORT_MAX_LISTED);

  // אזהרות התמונות — רק במוצרים שנוצרו בפועל
  const failedRows = new Set(summary.errors.map((issue) => issue.row));
  const warnings: ImportIssue[] = [];
  for (const row of prepared.rows) {
    if (blocked.has(row.row) || failedRows.has(row.row)) continue;
    warnings.push(...(imageWarnings.get(row.row) ?? []));
    const counts = imageCounts.get(row.row);
    if (counts) {
      summary.images.saved += counts.saved;
      summary.images.failed += counts.failed;
    }
  }
  summary.warnings = [...issuesOf(result["warnings"]), ...warnings]
    .sort((a, b) => a.row - b.row)
    .slice(0, IMPORT_MAX_LISTED);
  return summary;
}
