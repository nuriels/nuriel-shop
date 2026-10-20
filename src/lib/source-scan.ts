/**
 * חלק 44: "סריקת אתר מקור" — לוגיקה טהורה (בלי רשת ובלי מסד), משותפת לדפדפן ולשרת
 * ונבדקת ביחידה: טיפוסים, נרמול, זיהוי התאמה בין מוצר שנסרק למוצר בחנות, וחישוב ההבדלים.
 *
 * עקרונות:
 *  - התאמה "ודאית" רק לפי ברקוד או מק"ט. שם דומה בלבד = "לא ודאי" — מוצג לאישור ידני.
 *  - מלאי מושווה רק כשאתר המקור מספק כמות מפורשת (מספר). "במלאי / אזל" אינו כמות.
 *  - הסריקה לא משנה כלום; ההבדלים רק מוצגים לאישור.
 */

export const SCAN_MAX_PRODUCTS = 300;
export const SCAN_MAX_LISTING_PAGES = 25;
export const SCAN_BATCH_SIZE = 6;

/** מוצר כפי שנקרא מאתר המקור (נתונים שאפשר לקרוא בלבד — כל השדות פרט לשם / כתובת הם רשות) */
export type SourceProduct = {
  /** עמוד המוצר באתר המקור — גם המזהה היציב של השורה */
  url: string;
  name: string;
  price: number | null;
  sku: string | null;
  barcode: string | null;
  /** טקסט נקי (בלי HTML), עד 1,500 תווים */
  description: string;
  image: string | null;
  images: string[];
  category: string | null;
  /** כמות מלאי — רק אם האתר מציג מספר מפורש (לא "במלאי" ולא מספר תוצאות) */
  stock: number | null;
  availability: "in_stock" | "out_of_stock" | null;
};

/** מוצר בחנות הפעילה — רק השדות להשוואה */
export type LocalProduct = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  price_tier1: number;
  description: string | null;
  image_url: string | null;
  category: string;
  stock_quantity: number;
  uniform_price: boolean;
};

export type DiffField =
  "name" | "price" | "description" | "image" | "barcode" | "category" | "stock";

export const DIFF_LABEL: Record<DiffField, string> = {
  name: "שם",
  price: "מחיר",
  description: "תיאור",
  image: "תמונה",
  barcode: "ברקוד",
  category: "קטגוריה",
  stock: "מלאי",
};

export type ScanDiff = {
  field: DiffField;
  current: string;
  found: string;
  /** אפשר לאשר עדכון של השדה (לא ניתן, למשל: קטגוריה שאינה קיימת בחנות) */
  applicable: boolean;
  note?: string;
};

export type MatchBy = "barcode" | "sku" | "name";

export type ScanRow = {
  /** כתובת המוצר במקור */
  key: string;
  kind: "new" | "changed" | "unchanged" | "uncertain";
  source: SourceProduct;
  match: { productId: string; name: string; sku: string; by: MatchBy } | null;
  diffs: ScanDiff[];
  /** מוצר חדש שאי אפשר להוסיף (למשל: אין מחיר) */
  blocked?: string;
  /** "לא ודאי" — מידת הדמיון בשם (0–1) */
  score?: number;
  /** הערה על מלאי: למה הוא לא מושווה */
  stockNote?: string;
};

export type ScanSummary = {
  scanned: number;
  newCount: number;
  changed: number;
  unchanged: number;
  uncertain: number;
  duplicatesInSource: number;
};

// ---------------------------------------------------------------- נרמול

const INVISIBLE = /[\u200e\u200f\u202a-\u202e\u2066-\u2069\u00a0]/g;

/** טקסט להשוואה: בלי כיווניות, רווחים כפולים, אותיות קטנות */
export function normText(value: string | null | undefined): string {
  return (value ?? "").replace(INVISIBLE, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/** HTML → טקסט נקי (לתיאור המקומי, שנשמר כ-HTML) */
export function plainFromHtml(html: string | null | undefined): string {
  return (html ?? "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** מק"ט להשוואה: רווחים וכיווניות מוסרים, אותיות גדולות. פחות מ-2 תווים = אין מזהה */
export function normSku(value: string | null | undefined): string | null {
  const text = (value ?? "").replace(INVISIBLE, "").replace(/\s+/g, "").toUpperCase();
  return text.length >= 2 && text.length <= 64 ? text : null;
}

/** ברקוד (GTIN / EAN / UPC): ספרות בלבד, 8–14. מחרוזת אחרת = אין מזהה */
export function normBarcode(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 14 ? digits : null;
}

const STOP_WORDS = new Set(["של", "עם", "את", "the", "and", "for", "with", "ל", "ו"]);

function tokens(name: string): Set<string> {
  return new Set(
    normText(name)
      .replace(/[^\p{L}\p{N} ]/gu, " ")
      .split(" ")
      .filter((word) => word.length > 1 && !STOP_WORDS.has(word)),
  );
}

/** דמיון בין שמות (0–1): שם זהה = 1, אחרת מקדם ג'אקארד על המילים */
export function nameSimilarity(a: string, b: string): number {
  if (normText(a) === normText(b) && normText(a) !== "") return 1;
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** מעל הסף הזה מציעים התאמה אפשרית לאישור ידני (לא מעדכנים אוטומטית) */
export const NAME_CANDIDATE_THRESHOLD = 0.75;

// ---------------------------------------------------------------- כפילויות במקור

/** מסיר כפילויות בתוצאות הסריקה (אותה כתובת / אותו ברקוד / אותו מק"ט); מחזיר גם כמה הוסרו */
export function dedupeSource(products: SourceProduct[]): {
  products: SourceProduct[];
  removed: number;
} {
  const seenUrl = new Set<string>();
  const seenBarcode = new Set<string>();
  const seenSku = new Set<string>();
  const kept: SourceProduct[] = [];
  for (const product of products) {
    const url = product.url.replace(/#.*$/, "");
    const barcode = normBarcode(product.barcode);
    const sku = normSku(product.sku);
    if (
      seenUrl.has(url) ||
      (barcode !== null && seenBarcode.has(barcode)) ||
      (sku !== null && seenSku.has(sku))
    ) {
      continue;
    }
    seenUrl.add(url);
    if (barcode) seenBarcode.add(barcode);
    if (sku) seenSku.add(sku);
    kept.push(product);
  }
  return { products: kept, removed: products.length - kept.length };
}

// ---------------------------------------------------------------- השוואה

const PRICE_EPSILON = 0.005;
const fmtPrice = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const clip = (text: string, max = 220) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** ההבדלים בין מוצר שהותאם (ודאי או אפשרי) למוצר שנסרק */
export function diffProduct(
  local: LocalProduct,
  source: SourceProduct,
  storeCategories: ReadonlySet<string>,
): { diffs: ScanDiff[]; stockNote?: string | undefined } {
  const diffs: ScanDiff[] = [];

  if (source.name && normText(source.name) !== normText(local.name)) {
    diffs.push({ field: "name", current: local.name, found: source.name, applicable: true });
  }

  if (
    source.price !== null &&
    Math.abs(source.price - Number(local.price_tier1)) >= PRICE_EPSILON
  ) {
    diffs.push({
      field: "price",
      current: fmtPrice(Number(local.price_tier1)),
      found: fmtPrice(source.price),
      applicable: true,
    });
  }

  const localText = plainFromHtml(local.description);
  const sourceText = source.description.trim();
  if (sourceText !== "" && normText(localText) !== normText(sourceText)) {
    diffs.push({
      field: "description",
      current: localText === "" ? "(ריק)" : clip(localText),
      found: clip(sourceText),
      applicable: true,
      ...(localText === "" ? { note: "בחנות אין תיאור" } : {}),
    });
  }

  // תמונה: את התוכן אי אפשר להשוות. מציעים רק כשבחנות אין תמונה בכלל
  if (!local.image_url && source.image) {
    diffs.push({
      field: "image",
      current: "(אין תמונה)",
      found: source.image,
      applicable: true,
      note: "בחנות אין תמונה — התמונה תורד ותישמר אצלנו",
    });
  }

  const sourceBarcode = normBarcode(source.barcode);
  const localBarcode = normBarcode(local.barcode);
  if (sourceBarcode && !localBarcode) {
    diffs.push({ field: "barcode", current: "(אין)", found: sourceBarcode, applicable: true });
  } else if (sourceBarcode && localBarcode && sourceBarcode !== localBarcode) {
    diffs.push({
      field: "barcode",
      current: localBarcode,
      found: sourceBarcode,
      applicable: false,
      note: "ברקוד שונה — לא מתעדכן אוטומטית, לבדיקה ידנית",
    });
  }

  if (source.category && normText(source.category) !== normText(local.category)) {
    const exists = [...storeCategories].some(
      (name) => normText(name) === normText(source.category),
    );
    diffs.push({
      field: "category",
      current: local.category,
      found: source.category,
      applicable: exists,
      ...(exists ? {} : { note: "הקטגוריה הזו לא קיימת בחנות — לא נוצרת כאן" }),
    });
  }

  let stockNote: string | undefined;
  if (source.stock !== null) {
    if (source.stock !== local.stock_quantity) {
      diffs.push({
        field: "stock",
        current: String(local.stock_quantity),
        found: String(source.stock),
        applicable: true,
        note: "כמות מפורשת באתר המקור",
      });
    }
  } else {
    stockNote =
      source.availability !== null
        ? "באתר המקור יש רק מצב זמינות (במלאי / אזל) ולא כמות — המלאי לא מושווה"
        : "אין נתון מלאי אמין באתר המקור — המלאי לא מושווה";
  }
  return { diffs, stockNote };
}

/** מוצר חדש שאפשר להוסיף: חייב שם ומחיר תקין */
export function newProductProblem(source: SourceProduct): string | null {
  if (!source.name.trim()) return "אין שם מוצר";
  if (source.price === null || !(source.price > 0)) return "לא נמצא מחיר — אי אפשר להוסיף";
  if (source.price >= 100_000_000) return "מחיר לא סביר";
  return null;
}

/**
 * ההשוואה המלאה מול הקטלוג של החנות הפעילה (המוצרים שהועברו אליה בלבד).
 * התאמה: ברקוד → מק"ט → (שם דומה = "לא ודאי"). בלי התאמה = חדש.
 */
export function compareCatalog(
  scanned: SourceProduct[],
  local: LocalProduct[],
  storeCategories: ReadonlySet<string>,
): { rows: ScanRow[]; summary: ScanSummary } {
  const { products, removed } = dedupeSource(scanned);

  const byBarcode = new Map<string, LocalProduct>();
  const bySku = new Map<string, LocalProduct>();
  for (const item of local) {
    const barcode = normBarcode(item.barcode);
    if (barcode && !byBarcode.has(barcode)) byBarcode.set(barcode, item);
    const sku = normSku(item.sku);
    if (sku && !bySku.has(sku)) bySku.set(sku, item);
  }
  // מוצר בחנות מותאם לכל היותר למוצר אחד מהמקור (בלי עדכון כפול של אותו מוצר)
  const taken = new Set<string>();
  const rows: ScanRow[] = [];

  const certain = (item: LocalProduct, by: MatchBy, source: SourceProduct): ScanRow => {
    const { diffs, stockNote } = diffProduct(item, source, storeCategories);
    taken.add(item.id);
    return {
      key: source.url,
      kind: diffs.some((d) => d.applicable) ? "changed" : "unchanged",
      source,
      match: { productId: item.id, name: item.name, sku: item.sku, by },
      diffs,
      ...(stockNote ? { stockNote } : {}),
    };
  };

  const pending: SourceProduct[] = [];
  for (const source of products) {
    const barcode = normBarcode(source.barcode);
    const sku = normSku(source.sku);
    const byCode = (barcode ? byBarcode.get(barcode) : undefined) ?? null;
    const bySkuMatch = (sku ? bySku.get(sku) : undefined) ?? null;
    if (byCode && !taken.has(byCode.id)) rows.push(certain(byCode, "barcode", source));
    else if (bySkuMatch && !taken.has(bySkuMatch.id)) rows.push(certain(bySkuMatch, "sku", source));
    else pending.push(source);
  }

  for (const source of pending) {
    // מועמד לפי שם בלבד — לא מעדכנים אוטומטית
    let best: { item: LocalProduct; score: number } | null = null;
    for (const item of local) {
      if (taken.has(item.id)) continue;
      const score = nameSimilarity(source.name, item.name);
      if (score >= NAME_CANDIDATE_THRESHOLD && (!best || score > best.score))
        best = { item, score };
    }
    if (best) {
      const { diffs, stockNote } = diffProduct(best.item, source, storeCategories);
      rows.push({
        key: source.url,
        kind: "uncertain",
        source,
        match: { productId: best.item.id, name: best.item.name, sku: best.item.sku, by: "name" },
        diffs,
        score: Math.round(best.score * 100) / 100,
        ...(stockNote ? { stockNote } : {}),
      });
      continue;
    }
    const blocked = newProductProblem(source);
    rows.push({
      key: source.url,
      kind: "new",
      source,
      match: null,
      diffs: [],
      ...(blocked ? { blocked } : {}),
    });
  }

  const order = { changed: 0, uncertain: 1, new: 2, unchanged: 3 } as const;
  rows.sort(
    (a, b) => order[a.kind] - order[b.kind] || a.source.name.localeCompare(b.source.name, "he"),
  );
  return {
    rows,
    summary: {
      scanned: scanned.length,
      newCount: rows.filter((r) => r.kind === "new").length,
      changed: rows.filter((r) => r.kind === "changed").length,
      unchanged: rows.filter((r) => r.kind === "unchanged").length,
      uncertain: rows.filter((r) => r.kind === "uncertain").length,
      duplicatesInSource: removed,
    },
  };
}

// ---------------------------------------------------------------- אישור

/** מה שהמשתמש אישר: מוצרים להוספה ועדכונים לשדות מסוימים של מוצר קיים */
export type ApprovedChanges = {
  adds: SourceProduct[];
  updates: {
    productId: string;
    sourceUrl: string;
    /** רק שדות שאושרו במפורש */
    fields: DiffField[];
    source: SourceProduct;
  }[];
};

/** סיכום הפעולות שאושרו — מוצג לפני הביצוע */
export function approvalSummary(changes: ApprovedChanges): string[] {
  const lines: string[] = [];
  if (changes.adds.length > 0) lines.push(`הוספת ${changes.adds.length} מוצרים חדשים`);
  const perField = new Map<DiffField, number>();
  for (const update of changes.updates) {
    for (const field of update.fields) perField.set(field, (perField.get(field) ?? 0) + 1);
  }
  for (const [field, count] of perField) lines.push(`עדכון ${DIFF_LABEL[field]} ב-${count} מוצרים`);
  return lines;
}
