import { categoryUrl } from "@/lib/structured-data";

/**
 * כתובות קנוניות ופירורי לחם (חלק 31) — לוגיקה טהורה, משותפת לשרת ולדפדפן.
 *
 * הכתובת הקנונית = הכתובת הרשמית של החנות (דומיין אישי פעיל, אחרת הסאב-
 * דומיין — tenantSiteOrigin) + הנתיב של העמוד, בלי פרמטרים שלא משנים תוכן
 * (?cart=, ?view=, utm…). כך חנות שנגישה גם מהסאב-דומיין וגם מהדומיין
 * האישי לא נספרת אצל גוגל כ"תוכן כפול".
 *
 * רק עמודים ציבוריים מקבלים כתובת קנונית; אזורים פרטיים (ניהול, חשבון,
 * קופה, התחברות…) — בלי, והם גם חסומים ב-robots.txt.
 */

/** עמודי המידע הקבועים של החנות */
export const STATIC_PUBLIC_PATHS: readonly string[] = [
  "/about",
  "/contact",
  "/terms",
  "/privacy",
  "/cancellations",
  "/sitemap",
];

const PRODUCT_PATH = /^\/product\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTENT_PAGE_PATH = /^\/pages\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * הנתיב הקנוני של עמוד (או null — עמוד שלא מיועד לאינדוקס).
 * דף הבית שומר רק את ?category= (עמוד קטגוריה הוא עמוד בפני עצמו).
 */
export function canonicalPath(
  pathname: string,
  search: Record<string, unknown> | null | undefined,
): string | null {
  let path = pathname.split(/[?#]/)[0] || "/";
  if (path.length > 1) path = path.replace(/\/+$/, "") || "/";
  if (path === "/") {
    const category = search?.["category"];
    return typeof category === "string" && category.trim() !== ""
      ? `/?category=${encodeURIComponent(category)}`
      : "/";
  }
  if (PRODUCT_PATH.test(path)) return path.toLowerCase();
  if (CONTENT_PAGE_PATH.test(path)) return path;
  return STATIC_PUBLIC_PATHS.includes(path) ? path : null;
}

/** הכתובת הקנונית המלאה (או null) */
export function canonicalUrl(
  origin: string | null | undefined,
  pathname: string,
  search?: Record<string, unknown> | null,
): string | null {
  if (!origin || !/^https?:\/\/[^/\s]+$/i.test(origin.replace(/\/+$/, ""))) return null;
  const path = canonicalPath(pathname, search);
  if (path === null) return null;
  const base = origin.replace(/\/+$/, "");
  return path.startsWith("/?") ? categoryUrlFromPath(base, path) : `${base}${path}`;
}

function categoryUrlFromPath(base: string, path: string): string {
  const name = decodeURIComponent(path.slice("/?category=".length));
  return categoryUrl(base, name);
}

/** כתובת שאסור שתופיע במפת האתר / בכתובת קנונית (פיתוח מקומי, IP) */
export function isLocalOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
      host.startsWith("[") ||
      host === "0.0.0.0"
    );
  } catch {
    return true;
  }
}

/** מפת "קטגוריה ← קטגוריית אב" (null = קטגוריה ראשית) */
export type CategoryParents = Record<string, string | null>;

export function categoryParentsFrom(
  rows: readonly { name: string; parent_name: string | null }[] | null | undefined,
): CategoryParents {
  const parents: CategoryParents = {};
  for (const row of rows ?? []) {
    if (typeof row.name === "string" && row.name !== "")
      parents[row.name] = row.parent_name || null;
  }
  return parents;
}

/**
 * השרשרת מהקטגוריה הראשית ועד הקטגוריה עצמה: "ציוד היקפי" תחת "מחשבים" →
 * ["מחשבים", "ציוד היקפי"]. עמיד למעגלים ולעומק חריג (עד 8 רמות).
 */
export function categoryTrail(category: string, parents: CategoryParents): string[] {
  const trail: string[] = [];
  const seen = new Set<string>();
  let current: string | null = category;
  while (current && !seen.has(current) && trail.length < 8) {
    trail.unshift(current);
    seen.add(current);
    current = parents[current] ?? null;
  }
  return trail;
}

/** פירורי לחם: בית ← קטגוריות (עם כתובות) ← העמוד עצמו (בלי כתובת) */
export function breadcrumbTrail(
  origin: string,
  storeName: string,
  categories: readonly string[],
  current: string | null,
): { name: string; url: string | null }[] {
  const base = origin.replace(/\/+$/, "");
  const items: { name: string; url: string | null }[] = [{ name: storeName, url: `${base}/` }];
  categories.forEach((name, index) => {
    const isLast = current === null && index === categories.length - 1;
    items.push({ name, url: isLast ? null : categoryUrl(base, name) });
  });
  if (current !== null) items.push({ name: current, url: null });
  return items;
}
