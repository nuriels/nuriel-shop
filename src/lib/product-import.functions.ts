import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { BATCH_MAX_RAW_ROWS, type ImportSummary } from "@/lib/csv-import";

/**
 * ייבוא קטלוג מוצרים מ-CSV — Server Action (חלק 14, שודרג בחלק 18).
 *
 * הדפדפן מפענח את הקובץ (לתצוגה המקדימה), מחלק אותו למנות קטנות
 * (planImportBatches) ושולח כל מנה בנפרד: שורת הכותרות + השורות הגולמיות
 * של המנה + מספר השורה הראשונה בקובץ. בשרת (src/server/services/csv-import.ts)
 * השורות מפוענחות מחדש, התמונות יורדות במקביל ונשמרות ב-Storage של החנות,
 * והמסד (import_products) יוצר את המוצרים ואת הקטגוריות החסרות.
 *
 * מנה קטנה = תשובה מהירה (התקדמות אמיתית בדפדפן), ואפשר לעצור / להמשיך
 * באמצע בלי לייבא פעמיים. רק מנהל החנות — נבדק כאן לפני שמורידים תמונות,
 * ושוב במסד.
 */

export type { ImportIssue, ImportSummary } from "@/lib/csv-import";

export type ImportBatchInput = {
  headers: string[];
  rows: string[][];
  firstRow: number;
  fileName?: string;
};

/** גודל מרבי של תא (תיאור HTML ארוך מחנות אחרת) */
const MAX_CELL = 100_000;
const MAX_COLUMNS = 300;
/** כל המנה — כמו ה-JSON שמגיע לשרת */
const MAX_BATCH_CHARS = 2_000_000;

function cleanCells(value: unknown, what: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${what} לא תקינה`);
  if (value.length > MAX_COLUMNS) throw new Error(`יותר מדי עמודות בקובץ (עד ${MAX_COLUMNS})`);
  return value.map((cell) => {
    const text = typeof cell === "string" ? cell : cell == null ? "" : String(cell);
    if (text.length > MAX_CELL) throw new Error("תא ארוך מדי בקובץ");
    return text;
  });
}

export const importProductsBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ImportBatchInput) => {
    const headers = cleanCells(input?.headers, "שורת הכותרות");
    if (headers.every((header) => header.trim() === "")) throw new Error("לא נמצאה שורת כותרות");
    if (!Array.isArray(input?.rows) || input.rows.length === 0) throw new Error("המנה ריקה");
    if (input.rows.length > BATCH_MAX_RAW_ROWS) {
      throw new Error(`עד ${BATCH_MAX_RAW_ROWS} שורות בכל מנה`);
    }
    const rows = input.rows.map((row) => cleanCells(row, "שורה"));
    const size = rows.reduce((sum, row) => sum + row.reduce((s, cell) => s + cell.length, 0), 0);
    if (size > MAX_BATCH_CHARS) throw new Error("המנה גדולה מדי");
    const firstRow = Number(input?.firstRow);
    if (!Number.isInteger(firstRow) || firstRow < 2 || firstRow > 10_000_000) {
      throw new Error("מספר שורה לא תקין");
    }
    return {
      headers,
      rows,
      firstRow,
      fileName: String(input?.fileName ?? "").slice(0, 200),
    };
  })
  .handler(async ({ data, context }): Promise<ImportSummary> => {
    const { loadCaller } = await import("@/lib/caller.server");
    const caller = await loadCaller(context.userId);
    if (caller.role !== "admin") throw new Error("רק מנהל החנות יכול לייבא מוצרים");

    const { allowAction } = await import("@/lib/rate-limit.server");
    // עד 1,200 מנות בשעה (~12,000 מוצרים) — מעבר לזה זה כבר לא ייבוא של קובץ
    if (!allowAction(`product-import-batch:${context.userId}`, 1200, 60 * 60 * 1000)) {
      throw new Error("יותר מדי ייבואים בשעה האחרונה — נסו שוב מאוחר יותר");
    }

    const { importCsvBatch } = await import("@/server/services/csv-import");
    const started = Date.now();
    const summary = await importCsvBatch(
      { headers: data.headers, rows: data.rows, firstRow: data.firstRow },
      context.supabase,
    );
    console.info(
      "[product-import]",
      JSON.stringify({
        user: context.userId,
        file: data.fileName,
        firstRow: data.firstRow,
        total: summary.total,
        created: summary.created,
        failed: summary.failed,
        images: summary.images,
        ms: Date.now() - started,
      }),
    );
    return summary;
  });
