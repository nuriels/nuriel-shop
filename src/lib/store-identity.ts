import { DEFAULT_STORE_NAME } from "@/lib/branding";

/**
 * זהות החנות (StoreIdentity) — מקור אחד לשם של כל חנות, בכל מקום: כותרות,
 * Open Graph, Schema (WebSite / Organization / seller), פירורי לחם, H1, פיד
 * המוצרים, llms.txt, מיילים, מסמכים וטקסטים באתר. לוגיקה טהורה — אותה
 * פונקציה בשרת ובדפדפן, תמיד עם הנתונים של החנות הנוכחית בלבד
 * (site_settings של ה-tenant).
 *
 * שני שדות שבעל החנות מגדיר:
 *  - business_name — "שם העסק הרשמי" (הגדרות האתר ← פרטי העסק). המקור הראשי.
 *  - site_title    — "כותרת האתר (שם החנות)" (עיצוב דף הבית). שם התצוגה.
 *
 * הכללים:
 *  - name          — שם העסק, אחריו שם התצוגה, ואם שניהם ריקים "החנות שלי".
 *                    לגוגל, לשיתוף, למסמכים ולמיילים.
 *  - displayName   — הכותרת הגלויה באתר: שם התצוגה, אחריו שם העסק (כמו היום).
 *  - alternateName — שם התצוגה כשיש גם שם עסק והם שונים (Schema: alternateName).
 *  - ownName       — השם שבעל החנות הזין (שם העסק ואחריו שם התצוגה), בלי ברירת
 *                    מחדל: null כשאין. למקומות שיש להם טקסט משלהם כשאין שם
 *                    (מסמכים משפטיים — "[שם העסק]", הסכמות, תוויות).
 *
 * "סוכנות המשקאות" היא ברירת המחדל הישנה של העמודה site_title (מיגרציה
 * 20260907120000_b2b_beverage_platform.sql) — ערך שבעל החנות לא בחר, ולכן הוא
 * לא נחשב שם: עוברים למקור הבא. זה לא מחליף שום ערך במסד. שם עסק
 * (business_name) עם אותו ערך כן נחשב — בעמודה הזו אין ברירת מחדל כזו.
 */

/** ערכים של site_title שהגיעו מברירת מחדל ישנה של העמודה, ולא מבעל החנות */
export const LEGACY_SITE_TITLE_DEFAULTS: readonly string[] = ["סוכנות המשקאות"];

export type StoreNameFields = {
  business_name?: string | null | undefined;
  site_title?: string | null | undefined;
};

export type StoreNames = {
  name: string;
  displayName: string;
  alternateName: string | null;
  ownName: string | null;
};

const text = (value: string | null | undefined): string =>
  typeof value === "string" ? value.trim() : "";

export function storeNames(fields: StoreNameFields | null | undefined): StoreNames {
  const business = text(fields?.business_name);
  const title = text(fields?.site_title);
  const display = title !== "" && !LEGACY_SITE_TITLE_DEFAULTS.includes(title) ? title : "";
  const own = business || display || null;
  return {
    name: own ?? DEFAULT_STORE_NAME,
    displayName: display || business || DEFAULT_STORE_NAME,
    alternateName:
      business !== "" && display !== "" && display.toLowerCase() !== business.toLowerCase()
        ? display
        : null,
    ownName: own,
  };
}

/**
 * כותרת לעמוד מידע: "אודות | שם החנות". השם מה-root (getSiteSeo → siteName),
 * כך שכל חנות מקבלת את השם שלה; בלי שם (למשל שגיאה בטעינה) — רק שם העמוד.
 */
export function pageTitle(
  page: string,
  matches: ReadonlyArray<{ routeId?: string; loaderData?: unknown }>,
): string {
  const root = matches.find((match) => match.routeId === "__root__")?.loaderData as
    { siteName?: unknown } | undefined;
  const name = typeof root?.siteName === "string" ? root.siteName.trim() : "";
  return name ? `${page} | ${name}` : page;
}
