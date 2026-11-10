/**
 * מוצרים כפולים בחנות — טיפוסים ולוגיקה טהורה (בלי שרת ובלי מסד), משותפים לדפדפן, לשרת ולבדיקות.
 *
 * הזיהוי והמיזוג עצמם — במסד (supabase/migrations/20261110230000_product_duplicates.sql):
 * product_duplicate_groups / product_duplicate_cards / product_duplicate_dismiss / product_merge.
 * כאן: פענוח זהיר של מה שחוזר מהמסד, ברירות המחדל של מסך המיזוג (איזה מוצר להשאיר, איזו כמות),
 * בדיקת הקלט של המיזוג לפני השליחה, והחלק של הצעות ה-AI: שורות המוצרים שנשלחות לדגם והבדיקה של
 * התשובה שלו (רק מזהים מהרשימה שנשלחה, קוד סיבה מרשימה סגורה — הדגם לא כותב שום טקסט שמוצג).
 */

export type DuplicateReason = "name" | "image" | "barcode";
export type KeepReason =
  "orders" | "variants" | "serials" | "stock_counts" | "transfers" | "requested";

export type DuplicateProduct = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  price: number | null;
  salePrice: number | null;
  stock: number;
  hidden: boolean;
  outOfStock: boolean;
  imageUrl: string | null;
  category: string;
  createdAt: string;
  requiresSerial: boolean;
  orders: number;
  reviews: number;
  /** למה אי אפשר למחוק את המוצר (רק להסתיר) — ריק = אפשר למחוק */
  keepReasons: KeepReason[];
};

export type DuplicateGroup = {
  key: string;
  reasons: DuplicateReason[];
  products: DuplicateProduct[];
};

export type DuplicateGroupsResult = {
  groups: DuplicateGroup[];
  total: number;
  truncated: boolean;
};

export type StockMode = "keep" | "from" | "sum" | "custom";

export type MergeRequest = {
  keep: string;
  others: string[];
  stockMode: StockMode;
  stockFrom: string | null;
  stock: number | null;
  /** מוצרים שאפשר למחוק, אבל המנהל ביקש להסתיר */
  hide: string[];
};

export type MergeOutcome = {
  mergeId: string;
  keptName: string;
  stockBefore: number;
  stockAfter: number;
  deleted: number;
  hidden: number;
  moved: { reviews: number; relations: number; customPrices: number; giftPromotions: number };
  reviewsLeft: number;
};

export const MERGE_MAX_PRODUCTS = 20;
export const STOCK_MAX = 9_999_999;

export const REASON_LABELS: Record<DuplicateReason, string> = {
  name: "אותו שם",
  image: "אותה תמונה",
  barcode: "אותו ברקוד",
};

export const KEEP_REASON_LABELS: Record<KeepReason, string> = {
  orders: "יש לו הזמנות",
  variants: "יש לו וריאציות",
  serials: "יש לו מספרים סידוריים",
  stock_counts: "מופיע בספירות מלאי",
  transfers: "מופיע בהעברות בין מיקומים",
  requested: "לבקשתכם",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID.test(value);

const KEEP_REASONS: readonly KeepReason[] = [
  "orders",
  "variants",
  "serials",
  "stock_counts",
  "transfers",
  "requested",
];
const GROUP_REASONS: readonly DuplicateReason[] = ["name", "image", "barcode"];

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}
function strOrNull(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s === "" ? null : s;
}

/** כרטיס מוצר מהמסד (_product_duplicate_cards) — שדה חסר / לא תקין מקבל ערך בטוח */
export function parseProductCard(raw: unknown): DuplicateProduct | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (!isUuid(r["id"])) return null;
  const reasons = Array.isArray(r["keep_reasons"])
    ? (r["keep_reasons"] as unknown[]).filter((x): x is KeepReason =>
        (KEEP_REASONS as readonly unknown[]).includes(x),
      )
    : [];
  return {
    id: r["id"],
    name: str(r["name"]),
    sku: str(r["sku"]),
    barcode: strOrNull(r["barcode"]),
    price: numOrNull(r["price"]),
    salePrice: numOrNull(r["sale_price"]),
    stock: Math.max(0, Math.trunc(num(r["stock"]))),
    hidden: r["hidden"] === true,
    outOfStock: r["out_of_stock"] === true,
    imageUrl: strOrNull(r["image_url"]),
    category: str(r["category"]),
    createdAt: str(r["created_at"]),
    requiresSerial: r["requires_serial"] === true,
    orders: Math.max(0, Math.trunc(num(r["orders"]))),
    reviews: Math.max(0, Math.trunc(num(r["reviews"]))),
    keepReasons: reasons,
  };
}

export function parseCards(raw: unknown): DuplicateProduct[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseProductCard).filter((p): p is DuplicateProduct => p !== null);
}

export function parseGroups(raw: unknown): DuplicateGroupsResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  const groups: DuplicateGroup[] = [];
  for (const g of Array.isArray(r["groups"]) ? (r["groups"] as unknown[]) : []) {
    const gr = (g ?? {}) as Record<string, unknown>;
    const products = parseCards(gr["products"]);
    if (products.length < 2) continue;
    const reasons = Array.isArray(gr["reasons"])
      ? (gr["reasons"] as unknown[]).filter((x): x is DuplicateReason =>
          (GROUP_REASONS as readonly unknown[]).includes(x),
        )
      : [];
    groups.push({
      key: str(gr["key"]) || products.map((p) => p.id).join(","),
      reasons,
      products,
    });
  }
  return {
    groups,
    total: Math.max(groups.length, Math.trunc(num(r["total"], groups.length))),
    truncated: r["truncated"] === true,
  };
}

export function parseMergeOutcome(raw: unknown): MergeOutcome {
  const r = (raw ?? {}) as Record<string, unknown>;
  const kept = (r["kept"] ?? {}) as Record<string, unknown>;
  const moved = (r["moved"] ?? {}) as Record<string, unknown>;
  return {
    mergeId: str(r["merge_id"]),
    keptName: str(kept["name"]),
    stockBefore: Math.trunc(num(kept["stock_before"])),
    stockAfter: Math.trunc(num(kept["stock_after"])),
    deleted: Math.trunc(num(r["deleted"])),
    hidden: Math.trunc(num(r["hidden"])),
    moved: {
      reviews: Math.trunc(num(moved["reviews"])),
      relations: Math.trunc(num(moved["relations"])),
      customPrices: Math.trunc(num(moved["custom_prices"])),
      giftPromotions: Math.trunc(num(moved["gift_promotions"])),
    },
    reviewsLeft: Math.trunc(num(r["reviews_left"])),
  };
}

// ------------------------------------------------------------------ ברירות המחדל של מסך המיזוג

/** המוצר שנשאר כברירת מחדל: זה עם הכי הרבה הזמנות; בלי הזמנות — הוותיק ביותר */
export function defaultKeepId(products: readonly DuplicateProduct[]): string | null {
  if (products.length === 0) return null;
  const sorted = [...products].sort(
    (a, b) =>
      b.orders - a.orders || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  return sorted[0]!.id;
}

/** הכמות שתהיה למוצר שנשאר — אותו חישוב כמו במסד (לתצוגה מראש) */
export function stockAfter(
  products: readonly DuplicateProduct[],
  keepId: string,
  mode: StockMode,
  fromId: string | null,
  custom: number | null,
): number | null {
  const kept = products.find((p) => p.id === keepId);
  if (!kept) return null;
  switch (mode) {
    case "keep":
      return kept.stock;
    case "from": {
      const from = products.find((p) => p.id === fromId);
      return from ? from.stock : null;
    }
    case "sum":
      return products.reduce((sum, p) => sum + Math.max(0, p.stock), 0);
    case "custom":
      return custom !== null && Number.isInteger(custom) && custom >= 0 && custom <= STOCK_MAX
        ? custom
        : null;
  }
}

/** מוצר שאי אפשר למחוק (רק להסתיר) */
export const mustHide = (product: DuplicateProduct): boolean => product.keepReasons.length > 0;

/**
 * מה המיזוג יעשה — לחלון האישור: מה נשאר, מה יימחק, מה יוסתר. null = הבחירה לא שלמה (למשל
 * כמות לא תקינה, או הוספת כמות למוצר עם מספרים סידוריים — המסד מסרב לזה).
 */
export function planMerge(
  products: readonly DuplicateProduct[],
  keepId: string,
  mode: StockMode,
  fromId: string | null,
  custom: number | null,
  hideIds: ReadonlySet<string>,
): {
  kept: DuplicateProduct;
  deleted: DuplicateProduct[];
  hidden: DuplicateProduct[];
  stockAfter: number;
  serialBlocked: boolean;
} | null {
  const kept = products.find((p) => p.id === keepId);
  if (!kept || products.length < 2) return null;
  const after = stockAfter(products, keepId, mode, fromId, custom);
  if (after === null || after > STOCK_MAX) return null;
  const others = products.filter((p) => p.id !== keepId);
  return {
    kept,
    deleted: others.filter((p) => !mustHide(p) && !hideIds.has(p.id)),
    hidden: others.filter((p) => mustHide(p) || hideIds.has(p.id)),
    stockAfter: after,
    serialBlocked: kept.requiresSerial && after > kept.stock,
  };
}

/** בדיקת הקלט של המיזוג (בשרת, לפני המסד — המסד בודק שוב הכול) */
export function validateMergeInput(input: unknown): MergeRequest {
  const r = (input ?? {}) as Record<string, unknown>;
  if (!isUuid(r["keep"])) throw new Error("בחרו איזה מוצר להשאיר");
  const keep = r["keep"].toLowerCase();
  const others = Array.isArray(r["others"])
    ? [...new Set((r["others"] as unknown[]).filter(isUuid).map((id) => id.toLowerCase()))].filter(
        (id) => id !== keep,
      )
    : [];
  if (others.length === 0) throw new Error("בחרו לפחות מוצר אחד נוסף למיזוג");
  if (others.length > MERGE_MAX_PRODUCTS - 1)
    throw new Error(`אפשר למזג עד ${MERGE_MAX_PRODUCTS} מוצרים בפעם אחת`);
  const mode = r["stockMode"];
  if (mode !== "keep" && mode !== "from" && mode !== "sum" && mode !== "custom")
    throw new Error("בחירת הכמות לא תקינה");
  let stockFrom: string | null = null;
  if (mode === "from") {
    if (!isUuid(r["stockFrom"])) throw new Error("בחרו מאיזה מוצר לקחת את הכמות");
    stockFrom = r["stockFrom"].toLowerCase();
    if (stockFrom !== keep && !others.includes(stockFrom))
      throw new Error("בחרו מאיזה מוצר לקחת את הכמות");
  }
  let stock: number | null = null;
  if (mode === "custom") {
    const n = Number(r["stock"]);
    if (!Number.isInteger(n) || n < 0 || n > STOCK_MAX)
      throw new Error("כמות לא תקינה — מספר שלם בין 0 ל-9,999,999");
    stock = n;
  }
  const hide = Array.isArray(r["hide"])
    ? [...new Set((r["hide"] as unknown[]).filter(isUuid).map((id) => id.toLowerCase()))].filter(
        (id) => others.includes(id),
      )
    : [];
  return { keep, others, stockMode: mode, stockFrom, stock, hide };
}

/** רשימת מזהים לבקשה ("לא כפול" / כרטיסים) */
export function validateIdList(input: unknown, min: number, max: number): string[] {
  const raw = (input ?? {}) as Record<string, unknown>;
  const ids = Array.isArray(raw["ids"])
    ? [...new Set((raw["ids"] as unknown[]).filter(isUuid).map((id) => id.toLowerCase()))]
    : [];
  if (ids.length < min || ids.length > max) throw new Error(`בחרו בין ${min} ל-${max} מוצרים`);
  return ids;
}

// ------------------------------------------------------------------ הצעות ה-AI

/** עד כמה מוצרים נשלחים לדגם בבדיקה אחת */
export const AI_MAX_PRODUCTS = 300;
/** עד כמה הצעות מוצגות */
export const AI_MAX_SUGGESTIONS = 30;
/** עד כמה מוצרים בהצעה אחת */
export const AI_MAX_GROUP = 10;

export const AI_REASONS = ["same_model", "reworded", "typo", "updated_copy"] as const;
export type AiReason = (typeof AI_REASONS)[number];
export const AI_CONFIDENCES = ["high", "medium"] as const;
export type AiConfidence = (typeof AI_CONFIDENCES)[number];

/** הטקסט שמוצג — נכתב כאן מראש; הדגם מחזיר רק את הקוד */
export const AI_REASON_LABELS: Record<AiReason, string> = {
  same_model: "נראה שזה אותו דגם בשמות שונים",
  reworded: "אותו מוצר בניסוח אחר או עם מילים נוספות",
  typo: "הבדל של כתיב, רווחים או סימנים בלבד",
  updated_copy: "אותו מוצר שנוסף שוב עם פרטים מעודכנים",
};
export const AI_CONFIDENCE_LABELS: Record<AiConfidence, string> = {
  high: "סבירות גבוהה",
  medium: "סבירות בינונית",
};

export type AiCandidate = {
  id: string;
  name: string;
  sku: string;
  price: number | null;
  category: string;
};

export type AiSuggestion = {
  ids: string[];
  reason: AiReason;
  confidence: AiConfidence;
};

/** אותו נרמול כמו product_name_key במסד (lower, trim, רווחים מכווצים) */
export function nameKey(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

/** תווי בקרה, תווים בלתי נראים ו-< > — כדי ששם מוצר לא "יסגור" את התגיות שבהן הוא נשלח לדגם */
const UNSAFE_FOR_PROMPT = /[\p{Cc}\p{Cf}\u{2028}\u{2029}<>|]/gu;

/** שם / מק"ט / קטגוריה לשורה של הדגם: בלי תווים מסוכנים, רווחים מכווצים, אורך מוגבל */
export function promptField(value: string, max: number): string {
  const clean = value.normalize("NFKC").replace(UNSAFE_FOR_PROMPT, " ").replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : clean.slice(0, max);
}

/** השורות שנשלחות לדגם: מספר | שם | מק"ט | מחיר | קטגוריה (המספר — לא המזהה — כדי לחסוך טוקנים) */
export function buildAiProductLines(products: readonly AiCandidate[]): string {
  return products
    .map(
      (p, i) =>
        `${i + 1} | ${promptField(p.name, 120)} | ${promptField(p.sku, 40)} | ${
          p.price === null ? "" : String(p.price)
        } | ${promptField(p.category, 60)}`,
    )
    .join("\n");
}

export function parseAiCandidates(raw: unknown): {
  products: AiCandidate[];
  total: number;
  dismissed: string[][];
} {
  const r = (raw ?? {}) as Record<string, unknown>;
  const products: AiCandidate[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(r["products"]) ? (r["products"] as unknown[]) : []) {
    const p = (item ?? {}) as Record<string, unknown>;
    if (!isUuid(p["id"]) || seen.has(p["id"])) continue;
    seen.add(p["id"]);
    products.push({
      id: p["id"],
      name: str(p["name"]),
      sku: str(p["sku"]),
      price: numOrNull(p["price"]),
      category: str(p["category"]),
    });
    if (products.length >= AI_MAX_PRODUCTS) break;
  }
  const dismissed = (Array.isArray(r["dismissed"]) ? (r["dismissed"] as unknown[]) : [])
    .map((set) => (Array.isArray(set) ? (set as unknown[]).filter(isUuid) : []))
    .filter((set) => set.length >= 2);
  return { products, total: Math.max(products.length, Math.trunc(num(r["total"]))), dismissed };
}

/**
 * התשובה של הדגם → הצעות. נבדק הכול: JSON בצורה הסגורה, מספרים בלבד מתוך הרשימה שנשלחה (לא מזהים,
 * לא שמות), 2–10 מוצרים שונים בכל הצעה, מוצר בהצעה אחת לכל היותר, קוד סיבה ורמת ביטחון מהרשימות
 * הסגורות. מושמטות: הצעה שכל המוצרים בה באותו שם (הן כבר ברשימה הרגילה), והצעה שהמנהל כבר סימן
 * "לא כפול". הדגם לא מעביר שום טקסט חופשי.
 */
export function parseAiSuggestions(
  raw: unknown,
  products: readonly AiCandidate[],
  dismissed: readonly (readonly string[])[] = [],
): AiSuggestion[] {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (!Array.isArray(r["groups"])) return [];
  const used = new Set<string>();
  const out: AiSuggestion[] = [];
  const dismissedSets = dismissed.map((set) => new Set(set.map((id) => id.toLowerCase())));
  for (const item of (r["groups"] as unknown[]).slice(0, 60)) {
    if (out.length >= AI_MAX_SUGGESTIONS) break;
    const g = (item ?? {}) as Record<string, unknown>;
    const reason = g["reason"];
    const confidence = g["confidence"];
    if (!(AI_REASONS as readonly unknown[]).includes(reason)) continue;
    if (!(AI_CONFIDENCES as readonly unknown[]).includes(confidence)) continue;
    const numbers = Array.isArray(g["items"]) ? (g["items"] as unknown[]) : [];
    const ids: string[] = [];
    for (const n of numbers) {
      if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > products.length) continue;
      const id = products[n - 1]!.id;
      if (!ids.includes(id)) ids.push(id);
    }
    if (ids.length < 2 || ids.length > AI_MAX_GROUP) continue;
    if (ids.some((id) => used.has(id))) continue;
    const names = new Set(ids.map((id) => nameKey(products.find((p) => p.id === id)!.name)));
    if (names.size === 1) continue;
    if (dismissedSets.some((set) => ids.every((id) => set.has(id.toLowerCase())))) continue;
    for (const id of ids) used.add(id);
    out.push({ ids, reason: reason as AiReason, confidence: confidence as AiConfidence });
  }
  return out;
}

/** מה שחוזר לדפדפן מבדיקת ה-AI: הצעות (מזהים + קודים), או הודעה קבועה למה אין */
export type DuplicateAiResult =
  | { status: "ok"; suggestions: AiSuggestion[]; checked: number; total: number }
  | { status: "unavailable" | "limited" | "failed" | "too_few"; message: string };
