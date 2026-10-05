/**
 * דומיין מותאם אישית לחנות — עזרים משותפים לדפדפן ולשרת.
 * (בדיקת ה-DNS עצמה — custom-domain-dns.server.ts; הפעולות — custom-domain.functions.ts)
 */

export type CustomDomainStatus = "pending" | "verified" | "active" | "error";

export const CUSTOM_DOMAIN_STATUS_LABEL: Record<CustomDomainStatus, string> = {
  pending: "ממתין לאימות DNS",
  verified: "מאומת — מכינים תעודת SSL",
  active: "פעיל",
  error: "שגיאה",
};

/** אותו פורמט כמו ה-CHECK במסד (ASCII / punycode, בלי נקודה בסוף) */
export const CUSTOM_DOMAIN_FORMAT =
  /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/**
 * סיומות "דו-שלביות" נפוצות: his-shop.co.il הוא דומיין ראשי (לא תת-דומיין
 * של co.il). משמש רק להוראות (CNAME מול A, ומה לכתוב בשדה "שם").
 */
const SECOND_LEVEL_SUFFIXES = new Set([
  "co.il",
  "org.il",
  "net.il",
  "ac.il",
  "gov.il",
  "muni.il",
  "k12.il",
  "idf.il",
  "co.uk",
  "org.uk",
  "me.uk",
  "com.au",
  "net.au",
  "org.au",
  "co.nz",
  "com.br",
  "com.tr",
  "co.za",
  "com.cy",
]);

/**
 * ניקוי מה שהמשתמש הדביק: "https://WWW.Shop.co.il/about" → "www.shop.co.il".
 * דומיין בעברית הופך ל-punycode (xn--...), כמו שהדפדפן שולח אותו.
 */
export function normalizeDomainInput(raw: string): string {
  let value = raw.trim().toLowerCase();
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.split(/[/?#]/)[0] ?? "";
  value = value.replace(/:\d+$/, "").replace(/\.+$/, "");
  if (value === "") return "";
  try {
    return new URL(`http://${value}`).hostname.toLowerCase().replace(/\.+$/, "");
  } catch {
    return value;
  }
}

/**
 * הקלט של מנהל החנות: רק הדומיין — בלי http:// / https:// ובלי נתיב
 * (null = תקין). נבדק לפני customDomainProblem, כדי להסביר מה להסיר.
 */
export function domainInputFormatProblem(raw: string): string | null {
  const value = raw.trim();
  if (value === "") return null;
  if (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ||
    /^https?(:|\/\/)/i.test(value) ||
    /^www:/i.test(value)
  ) {
    // \u200e — כדי ש-"://" יוצג נכון בתוך משפט בעברית
    return "בלי http://\u200e או https://\u200e — הזינו רק את הדומיין, למשל www.his-shop.co.il";
  }
  if (/[/?#\\]/.test(value)) {
    return "בלי / ובלי נתיב — הזינו רק את הדומיין, למשל www.his-shop.co.il";
  }
  if (/\s/.test(value)) return "הדומיין לא יכול להכיל רווחים";
  return null;
}

/** בעיה בפורמט הדומיין (null = תקין) */
export function customDomainProblem(domain: string, baseDomain: string | null): string | null {
  if (domain === "") return "נא להזין דומיין, למשל www.his-shop.co.il";
  if (domain.length > 253 || !CUSTOM_DOMAIN_FORMAT.test(domain)) {
    return "הדומיין אינו תקין. כותבים רק את הדומיין, למשל www.his-shop.co.il (בלי https:// ובלי /)";
  }
  if (baseDomain && (domain === baseDomain || domain.endsWith(`.${baseDomain}`))) {
    return `כתובות של ${baseDomain} שייכות למערכת — הזינו דומיין שרכשתם בעצמכם`;
  }
  return null;
}

/** החלק "הראשי" של הדומיין: his-shop.co.il / shop.com */
export function registrableDomain(domain: string): string {
  const labels = domain.split(".");
  if (labels.length >= 3 && SECOND_LEVEL_SUFFIXES.has(labels.slice(-2).join("."))) {
    return labels.slice(-3).join(".");
  }
  return labels.slice(-2).join(".");
}

/** דומיין ראשי (בלי www / תת-דומיין)? — לו אי אפשר CNAME, רק רשומת A */
export function isApexDomain(domain: string): boolean {
  return registrableDomain(domain) === domain;
}

/**
 * מה כותבים בשדה "שם / Host" אצל רשם הדומיין: "www" ל-www.his-shop.co.il,
 * "@" לדומיין הראשי.
 */
export function dnsRecordName(domain: string): string {
  const root = registrableDomain(domain);
  if (domain === root) return "@";
  return domain.slice(0, -(root.length + 1));
}
