/**
 * נתונים מובנים לגוגל (חלק 21) — JSON-LD לפי schema.org, ותגיות לעמודי
 * הקטלוג. לוגיקה טהורה (בלי גישה לרשת), כדי שאפשר לבדוק אותה בנפרד:
 *  • מסך הבית: WebSite + Organization (או LocalBusiness כשיש כתובת לעסק) —
 *    שם החנות, הלוגו ואמצעי הקשר. זה מה שעוזר לגוגל להבין שזה אתר של עסק
 *    ולהציג אותו עם Sitelinks ופרטי קשר.
 *  • עמוד מוצר: Product + Offer (מחיר, מטבע, זמינות במלאי) + BreadcrumbList
 *    (בית ← קטגוריה ← מוצר) — "תוצאה עשירה" עם מחיר וזמינות בחיפוש.
 *  • עמודי קטלוג / קטגוריה: כותרת ותיאור דינאמיים.
 */

/** הפרטים של החנות לסכמה (מהגדרות האתר) */
export type StoreSchemaInput = {
  name: string;
  /** הכתובת הראשית של החנות (https://…), בלי / בסוף */
  url: string;
  description?: string | null;
  logoUrl?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  /** שעות פעילות כטקסט חופשי (מוצג כמו שהוא) */
  hours?: string | null;
};

/** הפרטים של מוצר לסכמה */
export type ProductSchemaInput = {
  name: string;
  description: string;
  sku: string;
  category: string;
  storeName: string;
  url: string | null;
  /** כל התמונות (הראשית ראשונה) — רק כתובות http(s) */
  images: string[];
  price: number;
  inStock: boolean;
  barcode?: string | null;
  /** סיום מבצע פעיל (ISO) — priceValidUntil */
  saleEndsAt?: string | null;
};

export type BreadcrumbItem = { name: string; url: string | null };

// תווי "סוף שורה" של יוניקוד — תקינים ב-JSON אבל לא בתוך סקריפט ישן
const LINE_SEPARATOR = new RegExp(String.fromCharCode(0x2028), "g");
const PARAGRAPH_SEPARATOR = new RegExp(String.fromCharCode(0x2029), "g");

/**
 * JSON בטוח לתוך <script type="application/ld+json">: "</script>" או "<!--"
 * בתוך טקסט (שם מוצר, תיאור) לא יסגרו את התגית ולא יזריקו HTML.
 */
export function jsonLdText(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(LINE_SEPARATOR, "\\u2028")
    .replace(PARAGRAPH_SEPARATOR, "\\u2029");
}

// openingHours בפורמט של schema.org ("Mo-Th 09:00-18:00; Fr 09:00-13:00") — טקסט
// חופשי בעברית ("א'-ה' 09:00-18:00") לא תקין שם וגוגל מסמן אותו כשגיאה, אז מדלגים
const DAY = "(?:Mo|Tu|We|Th|Fr|Sa|Su)";
const SCHEMA_HOURS = new RegExp(
  `^${DAY}(?:-${DAY})?(?:,${DAY}(?:-${DAY})?)*\\s+\\d{2}:\\d{2}-\\d{2}:\\d{2}(?:\\s*[;,]\\s*${DAY}(?:-${DAY})?(?:,${DAY}(?:-${DAY})?)*\\s+\\d{2}:\\d{2}-\\d{2}:\\d{2})*$`,
);
export const schemaOpeningHours = (hours: string | null | undefined): string | null => {
  const text = (hours ?? "").replace(/\s+/g, " ").trim();
  return SCHEMA_HOURS.test(text) ? text : null;
};

const isHttpUrl = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^https?:\/\/[^\s"'<>]+$/i.test(value);

const clean = (value: string | null | undefined): string | null => {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
};

/** טלפון ישראלי לפורמט בינלאומי (‎+972…) — גוגל מעדיף; אחר — כמו שהוא */
export function schemaPhone(phone: string | null | undefined): string | null {
  const raw = clean(phone);
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (/^0\d{8,9}$/.test(digits)) return `+972-${digits.slice(1)}`;
  if (/^\+?972\d{8,9}$/.test(digits)) return `+972-${digits.replace(/^\+?972/, "")}`;
  if (/^\*?\d{4}$/.test(raw.replace(/\s/g, ""))) return raw.replace(/\s/g, ""); // *1234
  return raw;
}

/**
 * מסך הבית: WebSite + Organization / LocalBusiness ב-@graph אחד (מקושרים
 * ב-@id). עסק עם כתובת — LocalBusiness (Store), עם כתובת ושעות; בלי כתובת —
 * Organization (חנות אונליין).
 */
export function storeJsonLd(store: StoreSchemaInput): Record<string, unknown> {
  const url = store.url.replace(/\/+$/, "");
  const orgId = `${url}/#organization`;
  const phone = schemaPhone(store.phone);
  const email = clean(store.email);
  const address = clean(store.address);
  const hours = schemaOpeningHours(store.hours);
  const description = clean(store.description);
  const logo = isHttpUrl(store.logoUrl) ? store.logoUrl : null;

  const organization: Record<string, unknown> = {
    "@type": address ? ["Store", "LocalBusiness"] : "Organization",
    "@id": orgId,
    name: store.name,
    url: `${url}/`,
    ...(description ? { description } : {}),
    ...(logo ? { logo: { "@type": "ImageObject", url: logo }, image: logo } : {}),
    ...(phone ? { telephone: phone } : {}),
    ...(email ? { email } : {}),
    ...(address
      ? {
          address: { "@type": "PostalAddress", streetAddress: address, addressCountry: "IL" },
        }
      : {}),
    ...(address && hours ? { openingHours: hours } : {}),
    ...(phone || email
      ? {
          contactPoint: {
            "@type": "ContactPoint",
            contactType: "customer service",
            ...(phone ? { telephone: phone } : {}),
            ...(email ? { email } : {}),
            areaServed: "IL",
            availableLanguage: ["Hebrew"],
          },
        }
      : {}),
  };

  const website: Record<string, unknown> = {
    "@type": "WebSite",
    "@id": `${url}/#website`,
    url: `${url}/`,
    name: store.name,
    inLanguage: "he-IL",
    publisher: { "@id": orgId },
    ...(description ? { description } : {}),
  };

  return { "@context": "https://schema.org", "@graph": [website, organization] };
}

/** עמוד מוצר: Product + Offer — מחיר, מטבע וזמינות במלאי בתוצאות החיפוש */
export function productJsonLd(product: ProductSchemaInput): Record<string, unknown> {
  const images = product.images.filter(isHttpUrl);
  const barcode = (product.barcode ?? "").trim();
  const gtin = /^\d{13}$/.test(barcode)
    ? { gtin13: barcode }
    : /^\d{12}$/.test(barcode)
      ? { gtin12: barcode }
      : /^\d{8}$/.test(barcode)
        ? { gtin8: barcode }
        : {};
  const saleEnds =
    product.saleEndsAt && !Number.isNaN(Date.parse(product.saleEndsAt))
      ? new Date(product.saleEndsAt).toISOString().slice(0, 10)
      : null;
  return {
    "@context": "https://schema.org/",
    "@type": "Product",
    name: product.name,
    description: product.description,
    sku: product.sku,
    category: product.category,
    brand: { "@type": "Brand", name: product.storeName },
    ...(images.length > 0 ? { image: images } : {}),
    ...(product.url ? { url: product.url } : {}),
    ...gtin,
    offers: {
      "@type": "Offer",
      priceCurrency: "ILS",
      price: product.price.toFixed(2),
      availability: product.inStock
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@type": "Organization", name: product.storeName },
      ...(saleEnds ? { priceValidUntil: saleEnds } : {}),
      ...(product.url ? { url: product.url } : {}),
    },
  };
}

/** פירורי לחם: בית ← קטגוריה ← מוצר (פריט בלי כתובת — האחרון, העמוד עצמו) */
export function breadcrumbJsonLd(items: BreadcrumbItem[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      ...(item.url ? { item: item.url } : {}),
    })),
  };
}

/** כתובת עמוד קטגוריה בקטלוג */
export function categoryUrl(origin: string, category: string): string {
  return `${origin.replace(/\/+$/, "")}/?category=${encodeURIComponent(category)}`;
}

/** כותרת ותיאור לעמוד קטגוריה בקטלוג */
export function categoryMeta(
  siteName: string,
  category: string,
): { title: string; description: string } {
  const name = clean(category) ?? category;
  return {
    title: `${name} | ${siteName}`,
    description: `${name} ב${siteName} — כל המוצרים בקטגוריה, מחירים גלויים, מבצעים והזמנה אונליין מהירה.`,
  };
}
