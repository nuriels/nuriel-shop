// הגדרות מנוע אתרי העסקים (Nuriel Websites, ‏business_profile — מיגרציה 193)

/** מפתחות הדגלים (כבויים כברירת מחדל) */
export const BP_FLAGS = {
  /** המנוע וממשק הניהול (/studio) */
  enabled: "business_profile_enabled",
  /** האתר הציבורי (רק גרסה מפורסמת שאושרה) */
  public: "business_profile_public",
} as const;

/** קבצי פונקציות השרת של המנוע */
export const BP_SOURCE_PREFIX = "src/engines/business-profile/";

/** מתג חירום בסביבה: רק "on" מפעיל; לא מוגדר = כבוי (ברירת המחדל בייצור) */
export const BP_ENGINE_ENV = "BUSINESS_PROFILE_ENGINE";

export function businessProfileSwitchOn(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (env[BP_ENGINE_ENV] ?? "").trim().toLowerCase() === "on";
}

/** ממשק הניהול של בעל העסק */
export const STUDIO_PATH = "/studio";

/**
 * הקידומת הפנימית של עמודי האתר הציבורי בנתב. הגולש לא רואה אותה: באתר עסק בלבד, הנתב ממפה
 * "/x" ↔ "/bp-site/x" (edge/rewrite.ts). בכל אתר אחר הנתיבים האלה לא קיימים (404).
 */
export const SITE_ROUTE_PREFIX = "/bp-site";
