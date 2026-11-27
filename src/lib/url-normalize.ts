// נרמול כתובות בקצה (src/server.ts), לפני זיהוי האתר — לכל האתרים בפלטפורמה (חנויות, צימרים, אתרי עסק,
// דומיינים אישיים, הפלטפורמה): "/" בסוף הנתיב ו-"//" כפול → הפניה קבועה (308) לכתובת הנקייה.
//
// למה בקצה ולא בנתב: הנתב (TanStack) מפנה כתובת עם "/" בסוף ב-307 — הפניה זמנית. לפי Google Search
// Central, 301/308 הן אות חזק לכתובת הקנונית ו-307 לא; הפניה זמנית משאירה את שתי הכתובות "מועמדות".
// 308 (ולא 301) — אותה שיטת בקשה נשמרת. רק GET/HEAD; פונקציות שרת, API, קבצים סטטיים — לא נוגעים.
//
// אבטחה: הכתובת החדשה היא תמיד נתיב יחסי שמתחיל ב-"/" אחד בדיוק (אחרי איחוד "//"), כך שאין הפניה
// פתוחה לדומיין אחר (//evil.com → /evil.com). ה-URL כבר עבר את מנתח ה-WHATWG (\ → /, תווי בקרה
// מקודדים), ומחרוזת השאילתה נשמרת כמו שהיא.

const SKIP = /^\/(?:_serverFn|api|assets|\.well-known)(?:\/|$)/;

/** הנתיב (עם השאילתה) שאליו להפנות, או null כשהכתובת כבר נקייה / לא שלנו לנרמל */
export function normalizedPathRedirect(method: string, url: URL): string | null {
  if (method !== "GET" && method !== "HEAD") return null;
  const path = url.pathname;
  if (path === "/" || SKIP.test(path)) return null;
  let next = path.replace(/\/{2,}/g, "/");
  if (next.length > 1) next = next.replace(/\/+$/, "") || "/";
  if (next === path) return null;
  return `${next}${url.search}`;
}

/** התגובה עצמה: 308 עם Location יחסי. מטמון יום — הפניה קבועה, אבל לא לנצח אם משהו ישתנה */
export function normalizedPathResponse(location: string): Response {
  return new Response(null, {
    status: 308,
    headers: { location, "cache-control": "public, max-age=86400" },
  });
}
