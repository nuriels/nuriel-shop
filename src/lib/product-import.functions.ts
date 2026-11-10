import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { BATCH_MAX_RAW_ROWS, type ImportSummary } from "@/lib/csv-import";
import type {
  ImportInfo,
  ImportReport,
  MatchInputRow,
  MatchResult,
  RowDecision,
  SyncBatchSummary,
  SyncOptions,
} from "@/lib/product-import-sync";

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

// ============================================================
// STORE-2: ייבוא שמזהה מוצרים קיימים — בדיקה מול החנות, ייבוא לפי בחירה, דוח וביטול.
// כל פעולה: רק מנהל החנות (נבדק כאן ושוב במסד), מגבלת קצב, ושורת [product-import] ביומן.
// ============================================================
export type {
  ImportInfo,
  ImportReport,
  MatchInputRow,
  MatchResult,
  RowDecision,
  SyncBatchSummary,
  SyncOptions,
} from "@/lib/product-import-sync";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MATCH_MAX_ROWS = 400;
const DECISION_ACTIONS = new Set(["create", "update", "skip"]);
const MATCH_KINDS = new Set(["barcode", "sku", "supplier_sku", "name", "chosen"]);

function uuidOf(value: unknown, what: string): string {
  const text = String(value ?? "").trim();
  if (!UUID.test(text)) throw new Error(`${what} לא תקין`);
  return text.toLowerCase();
}

function text(value: unknown, max: number): string {
  return (typeof value === "string" ? value : value == null ? "" : String(value)).slice(0, max);
}

async function adminOnly(userId: string, action: string, limit: number) {
  const { loadCaller } = await import("@/lib/caller.server");
  const caller = await loadCaller(userId);
  if (caller.role !== "admin") throw new Error("רק מנהל החנות יכול לייבא מוצרים");
  const { allowAction } = await import("@/lib/rate-limit.server");
  if (!allowAction(`product-import-${action}:${userId}`, limit, 60 * 60 * 1000)) {
    throw new Error("יותר מדי פעולות ייבוא בשעה האחרונה — נסו שוב מאוחר יותר");
  }
}

function logImport(entry: Record<string, unknown>) {
  console.info("[product-import]", JSON.stringify(entry));
}

/** בדיקה מול המוצרים בחנות (קריאה בלבד) — עד 400 שורות בכל קריאה */
export const matchProductsBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { rows: MatchInputRow[] }) => {
    if (!Array.isArray(input?.rows) || input.rows.length === 0) throw new Error("אין שורות לבדיקה");
    if (input.rows.length > MATCH_MAX_ROWS) throw new Error(`עד ${MATCH_MAX_ROWS} שורות בכל בדיקה`);
    return {
      rows: input.rows.map((row) => {
        const number = Number(row?.row);
        if (!Number.isInteger(number) || number < 2 || number > 10_000_000) {
          throw new Error("מספר שורה לא תקין");
        }
        return {
          row: number,
          name: text(row?.name, 300),
          price: text(row?.price, 40),
          sku: text(row?.sku, 120),
          barcode: text(row?.barcode, 80),
          stock: text(row?.stock, 20),
        };
      }),
    };
  })
  .handler(async ({ data, context }): Promise<MatchResult> => {
    await adminOnly(context.userId, "match", 600);
    const started = Date.now();
    const { data: result, error } = await context.supabase.rpc("product_import_match", {
      _rows: data.rows as unknown as Json,
    });
    if (error) throw new Error(error.message);
    const match = (result ?? { tiers: false, rows: [] }) as unknown as MatchResult;
    logImport({
      op: "match",
      user: context.userId,
      rows: data.rows.length,
      ms: Date.now() - started,
    });
    return match;
  });

/** כמה מוצרים בחנות לא בקובץ ישתנו (איפוס / הסתרה), עם דוגמאות */
export const productImportMissingCount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { present: string[]; missing: "zero" | "hide" }) => {
    if (input?.missing !== "zero" && input?.missing !== "hide") throw new Error("בחירה לא תקינה");
    if (!Array.isArray(input.present) || input.present.length > 20_000)
      throw new Error("רשימה לא תקינה");
    return { present: input.present.map((id) => uuidOf(id, "מזהה מוצר")), missing: input.missing };
  })
  .handler(async ({ data, context }): Promise<{ count: number; sample: string[] }> => {
    await adminOnly(context.userId, "missing", 300);
    const { data: result, error } = await context.supabase.rpc("product_import_missing_count", {
      _present: data.present,
      _missing: data.missing,
    });
    if (error) throw new Error(error.message);
    const value = (result ?? {}) as { count?: number; sample?: string[] };
    return {
      count: Number(value.count ?? 0),
      sample: Array.isArray(value.sample) ? value.sample : [],
    };
  });

/** פתיחת יבוא: הבחירות של המנהל + כמה שורות מוצרים בקובץ */
export const beginProductImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { fileName?: string; options: SyncOptions; expectedRows: number }) => {
    const options = input?.options;
    if (
      !options ||
      !["stock", "stock_price", "none"].includes(options.existing) ||
      typeof options.createNew !== "boolean" ||
      !["keep", "zero", "hide"].includes(options.missing)
    ) {
      throw new Error("בחרו מה לעשות במוצרים שכבר קיימים, במוצרים חדשים ובמוצרים שלא בקובץ");
    }
    const expectedRows = Number(input.expectedRows);
    if (!Number.isInteger(expectedRows) || expectedRows < 1 || expectedRows > 5000) {
      throw new Error("מספר המוצרים בקובץ לא תקין");
    }
    return {
      fileName: text(input.fileName, 200),
      options: {
        existing: options.existing,
        createNew: options.createNew,
        missing: options.missing,
      },
      expectedRows,
    };
  })
  .handler(async ({ data, context }): Promise<{ importId: string }> => {
    await adminOnly(context.userId, "begin", 120);
    const { data: id, error } = await context.supabase.rpc("product_import_begin", {
      _file_name: data.fileName,
      _options: {
        existing: data.options.existing,
        create_new: data.options.createNew,
        missing: data.options.missing,
      } as unknown as Json,
      _expected_rows: data.expectedRows,
    });
    if (error) throw new Error(error.message);
    const importId = uuidOf(id, "היבוא");
    logImport({
      op: "begin",
      user: context.userId,
      import: importId,
      file: data.fileName,
      ...data.options,
      rows: data.expectedRows,
    });
    return { importId };
  });

/** מנה של הייבוא: השורות הגולמיות (השרת מפענח מחדש) + ההחלטה לכל שורה */
export const applyProductImportBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ImportBatchInput & { importId: string; decisions: RowDecision[] }) => {
    const importId = uuidOf(input?.importId, "היבוא");
    const headers = cleanCells(input?.headers, "שורת הכותרות");
    if (!Array.isArray(input?.rows) || input.rows.length === 0) throw new Error("המנה ריקה");
    if (input.rows.length > BATCH_MAX_RAW_ROWS)
      throw new Error(`עד ${BATCH_MAX_RAW_ROWS} שורות בכל מנה`);
    const rows = input.rows.map((row) => cleanCells(row, "שורה"));
    const size = rows.reduce((sum, row) => sum + row.reduce((s, cell) => s + cell.length, 0), 0);
    if (size > MAX_BATCH_CHARS) throw new Error("המנה גדולה מדי");
    const firstRow = Number(input?.firstRow);
    if (!Number.isInteger(firstRow) || firstRow < 2 || firstRow > 10_000_000) {
      throw new Error("מספר שורה לא תקין");
    }
    if (!Array.isArray(input?.decisions) || input.decisions.length > BATCH_MAX_RAW_ROWS) {
      throw new Error("ההחלטות לשורות לא תקינות");
    }
    const decisions: RowDecision[] = input.decisions.map((raw) => {
      const row = Number(raw?.row);
      if (!Number.isInteger(row) || row < 2 || row > 10_000_000)
        throw new Error("מספר שורה לא תקין");
      if (!DECISION_ACTIONS.has(raw?.action)) throw new Error("פעולה לא תקינה לשורה");
      const decision: RowDecision = { row, action: raw.action };
      if (raw.product_id !== undefined && raw.product_id !== null && raw.product_id !== "") {
        decision.product_id = uuidOf(raw.product_id, "מזהה מוצר");
      }
      if (raw.force_new === true) decision.force_new = true;
      if (raw.match !== undefined && MATCH_KINDS.has(raw.match)) decision.match = raw.match;
      if (Array.isArray(raw.candidates)) {
        decision.candidates = raw.candidates.slice(0, 50).map((id) => uuidOf(id, "מזהה מוצר"));
      }
      if (typeof raw.reason === "string" && raw.reason.trim())
        decision.reason = raw.reason.slice(0, 300);
      return decision;
    });
    return { importId, headers, rows, firstRow, decisions, fileName: text(input?.fileName, 200) };
  })
  .handler(async ({ data, context }): Promise<SyncBatchSummary> => {
    // כמו הייבוא הקודם: עד 1,200 מנות בשעה (~12,000 מוצרים)
    await adminOnly(context.userId, "batch", 1200);
    const { applySyncBatch } = await import("@/server/services/csv-import");
    const started = Date.now();
    const summary = await applySyncBatch(
      {
        importId: data.importId,
        headers: data.headers,
        rows: data.rows,
        firstRow: data.firstRow,
        decisions: data.decisions,
      },
      context.supabase,
    );
    logImport({
      op: "batch",
      user: context.userId,
      import: data.importId,
      file: data.fileName,
      firstRow: data.firstRow,
      total: summary.total,
      created: summary.created,
      updated: summary.updated,
      unchanged: summary.unchanged,
      skipped: summary.skipped,
      failed: summary.failed,
      images: summary.images,
      ms: Date.now() - started,
    });
    return summary;
  });

/** סיום: מוצרים שלא בקובץ — רק עם המספר שהמנהל ראה ואישר (null = לא לגעת בהם) */
export const finishProductImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { importId: string; confirmMissing: number | null }) => {
    const importId = uuidOf(input?.importId, "היבוא");
    const confirm = input?.confirmMissing;
    if (confirm !== null && (!Number.isInteger(confirm) || confirm < 0 || confirm > 1_000_000)) {
      throw new Error("מספר לא תקין");
    }
    return { importId, confirmMissing: confirm };
  })
  .handler(async ({ data, context }): Promise<ImportInfo> => {
    await adminOnly(context.userId, "finish", 120);
    const { data: result, error } = await context.supabase.rpc("product_import_finish", {
      _import: data.importId,
      _confirm_missing: data.confirmMissing,
    });
    if (error) throw new Error(error.message);
    const info = result as unknown as ImportInfo;
    logImport({
      op: "finish",
      user: context.userId,
      import: data.importId,
      counts: info?.counts ?? null,
    });
    return info;
  });

/** דוח השינויים של יבוא */
export const productImportReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { importId: string }) => ({ importId: uuidOf(input?.importId, "היבוא") }))
  .handler(async ({ data, context }): Promise<ImportReport> => {
    await adminOnly(context.userId, "report", 300);
    const { data: result, error } = await context.supabase.rpc("product_import_report", {
      _import: data.importId,
    });
    if (error) throw new Error(error.message);
    return result as unknown as ImportReport;
  });

/** היבואים האחרונים של החנות (עד 10) */
export const recentProductImports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ImportInfo[]> => {
    await adminOnly(context.userId, "recent", 600);
    const { data, error } = await context.supabase.rpc("product_imports_recent");
    if (error) throw new Error(error.message);
    return (Array.isArray(data) ? data : []) as unknown as ImportInfo[];
  });

export type UndoResult = {
  deleted: number;
  hidden: number;
  restored: number;
  conflicts: number;
  gone: number;
  categories_removed: number;
  rows: { row: number | null; name: string; message: string | null }[];
};

/** ביטול יבוא: מה שנוסף — נמחק (או מוסתר אם הוזמן); מה שעודכן — חוזר למה שהיה */
export const undoProductImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { importId: string }) => ({ importId: uuidOf(input?.importId, "היבוא") }))
  .handler(async ({ data, context }): Promise<UndoResult> => {
    await adminOnly(context.userId, "undo", 60);
    const { data: result, error } = await context.supabase.rpc("product_import_undo", {
      _import: data.importId,
    });
    if (error) throw new Error(error.message);
    const undo = result as unknown as UndoResult;
    logImport({
      op: "undo",
      user: context.userId,
      import: data.importId,
      deleted: undo?.deleted,
      hidden: undo?.hidden,
      restored: undo?.restored,
      conflicts: undo?.conflicts,
    });
    return undo;
  });
