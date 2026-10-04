import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  CSV_MAX_BYTES,
  CSV_MAX_ROWS,
  IMPORT_CHUNK,
  fieldLabel,
  parseCsv,
  prepareImport,
  type SkippedRow,
} from "@/lib/csv-import";

/**
 * ייבוא קטלוג מוצרים מ-CSV (חלק 14) — Server Action.
 *
 * מקבל את תוכן הקובץ (טקסט; הדפדפן כבר פענח UTF-8 / Windows-1255), מפענח
 * אותו כאן מחדש (לא סומכים על התצוגה המקדימה של הדפדפן), ושולח את השורות
 * למסד במנות של 250: import_products יוצר מוצרים חדשים בחנות הנוכחית — רק
 * למנהל החנות, עם מגבלת המוצרים של החבילה. שורה שגויה נרשמת ולא עוצרת
 * את השאר. מוצר שהברקוד / המק"ט שלו כבר קיים — לא נדרס.
 */

export type ImportIssue = { row: number; name: string; message: string };

export type ImportSummary = {
  total: number;
  created: number;
  failed: number;
  duplicates: number;
  skuReplaced: number;
  limitReached: boolean;
  newCategories: string[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
  skipped: SkippedRow[];
};

const MAX_LISTED = 300;

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

export const importProductsCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { csv: string; fileName?: string }) => {
    const csv = String(input?.csv ?? "");
    if (csv.trim() === "") throw new Error("הקובץ ריק");
    if (csv.length > CSV_MAX_BYTES) throw new Error("הקובץ גדול מדי (עד 5MB)");
    return { csv, fileName: String(input?.fileName ?? "").slice(0, 200) };
  })
  .handler(async ({ data, context }): Promise<ImportSummary> => {
    const { allowAction } = await import("@/lib/rate-limit.server");
    if (!allowAction(`product-import:${context.userId}`, 10, 60 * 60 * 1000)) {
      throw new Error("יותר מדי ייבואים בשעה האחרונה — נסו שוב מאוחר יותר");
    }

    const table = parseCsv(data.csv);
    if (table.headers.length === 0) throw new Error("לא נמצאה שורת כותרות בקובץ");
    const prepared = prepareImport(table);
    if (prepared.missing.length > 0) {
      throw new Error(
        `חסרות עמודות חובה: ${prepared.missing.map(fieldLabel).join(", ")}. בדקו ששורת הכותרות תואמת לקובץ הדוגמה.`,
      );
    }
    if (prepared.rows.length === 0) throw new Error("לא נמצאו בקובץ שורות מוצרים");
    if (prepared.rows.length > CSV_MAX_ROWS) {
      throw new Error(
        `עד ${CSV_MAX_ROWS.toLocaleString("he-IL")} מוצרים בקובץ אחד — פצלו לכמה קבצים`,
      );
    }

    const summary: ImportSummary = {
      total: prepared.rows.length,
      created: 0,
      failed: 0,
      duplicates: 0,
      skuReplaced: 0,
      limitReached: false,
      newCategories: [],
      errors: [],
      warnings: [],
      skipped: prepared.skipped.slice(0, MAX_LISTED),
    };

    for (let start = 0; start < prepared.rows.length; start += IMPORT_CHUNK) {
      const chunk = prepared.rows.slice(start, start + IMPORT_CHUNK);
      if (summary.limitReached) {
        summary.failed += chunk.length;
        continue;
      }
      const { data: result, error } = await context.supabase.rpc("import_products", {
        _rows: chunk,
      });
      if (error) {
        // תקלה בכל המנה (הרשאה / חיבור) — עוצרים ומדווחים מה כבר נוצר
        if (summary.created === 0) throw new Error(error.message);
        summary.failed += prepared.rows.length - start;
        summary.errors.push({
          row: chunk[0]?.row ?? 0,
          name: "",
          message: `הייבוא נעצר: ${error.message}`,
        });
        break;
      }
      const row = (result ?? {}) as Record<string, unknown>;
      summary.created += Number(row["created"] ?? 0);
      summary.failed += Number(row["failed"] ?? 0);
      summary.duplicates += Number(row["duplicates"] ?? 0);
      summary.skuReplaced += Number(row["sku_replaced"] ?? 0);
      summary.limitReached ||= row["limit_reached"] === true;
      for (const name of (row["new_categories"] as string[] | undefined) ?? []) {
        if (!summary.newCategories.includes(name)) summary.newCategories.push(name);
      }
      if (summary.errors.length < MAX_LISTED) {
        summary.errors.push(
          ...issuesOf(row["errors"]).slice(0, MAX_LISTED - summary.errors.length),
        );
      }
      if (summary.warnings.length < MAX_LISTED) {
        summary.warnings.push(
          ...issuesOf(row["warnings"]).slice(0, MAX_LISTED - summary.warnings.length),
        );
      }
    }

    console.info(
      "[product-import]",
      JSON.stringify({
        user: context.userId,
        file: data.fileName,
        total: summary.total,
        created: summary.created,
        failed: summary.failed,
      }),
    );
    return summary;
  });
