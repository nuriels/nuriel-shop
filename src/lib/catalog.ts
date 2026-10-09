/** קטלוג המשקאות: קטגוריות בסיס, טיפוסי מוצר ועזרי תצוגה */

import type { CatalogVariant, VariantAttribute } from "@/lib/variants";

/**
 * אין רשימת קטגוריות מוטמעת בקוד: הקטגוריות נוצרות ידנית ע"י המנהל
 * (ניהול → מוצרים → ניהול קטגוריות) ונטענות מהמסד בלבד.
 */

/** מוצר כפי שהוא מנוהל בפאנל האדמין — כולל שלושת דרגי המחיר ומחיר העלות */
export type GlobalProduct = {
  id: string;
  sku: string;
  name: string;
  category: string;
  /** חלק 18: כל הקטגוריות של המוצר (product_categories) — נטען בנפרד בניהול */
  categories?: string[] | null;
  description: string | null;
  image_url: string | null;
  images?: string[] | null;
  colors?: string[] | null;
  barcode?: string | null;
  /** איתור במחסן (מדף/שורה) — פנימי, מופיע בבון הליקוט בלבד */
  shelf_location?: string | null;
  /** מחיר מבצע יחיד לכל הדרגים, בתוקף בין sale_starts_at ל-sale_ends_at */
  sale_price?: number | null;
  sale_starts_at?: string | null;
  sale_ends_at?: string | null;
  /** תמחור אחיד: מחיר אחד לכל הדרגים (נועל את שדות הדרגים בטופס) */
  uniform_price?: boolean;
  stock_quantity: number;
  is_out_of_stock: boolean;
  is_promo: boolean;
  price_tier1: number;
  price_tier2: number;
  price_tier3: number;
  cost_price?: number | null;
  /** האם המוצר חייב בפיקדון (למשל בקבוק/פחית) */
  has_deposit?: boolean;
  /** מחיר הפיקדון ליחידה בודדת (לא למארז) */
  deposit_price?: number | null;
  /** כמות היחידות במארז — משמש להכפלת הפיקדון (deposit_price * deposit_units) */
  deposit_units?: number | null;
  /** נמכר במארזים של N יחידות; null = ביחידה, בלי מינימום */
  pack_size?: number | null;
  /** מינימום יחידות להזמנה (NULL = בלי) — נפרד מהמארזים */
  min_order_quantity?: number | null;
  /** מוסתר מלקוחות ומאורחים (נשאר בקטגוריה שלו) */
  is_hidden?: boolean;
  /** true = המערכת סימנה "אזל" אוטומטית כשהמלאי הגיע ל-0 */
  out_of_stock_auto?: boolean;
  /** סדר בתוך הקטגוריה (גרירה בניהול). NULL = לא סודר — מהחדש לישן */
  sort_order?: number | null;
  /** מוצר קופה: מוצע בסל ממש לפני שליחת ההזמנה */
  is_order_bump?: boolean;
  /** משפט שיווקי קצר להצעה בקופה */
  order_bump_text?: string | null;
  /** מוצר דיגיטלי (רישיון / קוד): בלי מלאי פיזי ובלי משלוח */
  is_digital?: boolean;
  /** מאפייני הוריאציות [{name, values}] — הצירופים בטבלת product_variants */
  variant_attributes?: unknown;
  /** SEO (חלק 14): כותרת ותיאור לגוגל לעמוד המוצר; null = שם המוצר / התיאור */
  seo_title?: string | null;
  seo_description?: string | null;
  seo_keywords?: string | null;
  /** להציג בפיד של זאפ השוואת מחירים (/zap.xml) */
  show_in_zap?: boolean;
  /** חלק 20: "הקפץ למסך ראשי" — בבלוק "מוצרים נבחרים" במסך הבית */
  is_featured?: boolean;
  /** חלק 23: מדבקת המוצר מהגלריה, גודל ושקיפות (אחוזים) */
  sticker_id?: string | null;
  sticker_size?: number;
  sticker_opacity?: number;
  /** חלק 35: נמכר עם מספר סידורי לכל יחידה (קליטה וליקוט בסריקה) */
  requires_serial?: boolean;
  /** חלק 35: חודשי אחריות מיום הרכישה (0 = בלי) */
  warranty_months?: number;
};

export const PRODUCT_ADMIN_COLUMNS =
  "id, sku, name, category, description, image_url, images, colors, barcode, shelf_location, sale_price, sale_starts_at, sale_ends_at, uniform_price, stock_quantity, is_out_of_stock, is_promo, price_tier1, price_tier2, price_tier3, cost_price, has_deposit, deposit_price, deposit_units, pack_size, min_order_quantity, sort_order, is_hidden, out_of_stock_auto, is_order_bump, order_bump_text, is_digital, variant_attributes, seo_title, seo_description, seo_keywords, show_in_zap, is_featured, sticker_id, sticker_size, sticker_opacity, requires_serial, warranty_months" as const;

/** לסוכן שבונה הזמנה ללקוח: כל דרגי המחיר, בלי מחיר עלות (ניהולי בלבד) */
export const STAFF_CATALOG_COLUMNS =
  "id, sku, name, category, description, image_url, barcode, shelf_location, sale_price, sale_starts_at, sale_ends_at, stock_quantity, is_out_of_stock, is_promo, price_tier1, price_tier2, price_tier3, has_deposit, deposit_price, deposit_units, pack_size, min_order_quantity, sort_order, is_hidden" as const;

/** מוצר כפי שמוחזר מ-get_catalog() — מחיר יחיד, כבר מחושב לפי דרג הצופה */
export type CatalogItem = {
  id: string;
  sku: string;
  name: string;
  /** הקטגוריה הראשית */
  category: string;
  /** חלק 18: כל הקטגוריות של המוצר (הראשית ראשונה) — product_categories */
  categories?: string[] | null;
  description: string | null;
  image_url: string | null;
  images: string[] | null;
  colors: string[] | null;
  barcode: string | null;
  is_promo: boolean;
  is_out_of_stock: boolean;
  /** null עבור אורח שאינו מחובר או לקוח בלי קבוצת מחיר */
  price: number | null;
  /** המחיר לפני המבצע — מוצג מחוק. null כשאין מבצע פעיל */
  original_price: number | null;
  /** מועד סיום המבצע הפעיל, אם הוגדר */
  sale_ends_at: string | null;
  /** מועד הוספת המוצר לקטלוג — משמש ללשונית "חדש באתר" */
  created_at: string;
  /** האם המוצר חייב בפיקדון (למשל בקבוק/פחית) */
  has_deposit: boolean;
  /** מחיר הפיקדון ליחידה בודדת (לא למארז) */
  deposit_price: number | null;
  /** כמות היחידות במארז — משמש להכפלת הפיקדון */
  deposit_units: number | null;
  /** נמכר במארזים של N יחידות (הכמות חייבת להיות כפולה של N); null = ביחידה */
  pack_size: number | null;
  /** מינימום יחידות להזמנה (NULL = בלי) — נפרד מהמארזים */
  min_order_quantity?: number | null;
  /** true = המחיר הוא מחיר אישי שהמנהל קבע ללקוח המחובר (מחירון אישי) */
  is_custom_price?: boolean;
  /** מוצר דיגיטלי — נשלח במייל, בלי משלוח */
  is_digital?: boolean;
  /** מאפייני הוריאציות (ריק = מוצר בלי וריאציות) */
  variant_attributes?: VariantAttribute[];
  /** הוריאציות הפעילות, עם המחיר לצופה וזמינות */
  variants?: CatalogVariant[];
  /** חלק 20: "הקפץ למסך ראשי" — בבלוק "מוצרים נבחרים" במסך הבית */
  is_featured?: boolean;
  /** חלק 23: מדבקת המוצר (פינה עליונה שמאלית של התמונה); null = בלי */
  sticker?: ProductStickerView | null;
};

/** מדבקה כפי שמוצגת על המוצר: תמונה, גודל (% מרוחב התמונה) ושקיפות (%) */
export type ProductStickerView = {
  url: string;
  /** 10–60: אחוז מרוחב אזור התמונה */
  size: number;
  /** 10–100 */
  opacity: number;
  /** שם המדבקה (טקסט חלופי); null = דקורטיבית */
  label: string | null;
};

/**
 * חלק 20 — מלאי חכם: יש במלאי למכירה לפחות מארז אחד (או יחידה אחת).
 * מוצר דיגיטלי — תמיד (אין לו מלאי פיזי). זהה ל-product_stock_sellable במסד.
 */
export function stockSellable(item: {
  stock_quantity: number;
  pack_size?: number | null;
  is_digital?: boolean | null;
}): boolean {
  if (item.is_digital) return true;
  return item.stock_quantity >= Math.max(item.pack_size ?? 1, 1);
}

/**
 * "אזל" כפי שהלקוח רואה באתר — למוצר בלי וריאציות: הסימון הידני, או מלאי 0
 * (גם כשהסימון לא עודכן). למוצר עם וריאציות קובעות הוריאציות (במסד).
 */
export function shownAsSoldOut(item: {
  is_out_of_stock: boolean;
  stock_quantity: number;
  pack_size?: number | null;
  is_digital?: boolean | null;
}): boolean {
  return item.is_out_of_stock || !stockSellable(item);
}

/** קודם מה שיש במלאי, בסוף מה שאזל — מיון יציב (הסדר בתוך כל קבוצה נשמר) */
export function inStockFirst<T extends { is_out_of_stock: boolean }>(items: T[]): T[] {
  const available = items.filter((item) => !item.is_out_of_stock);
  if (available.length === items.length) return items;
  return [...available, ...items.filter((item) => item.is_out_of_stock)];
}

/** מוצר נחשב "חדש באתר" בחודש הראשון שלו */
export const NEW_PRODUCT_DAYS = 30;

export function isNewProduct(item: { created_at: string }): boolean {
  const added = new Date(item.created_at).getTime();
  if (Number.isNaN(added)) return false;
  return Date.now() - added <= NEW_PRODUCT_DAYS * 24 * 60 * 60 * 1000;
}

export type PriceTier = 1 | 2 | 3;

export const PRICE_TIER_FIELD: Record<PriceTier, keyof GlobalProduct> = {
  1: "price_tier1",
  2: "price_tier2",
  3: "price_tier3",
};

/** מקט אקראי בן 8 ספרות */
export function generateSku(): string {
  return Math.floor(Math.random() * 1e8)
    .toString()
    .padStart(8, "0");
}

/**
 * קיבוץ שורות לפי קטגוריה: קודם קטגוריות לפי סדר הרשימה שהתקבלה,
 * ואחרונות — קטגוריות שאינן ברשימה (למשל מוצרים ישנים) בסדר א"ב.
 */
export function groupByCategory<T>(
  rows: T[],
  getCategory: (row: T) => string,
  order: readonly string[],
): { name: string; rows: T[] }[] {
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const category = getCategory(row).trim() || "ללא קטגוריה";
    const bucket = buckets.get(category);
    if (bucket) bucket.push(row);
    else buckets.set(category, [row]);
  }
  const groups: { name: string; rows: T[] }[] = [];
  for (const name of order) {
    const bucket = buckets.get(name);
    if (bucket) {
      groups.push({ name, rows: bucket });
      buckets.delete(name);
    }
  }
  for (const name of [...buckets.keys()].sort((a, b) => a.localeCompare(b, "he"))) {
    groups.push({ name, rows: buckets.get(name)! });
  }
  return groups;
}

/** מבצע פעיל כרגע (משמש כשאין מחיר סופי מוכן מ-get_catalog, למשל בטופס הזמנה ידנית של סוכן) */
export function isSaleActive(product: {
  sale_price?: number | null;
  sale_starts_at?: string | null;
  sale_ends_at?: string | null;
}): boolean {
  if (product.sale_price == null) return false;
  const now = Date.now();
  if (product.sale_starts_at && new Date(product.sale_starts_at).getTime() > now) return false;
  if (product.sale_ends_at && new Date(product.sale_ends_at).getTime() < now) return false;
  return true;
}

/** אחוז ההנחה, מעוגל, להצגה על תג המבצע */
export function discountPercent(price: number, original: number): number {
  if (original <= 0) return 0;
  return Math.max(0, Math.round((1 - price / original) * 100));
}

/** "נגמר בעוד יומיים" / "נגמר היום" וכו' — טקסט קצר לתג המבצע בכרטיס מוצר */
export function formatSaleCountdown(saleEndsAt: string): string {
  const diffMs = new Date(saleEndsAt).getTime() - Date.now();
  if (diffMs <= 0) return "המבצע הסתיים";
  const hours = diffMs / (60 * 60 * 1000);
  if (hours < 1) return "נגמר בעוד פחות משעה";
  if (hours < 24) return `נגמר בעוד ${Math.round(hours)} שעות`;
  const days = Math.round(hours / 24);
  if (days === 1) return "נגמר מחר";
  return `נגמר בעוד ${days} ימים`;
}

/** מחיר ליחידה מדויק מתוך מחיר מארז — 10 ספרות אחרי הנקודה, כמו במחשבון (115/24 = 4.7916666667) */
export function unitPriceFromPack(packPrice: number, packSize: number): string {
  if (!Number.isFinite(packPrice) || !Number.isFinite(packSize) || packSize < 1) return "";
  return String(Number((packPrice / packSize).toFixed(10)));
}

/** מחיר ליחידה במסמכים: 2 ספרות כשזה מדויק, אחרת עד 4 (₪4.7917) — כדי שיהיה ברור למה המארז יוצא 115.00 */
export function formatUnitIls(value: number): string {
  const precise = Math.abs(value * 100 - Math.round(value * 100)) > 1e-6;
  return `₪${value.toLocaleString("he-IL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: precise ? 4 : 2,
  })}`;
}

export function formatIls(value: number): string {
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS" }).format(value);
}

/** כמות מינימלית וקפיצה לכפתורי הכמות: גודל המארז, או 1 למוצר שנמכר ביחידה */
export function packStep(item: { pack_size?: number | null }): number {
  return item.pack_size && item.pack_size >= 2 ? item.pack_size : 1;
}

/** מעגל כמות כלפי מעלה לכפולה של המארז (לפחות מארז אחד) */
export function roundToPack(quantity: number, step: number): number {
  if (step <= 1) return Math.max(1, Math.floor(quantity));
  return Math.max(step, Math.ceil(quantity / step) * step);
}

type QuantityRules = { pack_size?: number | null; min_order_quantity?: number | null };

/** מינימום יחידות להזמנה שהוגדר למוצר (1 = בלי מינימום). נפרד ממנגנון המארזים. */
export function minOrderUnits(item: { min_order_quantity?: number | null }): number {
  return item.min_order_quantity && item.min_order_quantity >= 2 ? item.min_order_quantity : 1;
}

/** הכמות הקטנה ביותר שמותר להזמין: כפולה של המארז (אם יש) שאינה נמוכה מהמינימום */
export function minimumQuantity(item: QuantityRules): number {
  const step = packStep(item);
  return Math.max(step, Math.ceil(minOrderUnits(item) / step) * step);
}

/** מתקן כמות: כפולה של המארז, ולא פחות מהמינימום */
export function normalizeQuantity(item: QuantityRules, quantity: number): number {
  return Math.max(minimumQuantity(item), roundToPack(quantity, packStep(item)));
}

/** ההודעה כשמנסים לרדת מתחת למינימום */
export function minOrderMessage(units: number): string {
  return `מינימום להזמנה ממוצר זה הינו ${units} יחידות`;
}
