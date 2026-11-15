// Google Tag Manager (מיגרציה 192) — החלק הטהור: אימות המזהה, כתובת הסקריפט, כתובת עמוד נקייה ומפתח
// לצפייה בעמוד. משותף לשני המנועים ולשרת. אין כאן שום קוד חופשי: מה שנכנס לדף הוא רק מזהה Container
// שעבר את התבנית (כמו ה-CHECK במסד), ותמיד מקודד בתוך כתובת קבועה של Google.

/** מזהה Container: GTM- ואחריו 4 עד 12 אותיות גדולות באנגלית / ספרות (בדיוק כמו במסד) */
export const GTM_ID_FORMAT = /^GTM-[A-Z0-9]{4,12}$/;

export const GTM_SCRIPT_ORIGIN = "https://www.googletagmanager.com";

/** שם האירוע שהאתר דוחף ל-dataLayer בכל צפייה בעמוד (כולל מעבר עמוד בלי טעינה מחדש) */
export const GTM_PAGE_VIEW_EVENT = "nuriel_page_view";

/** ההגדרה השמורה של האתר (למסך של בעל העסק) */
export type MyTagManager = {
  container_id: string | null;
  enabled: boolean;
  updated_at: string | null;
  /** המזהה השמור נטען באתר (צימר: רק כשהמדידה הופעלה לאתר בפלטפורמה) */
  loads_on_site: boolean;
};

export class GtmInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GtmInputError";
  }
}

export function isGtmId(value: unknown): value is string {
  return typeof value === "string" && GTM_ID_FORMAT.test(value);
}

/** קלט מהמסך: רווחים ואותיות קטנות — מתוקנים; ריק — null (מחיקה); כל דבר אחר — שגיאה */
export function normalizeGtmId(raw: unknown): string | null {
  const value = String(raw ?? "")
    .trim()
    .toUpperCase();
  if (value === "") return null;
  if (!GTM_ID_FORMAT.test(value)) {
    throw new GtmInputError(
      "מזהה Google Tag Manager לא תקין — בתבנית GTM-XXXXXXX (אותיות באנגלית וספרות)",
    );
  }
  return value;
}

/** כתובת הסקריפט הרשמי — רק למזהה תקין (אחרת null, ושום דבר לא נטען) */
export function gtmScriptSrc(id: string): string | null {
  return isGtmId(id) ? `${GTM_SCRIPT_ORIGIN}/gtm.js?id=${encodeURIComponent(id)}` : null;
}

export const UTM_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
] as const;

/**
 * נתיבים עם מזהה אישי בכתובת (הזמנה, סל משותף, קישור אישי) — נשלחים כתבנית, אף פעם עם המזהה.
 * הקישורים האישיים של האורחים בצימרים יושבים אחרי ה-# (#t=…), שלא נשלח בכלל.
 */
const PERSONAL_PATHS: [RegExp, string][] = [
  [/^\/checkout\/(grow|bit)\/[^/]+/, "/checkout/$1/:id"],
  [/^\/cart\/[^/]+/, "/cart/:code"],
  [/^\/order\/[^/]+/, "/order/:id"],
  [/^\/license\/[^/]+/, "/license/:token"],
  [/^\/sign\/[^/]+/, "/sign/:token"],
];

/** https://site/checkout/grow/abc?x=1&utm_source=fb#t=… → https://site/checkout/grow/:id?utm_source=fb */
export function cleanPageLocation(href: string): string {
  try {
    const u = new URL(href);
    let path = u.pathname;
    for (const [re, template] of PERSONAL_PATHS) {
      if (re.test(path)) {
        path = path.replace(re, template);
        break;
      }
    }
    const keep = new URLSearchParams();
    for (const k of UTM_PARAMS) {
      const v = u.searchParams.get(k);
      if (v) keep.set(k, v.slice(0, 100));
    }
    const q = keep.toString();
    return `${u.origin}${path}${q ? `?${q}` : ""}`;
  } catch {
    return "";
  }
}
