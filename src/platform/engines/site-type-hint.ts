// סוג האתר של הבקשה — בלי פנייה נוספת למסד, לנתב (מיפוי כתובות לפי מנוע; src/app/site-router.ts):
//   • בשרת — מהאתר שזוהה לבקשה (src/server.ts רושם את __requestSiteType לפני העיבוד);
//   • בדפדפן — מתגית meta ש-ה-root מוסיף באתרים שהמנוע שלהם צריך את זה (SITE_TYPE_META).
// אין כאן ידיעה על מנוע מסוים — רק הערך.

export const SITE_TYPE_META = "nuriel-site-type";

export function requestSiteTypeHint(): string | null {
  if (typeof window === "undefined") {
    const hook = (globalThis as typeof globalThis & { __requestSiteType?: () => string | null })
      .__requestSiteType;
    return hook?.() ?? null;
  }
  return (
    document.head.querySelector(`meta[name="${SITE_TYPE_META}"]`)?.getAttribute("content") ?? null
  );
}
