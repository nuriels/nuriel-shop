/**
 * STORE-2: ייבוא שמזהה את המוצרים שכבר בחנות — החלק הטהור (דפדפן + שרת + בדיקות יחידה).
 *
 * הזרימה: הקובץ מפוענח (csv-import.ts) → בדיקה מול המוצרים בחנות (product_import_match במסד: לכל
 * שורה — חדש / קיים / לא חד-משמעי / לא תקין) → כאן: החלטה לכל שורה (planDecisions) לפי הבחירות של
 * המנהל, זיהוי כפילויות בתוך הקובץ, וסיכום מה ישתנה (summarizePlan) → הייבוא עצמו במנות → דוח שינויים
 * (reportCsv / reportStats). השרת בודק שוב כל החלטה — כאן רק מה שמוצג ונשלח.
 */
import type { ImportIssue, ImportRow } from "@/lib/csv-import";

/** מה לעשות במוצרים שכבר בחנות */
export type ExistingMode = "stock" | "stock_price" | "none";
/** מה לעשות במוצרים שבחנות ולא בקובץ */
export type MissingMode = "keep" | "zero" | "hide";
export type SyncOptions = { existing: ExistingMode; createNew: boolean; missing: MissingMode };

export type MatchKind = "barcode" | "sku" | "supplier_sku" | "name";
export type MatchStatus = "new" | "matched" | "ambiguous" | "invalid";

/** מוצר בחנות כפי שבדיקת ההתאמה מחזירה */
export type MatchProduct = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  stock: number;
  price: number;
  hidden: boolean;
  out_of_stock: boolean;
  serial: boolean;
  digital: boolean;
  price_editable: boolean;
  ordered: boolean;
};

export type MatchRow = {
  row: number;
  status: MatchStatus;
  kind: MatchKind | null;
  problem: string | null;
  /** כמה מוצרים בחנות מתאימים (במוצרים — עד 5 לתצוגה) */
  total: number;
  ids: string[];
  products: MatchProduct[];
};

export type MatchResult = { tiers: boolean; rows: MatchRow[] };

/** מה שנשלח לבדיקת ההתאמה (קריאה בלבד) */
export type MatchInputRow = {
  row: number;
  name: string;
  price: string;
  sku: string;
  barcode: string;
  stock: string;
};

export const MATCH_CHUNK = 400;

export function matchInput(row: ImportRow): MatchInputRow {
  return {
    row: row.row,
    name: row.name,
    price: row.price,
    sku: row.sku,
    barcode: row.barcode,
    stock: row.stock,
  };
}

/** כמו _product_import_name_key במסד: רווחים מכווצים, עד 200, אותיות קטנות */
export function nameKey(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 200).toLowerCase();
}

/** כמו _product_import_sku_key במסד: בלי רווחים, עד 100, אותיות קטנות */
export function skuKey(value: string): string {
  return value.replace(/\s+/g, "").slice(0, 100).toLowerCase();
}

/** בחירה לשורה: לדלג / מוצר חדש / מזהה של מוצר קיים לעדכן */
export type RowChoice = "skip" | "new" | (string & {});

/** ההחלטה לשורה כפי שנשלחת לשרת (product_import_apply) */
export type RowDecision = {
  row: number;
  action: "create" | "update" | "skip";
  product_id?: string;
  force_new?: boolean;
  match?: MatchKind | "chosen";
  candidates?: string[];
  reason?: string;
};

export type PlannedRow = {
  item: ImportRow;
  match: MatchRow | null;
  decision: RowDecision;
  /** המוצר שיעודכן (אם יש) */
  product: MatchProduct | null;
  /** שורה מוקדמת יותר בקובץ שהשורה הזו כפולה שלה */
  duplicateOf: number | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ברירת המחדל לשורה: קיים (מוצר אחד) — לעדכן; לא חד-משמעי — לדלג עד שבוחרים; חדש — להוסיף */
export function defaultChoice(match: MatchRow | null): RowChoice {
  if (!match || match.status === "new") return "new";
  if (match.status === "matched") return match.products[0]?.id ?? "skip";
  return "skip";
}

/**
 * ההחלטה לכל שורה בקובץ, לפי הסדר: שורה לא תקינה — מדלגים; אותו מוצר פעמיים בקובץ (או אותו מוצר
 * חדש פעמיים) — רק הראשונה; קיים — עדכון (או בחירה אחרת של המנהל); חדש — הוספה רק כשנבחר להוסיף.
 */
export function planDecisions(
  rows: ImportRow[],
  matches: ReadonlyMap<number, MatchRow>,
  options: Pick<SyncOptions, "createNew">,
  choices: Readonly<Record<number, RowChoice>> = {},
): PlannedRow[] {
  const targeted = new Map<string, number>();
  const newBarcodes = new Map<string, number>();
  const newSkus = new Map<string, number>();
  const newNames = new Map<string, { row: number; barcode: string }>();
  const plan: PlannedRow[] = [];

  for (const item of rows) {
    const match = matches.get(item.row) ?? null;
    const skip = (
      reason: string,
      extra: Partial<RowDecision> = {},
      duplicateOf: number | null = null,
    ) =>
      plan.push({
        item,
        match,
        decision: { row: item.row, action: "skip", reason, ...extra },
        product: null,
        duplicateOf,
      });

    if (!match) {
      skip("השורה לא נבדקה מול החנות");
      continue;
    }
    if (match.status === "invalid") {
      skip(match.problem ?? "שורה לא תקינה");
      continue;
    }

    const choice = choices[item.row] ?? defaultChoice(match);
    const candidates = match.ids.length > 0 ? match.ids : match.products.map((p) => p.id);

    if (match.status !== "new" && choice !== "new") {
      if (choice === "skip" || !UUID.test(choice) || !candidates.includes(choice)) {
        const first = candidates[0];
        skip(
          match.status === "ambiguous"
            ? "כמה מוצרים בחנות מתאימים — לא נבחר מוצר"
            : "נבחר לא לעדכן את המוצר הזה",
          match.status === "ambiguous" || !first ? { candidates } : { product_id: first },
        );
        continue;
      }
      const first = targeted.get(choice);
      if (first !== undefined) {
        skip(`כפילות בקובץ — אותו מוצר כמו בשורה ${first}`, { product_id: choice }, first);
        continue;
      }
      targeted.set(choice, item.row);
      plan.push({
        item,
        match,
        decision: {
          row: item.row,
          action: "update",
          product_id: choice,
          ...(match.status === "ambiguous" || choice !== candidates[0]
            ? { match: "chosen" as const }
            : match.kind
              ? { match: match.kind }
              : {}),
        },
        product: match.products.find((p) => p.id === choice) ?? null,
        duplicateOf: null,
      });
      continue;
    }

    // מוצר חדש (או "מוצר חדש" שנבחר במקום המוצר הקיים)
    if (!options.createNew) {
      skip("נבחר לא להוסיף מוצרים חדשים", match.status === "new" ? {} : { candidates });
      continue;
    }
    const barcode = item.barcode.trim();
    const sku = skuKey(item.sku);
    const name = nameKey(item.name);
    const sameBarcode = barcode ? newBarcodes.get(barcode) : undefined;
    const sameSku = sku ? newSkus.get(sku) : undefined;
    const sameName = newNames.get(name);
    const nameClash =
      sameName && !(barcode && sameName.barcode && barcode !== sameName.barcode)
        ? sameName.row
        : undefined;
    const firstRow = sameBarcode ?? sameSku ?? nameClash;
    if (firstRow !== undefined) {
      skip(`כפילות בקובץ — אותו מוצר כמו בשורה ${firstRow}`, {}, firstRow);
      continue;
    }
    if (barcode) newBarcodes.set(barcode, item.row);
    if (sku) newSkus.set(sku, item.row);
    if (!newNames.has(name)) newNames.set(name, { row: item.row, barcode });
    plan.push({
      item,
      match,
      decision: {
        row: item.row,
        action: "create",
        ...(match.status === "new" ? {} : { force_new: true }),
      },
      product: null,
      duplicateOf: null,
    });
  }
  return plan;
}

export type PlanSummary = {
  total: number;
  /** לפי בדיקת ההתאמה */
  status: Record<MatchStatus, number>;
  kinds: Record<MatchKind, number>;
  /** לפי ההחלטות */
  create: number;
  update: number;
  skip: number;
  fileDuplicates: number;
  /** במוצרים שיעודכנו (לפי הבחירה למוצרים קיימים) */
  stockChanges: number;
  stockUp: number;
  stockDown: number;
  toZero: number;
  noStockInFile: number;
  serialKept: number;
  priceChanges: number;
  priceLocked: number;
  /** מוצרים חדשים עם כמות 0 בקובץ (יסומנו "אזל") */
  newAtZero: number;
};

const isCount = (value: string) => /^\d{1,7}$/.test(value);

export function summarizePlan(plan: PlannedRow[], options: SyncOptions): PlanSummary {
  const summary: PlanSummary = {
    total: plan.length,
    status: { new: 0, matched: 0, ambiguous: 0, invalid: 0 },
    kinds: { barcode: 0, sku: 0, supplier_sku: 0, name: 0 },
    create: 0,
    update: 0,
    skip: 0,
    fileDuplicates: 0,
    stockChanges: 0,
    stockUp: 0,
    stockDown: 0,
    toZero: 0,
    noStockInFile: 0,
    serialKept: 0,
    priceChanges: 0,
    priceLocked: 0,
    newAtZero: 0,
  };
  for (const { item, match, decision, product, duplicateOf } of plan) {
    if (match) {
      summary.status[match.status] += 1;
      if (match.status === "matched" && match.kind) summary.kinds[match.kind] += 1;
    }
    if (duplicateOf !== null) summary.fileDuplicates += 1;
    summary[
      decision.action === "create" ? "create" : decision.action === "update" ? "update" : "skip"
    ] += 1;

    if (decision.action === "create" && isCount(item.stock) && Number(item.stock) === 0)
      summary.newAtZero += 1;
    if (decision.action !== "update" || !product || options.existing === "none") continue;

    if (!isCount(item.stock)) summary.noStockInFile += 1;
    else if (product.serial) summary.serialKept += 1;
    else {
      const next = Number(item.stock);
      if (next !== product.stock) {
        summary.stockChanges += 1;
        if (next > product.stock) summary.stockUp += 1;
        else summary.stockDown += 1;
      }
      if (next === 0 && (product.stock > 0 || !product.out_of_stock)) summary.toZero += 1;
    }
    if (
      options.existing === "stock_price" &&
      item.price !== "" &&
      Number(item.price) !== Number(product.price)
    ) {
      if (product.price_editable) summary.priceChanges += 1;
      else summary.priceLocked += 1;
    }
  }
  return summary;
}

/** המוצרים בחנות שנחשבים "בקובץ" — כל מה שאינו כאן נחשב "לא בקובץ" */
export function presentProductIds(plan: PlannedRow[]): string[] {
  const ids = new Set<string>();
  for (const { decision } of plan) {
    if (decision.product_id) ids.add(decision.product_id);
    for (const id of decision.candidates ?? []) ids.add(id);
  }
  return [...ids];
}

/** סיכום של מנה אחת בייבוא (מהשרת), או של כל הקובץ (מצטבר בדפדפן) */
export type SyncBatchSummary = {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  limitReached: boolean;
  newCategories: string[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
  images: { saved: number; failed: number };
};

export function emptySyncSummary(): SyncBatchSummary {
  return {
    total: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    limitReached: false,
    newCategories: [],
    errors: [],
    warnings: [],
    images: { saved: 0, failed: 0 },
  };
}

/** צירוף סיכום של מנה לסיכום הכולל (רשימות — עד 300) */
export function mergeSyncSummary(
  total: SyncBatchSummary,
  batch: SyncBatchSummary,
): SyncBatchSummary {
  const capped = <T>(list: T[], more: T[]) =>
    list.length >= 300 ? list : [...list, ...more].slice(0, 300);
  return {
    total: total.total + batch.total,
    created: total.created + batch.created,
    updated: total.updated + batch.updated,
    unchanged: total.unchanged + batch.unchanged,
    skipped: total.skipped + batch.skipped,
    failed: total.failed + batch.failed,
    limitReached: total.limitReached || batch.limitReached,
    newCategories: [
      ...total.newCategories,
      ...batch.newCategories.filter((n) => !total.newCategories.includes(n)),
    ],
    errors: capped(total.errors, batch.errors),
    warnings: capped(total.warnings, batch.warnings),
    images: {
      saved: total.images.saved + batch.images.saved,
      failed: total.images.failed + batch.images.failed,
    },
  };
}

// ------------------------------------------------------------
// דוח השינויים
// ------------------------------------------------------------
export type ChangeAction =
  "created" | "updated" | "unchanged" | "zeroed" | "hidden" | "skipped" | "failed";

/** ערכים שנשמרו לפני / אחרי (מלאי, מחיר, "אזל", מוסתר) */
export type ChangeValues = Record<string, string | number | boolean | null>;

export type ReportRow = {
  row: number | null;
  action: ChangeAction;
  product_id: string | null;
  name: string;
  sku: string | null;
  match: string | null;
  before: ChangeValues;
  after: ChangeValues;
  message: string | null;
  undone: string | null;
  undo_message: string | null;
};

export type ImportInfo = {
  id: string;
  file_name: string;
  options: { existing: ExistingMode; create_new: boolean; missing: MissingMode };
  expected_rows: number;
  status: "running" | "done" | "undone";
  created_at: string;
  finished_at: string | null;
  undone_at: string | null;
  new_categories: string[];
  counts: Partial<Record<ChangeAction, number>> & { missing_applied?: boolean };
};

export type ImportReport = { import: ImportInfo; rows: ReportRow[] };

export const ACTION_LABEL: Record<ChangeAction, string> = {
  created: "נוסף",
  updated: "עודכן",
  unchanged: "ללא שינוי",
  zeroed: "לא בקובץ — המלאי אופס",
  hidden: "לא בקובץ — הוסתר מהאתר",
  skipped: "דולג",
  failed: "לא בוצע",
};

export const UNDO_LABEL: Record<string, string> = {
  restored: "שוחזר",
  deleted: "נמחק",
  hidden: "הוסתר (כבר הוזמן)",
  conflict: "לא שוחזר — השתנה מאז",
  skipped: "לא נדרש",
};

export const MATCH_LABEL: Record<string, string> = {
  barcode: "ברקוד",
  sku: 'מק"ט',
  supplier_sku: 'מק"ט ספק',
  name: "שם",
  chosen: "נבחר ידנית",
};

const num = (value: unknown): number | null =>
  typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : null;

export function stockBefore(row: ReportRow): number | null {
  return num(row.before["stock"]);
}
export function stockAfter(row: ReportRow): number | null {
  return num(row.after["stock"]);
}

export type ReportStats = {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
  zeroed: number;
  hidden: number;
  stockUp: number;
  stockDown: number;
  toZero: number;
  priceChanged: number;
};

export function reportStats(rows: ReportRow[]): ReportStats {
  const stats: ReportStats = {
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    zeroed: 0,
    hidden: 0,
    stockUp: 0,
    stockDown: 0,
    toZero: 0,
    priceChanged: 0,
  };
  for (const row of rows) {
    stats[row.action] += 1;
    if (row.action !== "updated") continue;
    const before = stockBefore(row);
    const after = stockAfter(row);
    if (before !== null && after !== null) {
      if (after > before) stats.stockUp += 1;
      if (after < before) stats.stockDown += 1;
      if (after === 0 && before > 0) stats.toZero += 1;
    }
    if (row.after["price"] !== undefined) stats.priceChanged += 1;
  }
  return stats;
}

const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

/** הדוח כ-CSV (לאקסל: ה-BOM מתווסף בהורדה) */
export function reportCsv(rows: ReportRow[]): string {
  const header = [
    "שורה בקובץ",
    "מוצר",
    'מק"ט',
    "מה קרה",
    "זוהה לפי",
    "מלאי לפני",
    "מלאי אחרי",
    "שינוי במלאי",
    "מחיר לפני",
    "מחיר אחרי",
    "הערה",
    "ביטול",
  ];
  const lines = rows.map((row) => {
    const before = stockBefore(row);
    const after = stockAfter(row);
    const delta = before !== null && after !== null ? after - before : null;
    return [
      row.row ?? "",
      row.name,
      row.sku ?? "",
      ACTION_LABEL[row.action] ?? row.action,
      row.match ? (MATCH_LABEL[row.match] ?? row.match) : "",
      before ?? "",
      after ?? "",
      delta === null ? "" : delta > 0 ? `+${delta}` : String(delta),
      row.before["price"] ?? "",
      row.after["price"] ?? "",
      row.message ?? "",
      row.undone
        ? `${UNDO_LABEL[row.undone] ?? row.undone}${row.undo_message ? ` — ${row.undo_message}` : ""}`
        : "",
    ]
      .map(csvCell)
      .join(",");
  });
  return [header.map(csvCell).join(","), ...lines].join("\r\n");
}
