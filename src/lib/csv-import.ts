/**
 * ייבוא קטלוג מ-CSV (חלק 14) — פענוח הקובץ וזיהוי העמודות. טהור: רץ גם
 * בדפדפן (תצוגה מקדימה) וגם בשרת (הייבוא עצמו — פענוח מחדש של אותו קובץ,
 * לא סומכים על מה שהדפדפן הכין). הבדיקות הסופיות והיצירה — במסד
 * (import_products).
 *
 * עמודות מוכרות בעברית ובאנגלית, כולל ייצוא של WooCommerce ו-Shopify.
 *
 * חלק 18: עמודת התמונות יכולה להכיל כמה תמונות בפורמטים שונים —
 * "image:https://a.jpg;alt:טקסט||image:https://b.jpg;alt:" / "url1, url2" /
 * "url1|url2" — וכולן נלקחות (parseImageList). עמודת הקטגוריות יכולה להכיל
 * כמה קטגוריות מופרדות בפסיק, וכל אחת יכולה להיות נתיב "אב > ילד"
 * (parseCategoryList). השרת מוריד את התמונות ושומר אותן אצלנו, וקטגוריות
 * שלא קיימות נוצרות במסד.
 */

export type CsvTable = { headers: string[]; rows: string[][]; delimiter: string };

/** מגבלות */
export const CSV_MAX_BYTES = 5 * 1024 * 1024;
export const CSV_MAX_ROWS = 5000;
/**
 * חלק 18: הייבוא נשלח לשרת במנות קטנות — כל מנה: הורדת התמונות שלה (במקביל)
 * ויצירת המוצרים. כך הדפדפן מציג התקדמות, ואפשר לעצור / להמשיך באמצע.
 */
export const BATCH_MAX_PRODUCTS = 10;
/** עד כמה קישורי תמונות במנה אחת (גם השרת בודק) */
export const BATCH_MAX_IMAGES = 24;
/** עד כמה שורות מהקובץ במנה (כולל שורות ריקות / מדולגות) */
export const BATCH_MAX_RAW_ROWS = 40;
/** כמה שגיאות / אזהרות נשמרות בסיכום */
export const IMPORT_MAX_LISTED = 300;
/** חלק 18: עד כמה תמונות למוצר (כמו במסד) */
export const MAX_IMAGES_PER_PRODUCT = 10;
/** עד כמה קטגוריות למוצר */
export const MAX_CATEGORIES_PER_PRODUCT = 10;
/** אורך שם קטגוריה במסד */
export const CATEGORY_NAME_MAX = 30;

const DELIMITERS = [",", ";", "\t"] as const;

function detectDelimiter(text: string): string {
  // השורה הראשונה (מחוץ למירכאות) — המפריד שמופיע בה הכי הרבה פעמים
  let inQuotes = false;
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  for (const char of text) {
    if (char === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (char === "\n" || char === "\r")) break;
    else if (!inQuotes && char in counts) counts[char] = (counts[char] ?? 0) + 1;
  }
  return DELIMITERS.reduce((best, d) => ((counts[d] ?? 0) > (counts[best] ?? 0) ? d : best), ",");
}

/** CSV לפי RFC 4180: מירכאות, "" בתוך מירכאות, שורות חדשות בתוך תא, CRLF, BOM */
export function parseCsv(input: string): CsvTable {
  const text = input.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  // שורת הכותרות = השורה הראשונה שאינה ריקה. שורות ריקות בהמשך נשארות (מדולגות
  // בייבוא) — כך מספרי השורות בהודעות תואמים לשורות בקובץ
  const isEmpty = (r: string[]) => r.every((value) => value.trim() === "");
  const headerIndex = rows.findIndex((r) => !isEmpty(r));
  if (headerIndex < 0) return { headers: [], rows: [], delimiter };
  const body = rows.slice(headerIndex + 1);
  while (body.length > 0 && isEmpty(body[body.length - 1]!)) body.pop();
  return { headers: rows[headerIndex]!.map((h) => h.trim()), rows: body, delimiter };
}

export type ImportField =
  | "name"
  | "price"
  | "category"
  | "description"
  | "short_description"
  | "sku"
  | "barcode"
  | "stock"
  | "image_url"
  | "sale_price"
  | "sale_ends_at"
  | "cost_price"
  | "hidden"
  | "published"
  | "show_in_zap"
  | "seo_title"
  | "seo_description"
  | "type";

type FieldDef = { key: ImportField; label: string; required?: boolean; aliases: string[] };

/** העמודות המוכרות. הכותרות מושוות אחרי ניקוי (אותיות קטנות, בלי גרשיים ורווחים כפולים) */
export const IMPORT_FIELDS: FieldDef[] = [
  {
    key: "name",
    label: "שם המוצר",
    required: true,
    aliases: ["שם", "שם מוצר", "שם המוצר", "מוצר", "name", "product name", "title", "product"],
  },
  {
    key: "price",
    label: "מחיר",
    required: true,
    aliases: [
      "מחיר",
      "מחיר רגיל",
      "מחיר מכירה",
      "מחיר לצרכן",
      "price",
      "regular price",
      "variant price",
    ],
  },
  {
    key: "category",
    label: "קטגוריה",
    aliases: [
      "קטגוריה",
      "קטגוריות",
      "category",
      "categories",
      "product category",
      "type",
      "product type",
    ],
  },
  {
    key: "description",
    label: "תיאור",
    aliases: ["תיאור", "תיאור מוצר", "תיאור המוצר", "description", "body (html)", "body html"],
  },
  {
    key: "short_description",
    label: "תיאור קצר",
    aliases: ["תיאור קצר", "short description"],
  },
  { key: "sku", label: 'מק"ט', aliases: ["מקט", "sku", "variant sku", "קוד מוצר", "מספר קטלוגי"] },
  {
    key: "barcode",
    label: "ברקוד",
    aliases: [
      "ברקוד",
      "barcode",
      "variant barcode",
      "ean",
      "upc",
      "gtin",
      "gtin, upc, ean, or isbn",
    ],
  },
  {
    key: "stock",
    label: "מלאי",
    aliases: ["מלאי", "כמות", "כמות במלאי", "stock", "quantity", "qty", "variant inventory qty"],
  },
  {
    key: "image_url",
    label: "תמונה (קישור)",
    aliases: ["תמונה", "תמונות", "קישור לתמונה", "image", "images", "image url", "image src"],
  },
  {
    key: "sale_price",
    label: "מחיר מבצע",
    aliases: ["מחיר מבצע", "sale price", "מחיר במבצע"],
  },
  {
    key: "sale_ends_at",
    label: "סיום מבצע",
    aliases: ["סיום מבצע", "תאריך סיום מבצע", "מבצע עד", "date sale price ends", "sale ends"],
  },
  {
    key: "cost_price",
    label: "מחיר עלות",
    aliases: ["מחיר עלות", "עלות", "cost", "cost price", "cost per item"],
  },
  { key: "hidden", label: "מוסתר", aliases: ["מוסתר", "hidden", "הסתר"] },
  { key: "published", label: "פורסם", aliases: ["פורסם", "published", "status"] },
  { key: "show_in_zap", label: "הצג בזאפ", aliases: ["זאפ", "הצג בזאפ", "zap", "show in zap"] },
  {
    key: "seo_title",
    label: "כותרת SEO",
    aliases: ["כותרת seo", "seo title", "meta title"],
  },
  {
    key: "seo_description",
    label: "תיאור SEO",
    aliases: ["תיאור seo", "seo description", "meta description"],
  },
];

function cleanHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/["'׳״`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type ColumnMapping = Partial<Record<ImportField, number>>;

/** איזו עמודה בקובץ היא איזה שדה (התאמה מדויקת אחרי ניקוי; "type" — רק אם אין קטגוריה אחרת) */
export function detectMapping(headers: string[]): ColumnMapping {
  const cleaned = headers.map(cleanHeader);
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  for (const field of IMPORT_FIELDS) {
    for (const alias of field.aliases) {
      const index = cleaned.findIndex((header, i) => !used.has(i) && header === cleanHeader(alias));
      if (index >= 0) {
        // "type" ב-WooCommerce = סוג המוצר (simple / variable) — לא קטגוריה
        if (field.key === "category" && (alias === "type" || alias === "product type")) {
          const hasRealCategory = cleaned.some((header) =>
            ["categories", "category", "קטגוריה", "קטגוריות", "product category"].includes(header),
          );
          if (hasRealCategory) continue;
        }
        mapping[field.key] = index;
        used.add(index);
        break;
      }
    }
  }
  // WooCommerce: עמודת Type (simple / variable / variation) — לזיהוי שורות וריאציה
  const typeIndex = cleaned.findIndex((header, i) => header === "type" && !used.has(i));
  if (typeIndex >= 0) mapping.type = typeIndex;
  return mapping;
}

/** השורה כפי שנשלחת ל-import_products במסד */
export type ImportRow = {
  /** מספר השורה בקובץ (כולל שורת הכותרות) — להודעות שגיאה */
  row: number;
  name: string;
  price: string;
  /** הקטגוריה הראשית (הרמה העמוקה בנתיב הראשון) — לתצוגה המקדימה */
  category: string;
  /** חלק 18: כל הקטגוריות — כל אחת נתיב מהשורש ("מחשבים" > "ניידים") */
  categories: string[][];
  description: string;
  sku: string;
  barcode: string;
  stock: string;
  /** התמונה הראשית (הראשונה ברשימה) */
  image_url: string;
  /** חלק 18: כל קישורי התמונות מהקובץ, לפי הסדר (השרת מוריד ומחליף בקישורים שלנו) */
  images: string[];
  sale_price: string;
  sale_ends_at: string;
  cost_price: string;
  hidden: string;
  show_in_zap: string;
  seo_title: string;
  seo_description: string;
};

/** "₪1,234.50" / "1234,5" / "1 234" → "1234.50"; לא מספר → הערך המקורי (המסד יסרב בהודעה ברורה) */
export function normalizeNumber(value: string): string {
  const raw = value.trim();
  if (raw === "") return "";
  let text = raw.replace(/₪|ש"ח|ש״ח|nis|ils/gi, "").replace(/[\s\u00a0]/g, "");
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) text = text.replace(/,/g, "");
  else if (/^\d+,\d{1,2}$/.test(text)) text = text.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(text)) return raw;
  const num = Number(text);
  if (!Number.isFinite(num)) return raw;
  return Number.isInteger(num) ? String(num) : String(Math.round(num * 10000) / 10000);
}

/** "12" / "12.0" → "12"; ריק → "" */
function normalizeInteger(value: string): string {
  const number = normalizeNumber(value);
  if (/^\d+\.0+$/.test(number)) return number.replace(/\.0+$/, "");
  return number;
}

/** "31/12/2026" / "31.12.2026" / "2026-12-31" / "2026-12-31 23:59:59" → "2026-12-31" */
export function normalizeDate(value: string): string {
  const raw = value.trim();
  if (raw === "") return "";
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2]!.padStart(2, "0")}-${iso[3]!.padStart(2, "0")}`;
  const dmy = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
  return "";
}

/** שם קטגוריה נקי: בלי מירכאות סביב, רווחים כפולים, עד 30 תווים (כמו במסד) */
export function cleanCategoryName(value: string): string {
  return value
    .replace(/^[\s"'״׳]+|[\s"'״׳]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, CATEGORY_NAME_MAX)
    .trim();
}

/**
 * עמודת הקטגוריות → רשימת נתיבים.
 *   "מחשבים ניידים,ציוד נלווה כבלים"  → [["מחשבים ניידים"], ["ציוד נלווה כבלים"]]
 *   "מחשבים > ניידים, כבלים"           → [["מחשבים", "ניידים"], ["כבלים"]]
 *   "Cat A|Cat B" / שורות נפרדות      → [["Cat A"], ["Cat B"]]
 * מפרידי היררכיה: ">", "»", " / " (לוכסן עם רווחים; "כבלים/מתאמים" נשאר שם אחד).
 * כפילויות (אותה קטגוריה סופית) — פעם אחת. עד 10.
 */
export function parseCategoryList(value: string): string[][] {
  const paths: string[][] = [];
  const seen = new Set<string>();
  for (const part of value.split(/[,|;\n]+/)) {
    const path = part
      .split(/\s*(?:>|»|\s\/\s)\s*/)
      .map(cleanCategoryName)
      .filter(Boolean);
    const leaf = path[path.length - 1];
    if (!leaf || seen.has(leaf)) continue;
    seen.add(leaf);
    paths.push(path);
    if (paths.length >= MAX_CATEGORIES_PER_PRODUCT) break;
  }
  return paths;
}

/** הקטגוריה הראשית: הרמה העמוקה בנתיב הראשון ("" = בלי קטגוריה) */
function primaryCategory(paths: string[][]): string {
  const first = paths[0];
  return first ? (first[first.length - 1] ?? "") : "";
}

/** קישור אחד: http(s) בלבד; "//cdn..." → https; &amp; → & */
function cleanImageUrl(raw: string): string | null {
  let url = raw.trim().replace(/&amp;/gi, "&");
  if (url.startsWith("//")) url = `https:${url}`;
  if (!/^https?:\/\/[^\s/]+/i.test(url) || url.length > 1000) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * עמודת התמונות → רשימת קישורים נקיים (לפי הסדר, בלי כפילויות, עד 10).
 * נתמך:
 *   "image:https://a.jpeg;alt:טקסט||image:https://b.jpeg;alt:"   (|| בין תמונות)
 *   "https://a.jpg, https://b.jpg" (WooCommerce) / "https://a.jpg|https://b.jpg"
 *   "https://a.jpg" (Shopify)
 * פסיק בתוך קישור (Cloudinary: "w_200,h_300") נשמר — מפרידים רק לפני http.
 */
export function parseImageList(value: string): string[] {
  const text = value.trim();
  if (text === "") return [];
  const segments = text.includes("||")
    ? text.split("||")
    : text.includes("|")
      ? text.split("|")
      : text.split(/,(?=\s*(?:https?:)?\/\/)|\s+(?=(?:https?:)?\/\/)|\n+/i);
  const urls: string[] = [];
  for (const segment of segments) {
    // "image:URL;alt:..." — הקישור עד ה-";" (או רווח) הראשון. &amp; — לפני
    // החיפוש, כדי שה-";" שלו לא יקטע את הקישור
    const match = /([a-z][\w+.-]*:)?\/\/[^\s;"'<>]+/i.exec(segment.replace(/&amp;/gi, "&"));
    if (!match) continue;
    // "ftp://..." / "file://..." — לא תמונה מהרשת
    if (match[1] && !/^https?:$/i.test(match[1])) continue;
    const url = cleanImageUrl(match[0].replace(/[),.]+$/, ""));
    if (url && !urls.includes(url)) urls.push(url);
    if (urls.length >= MAX_IMAGES_PER_PRODUCT) break;
  }
  return urls;
}

/** HTML (ייצוא מחנות אחרת) → טקסט עם שורות */
export function htmlToText(value: string): string {
  return value
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeBool(value: string): string {
  const v = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "כן", "v", "✓"].includes(v)) return "true";
  if (["0", "false", "no", "n", "לא", "-1"].includes(v)) return "false";
  return "";
}

export type SkippedRow = { row: number; reason: string };

export type PreparedImport = {
  rows: ImportRow[];
  /** שורות שלא נשלחות בכלל (וריאציה של WooCommerce, שורות המשך של Shopify) */
  skipped: SkippedRow[];
  mapping: ColumnMapping;
  missing: ImportField[];
};

/**
 * מהטבלה לשורות מוכנות לייבוא. firstRowNumber — מספר השורה בקובץ של השורה
 * הראשונה בטבלה (ברירת מחדל 2: שורה 1 = הכותרות). בייבוא במנות (חלק 18)
 * כל מנה נשלחת עם מספר השורה שלה, כדי שההודעות יפנו לשורה הנכונה בקובץ.
 */
export function prepareImport(
  table: CsvTable,
  mapping = detectMapping(table.headers),
  firstRowNumber = 2,
): PreparedImport {
  const missing = IMPORT_FIELDS.filter((f) => f.required && mapping[f.key] === undefined).map(
    (f) => f.key,
  );
  const rows: ImportRow[] = [];
  const skipped: SkippedRow[] = [];
  if (missing.length > 0) return { rows, skipped, mapping, missing };

  const get = (cells: string[], key: ImportField): string => {
    const index = mapping[key];
    return index === undefined ? "" : (cells[index] ?? "").trim();
  };

  table.rows.forEach((cells, index) => {
    const rowNumber = index + firstRowNumber; // שורה 1 = הכותרות
    if (cells.every((value) => value.trim() === "")) return; // שורה ריקה
    const name = get(cells, "name").replace(/\s+/g, " ");
    const type = get(cells, "type").toLowerCase();
    if (type === "variation") {
      skipped.push({
        row: rowNumber,
        reason: "וריאציה של מוצר (WooCommerce) — מוגדרת בעריכת המוצר",
      });
      return;
    }
    if (name === "") {
      // Shopify: שורות המשך של אותו מוצר (תמונות נוספות / וריאציות) — בלי שם
      skipped.push({ row: rowNumber, reason: "שורה בלי שם מוצר" });
      return;
    }
    const description = htmlToText(get(cells, "description") || get(cells, "short_description"));
    const hiddenRaw = normalizeBool(get(cells, "hidden"));
    const publishedRaw = get(cells, "published").toLowerCase();
    const hidden =
      hiddenRaw !== ""
        ? hiddenRaw
        : ["0", "-1", "false", "draft", "archived", "private", "טיוטה", "לא"].includes(publishedRaw)
          ? "true"
          : "";
    const categories = parseCategoryList(get(cells, "category"));
    const images = parseImageList(get(cells, "image_url"));
    rows.push({
      row: rowNumber,
      name: name.slice(0, 200),
      price: normalizeNumber(get(cells, "price")),
      category: primaryCategory(categories),
      categories,
      description: description.slice(0, 5000),
      sku: get(cells, "sku"),
      barcode: get(cells, "barcode").replace(/\s+/g, ""),
      stock: normalizeInteger(get(cells, "stock")),
      image_url: images[0] ?? "",
      images,
      sale_price: normalizeNumber(get(cells, "sale_price")),
      sale_ends_at: normalizeDate(get(cells, "sale_ends_at")),
      cost_price: normalizeNumber(get(cells, "cost_price")),
      hidden,
      show_in_zap: normalizeBool(get(cells, "show_in_zap")),
      seo_title: get(cells, "seo_title").slice(0, 120),
      seo_description: get(cells, "seo_description").slice(0, 320),
    });
  });
  return { rows, skipped, mapping, missing };
}

export type ImportIssue = { row: number; name: string; message: string };

/** סיכום ייבוא — של מנה אחת (מהשרת) או של כל הקובץ (מצטבר בדפדפן) */
export type ImportSummary = {
  /** שורות מוצרים שנשלחו */
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
  /** חלק 18: תמונות שנשמרו אצלנו / שדולגו (במוצרים שנוצרו) */
  images: { saved: number; failed: number };
};

export function emptyImportSummary(): ImportSummary {
  return {
    total: 0,
    created: 0,
    failed: 0,
    duplicates: 0,
    skuReplaced: 0,
    limitReached: false,
    newCategories: [],
    errors: [],
    warnings: [],
    skipped: [],
    images: { saved: 0, failed: 0 },
  };
}

/** צירוף סיכום של מנה לסיכום הכולל (רשימות — עד IMPORT_MAX_LISTED) */
export function mergeImportSummary(total: ImportSummary, batch: ImportSummary): ImportSummary {
  const capped = <T>(list: T[], more: T[]) =>
    list.length >= IMPORT_MAX_LISTED ? list : [...list, ...more].slice(0, IMPORT_MAX_LISTED);
  return {
    total: total.total + batch.total,
    created: total.created + batch.created,
    failed: total.failed + batch.failed,
    duplicates: total.duplicates + batch.duplicates,
    skuReplaced: total.skuReplaced + batch.skuReplaced,
    limitReached: total.limitReached || batch.limitReached,
    newCategories: [
      ...total.newCategories,
      ...batch.newCategories.filter((name) => !total.newCategories.includes(name)),
    ],
    errors: capped(total.errors, batch.errors),
    warnings: capped(total.warnings, batch.warnings),
    skipped: capped(total.skipped, batch.skipped),
    images: {
      saved: total.images.saved + batch.images.saved,
      failed: total.images.failed + batch.images.failed,
    },
  };
}

/** מנה לשליחה: טווח שורות בטבלה [start, end) */
export type ImportBatchPlan = { start: number; end: number; products: number; images: number };

/**
 * חלוקת הקובץ למנות: עד BATCH_MAX_PRODUCTS מוצרים, עד BATCH_MAX_IMAGES
 * קישורי תמונות ועד BATCH_MAX_RAW_ROWS שורות בכל מנה (מוצר עם הרבה תמונות
 * — במנה קטנה יותר). המנות רציפות, לפי סדר הקובץ.
 */
export function planImportBatches(
  table: CsvTable,
  mapping: ColumnMapping = detectMapping(table.headers),
): ImportBatchPlan[] {
  const batches: ImportBatchPlan[] = [];
  const nameIndex = mapping.name;
  const imageIndex = mapping.image_url;
  let current: ImportBatchPlan = { start: 0, end: 0, products: 0, images: 0 };
  table.rows.forEach((cells, index) => {
    const isProduct =
      nameIndex !== undefined &&
      (cells[nameIndex] ?? "").trim() !== "" &&
      (mapping.type === undefined ||
        (cells[mapping.type] ?? "").trim().toLowerCase() !== "variation");
    const images =
      isProduct && imageIndex !== undefined ? parseImageList(cells[imageIndex] ?? "").length : 0;
    const rawRows = index - current.start;
    const full =
      rawRows >= BATCH_MAX_RAW_ROWS ||
      (isProduct &&
        current.products > 0 &&
        (current.products >= BATCH_MAX_PRODUCTS || current.images + images > BATCH_MAX_IMAGES));
    if (full) {
      batches.push({ ...current, end: index });
      current = { start: index, end: index, products: 0, images: 0 };
    }
    if (isProduct) {
      current.products += 1;
      current.images += images;
    }
  });
  if (table.rows.length > current.start) batches.push({ ...current, end: table.rows.length });
  return batches;
}

export function fieldLabel(key: ImportField): string {
  return IMPORT_FIELDS.find((f) => f.key === key)?.label ?? key;
}

/** קובץ לדוגמה להורדה (עם BOM — נפתח נכון באקסל בעברית) */
export const SAMPLE_CSV = [
  'שם המוצר,מחיר,קטגוריה,תיאור,מק"ט,ברקוד,מלאי,תמונה,מחיר מבצע,סיום מבצע,הצג בזאפ',
  'חולצת כותנה,79.90,"ביגוד > חולצות,מבצעי החודש","חולצה נוחה מכותנה 100%",,7290000000001,25,"image:https://example.com/shirt-front.jpg;alt:חולצה מלפנים||image:https://example.com/shirt-back.jpg;alt:",59.90,31/12/2026,כן',
  "ספל קרמיקה,35,כלי בית,ספל 350 מ״ל,,7290000000002,40,https://example.com/mug.jpg,,,כן",
].join("\r\n");

/** פענוח קובץ שהועלה: UTF-8, ואם לא — Windows-1255 (אקסל בעברית שומר כך) */
export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1255").decode(bytes);
  }
}
