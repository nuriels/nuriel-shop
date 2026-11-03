/**
 * SEC-M1: כותרות אבטחה לכל תגובה של השרת המשותף (חנויות, שער הפלטפורמה, /admin, /platform).
 * עד כה רק עמודי Hospitality קיבלו אותן (דרך ה-headers של הנתיבים שלהם) — השאר נשלחו בלי
 * כותרות כלל, ולכן אזור הניהול היה ניתן למסגור (clickjacking) ובלי HSTS.
 *
 * כאן — "רשת ביטחון": מוסיפים רק כותרת שעוד לא קיימת בתגובה. כך עמודי Hospitality (שכבר קובעים
 * כותרות משלהם) לא משתנים.
 *  • HSTS (180 יום; בלי includeSubDomains — כל חנות בתת-דומיין משלה) ו-nosniff — לכל תגובה;
 *  • למסמכי HTML גם: מסגור רק מאותו אתר (X-Frame-Options + frame-ancestors), Referrer-Policy,
 *    Permissions-Policy (מצלמה — רק לאתר עצמו: סריקת ברקוד בקופה / בקליטה / בספירת מלאי), ו-CSP
 *    בסיסי שלא שובר כלום (base-uri, object-src, form-action). CSP מלא לסקריפטים (nonce) — המשך.
 * טהור — נבדק ביחידה.
 */

const ALWAYS: Readonly<Record<string, string>> = {
  "Strict-Transport-Security": "max-age=15552000",
  "X-Content-Type-Options": "nosniff",
};

const DOCUMENT: Readonly<Record<string, string>> = {
  ...ALWAYS,
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy":
    "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "Content-Security-Policy":
    "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'",
};

/** הכותרות שיתווספו לתגובה מהסוג הזה (רק אלה שחסרות בה) */
export function missingSecurityHeaders(headers: Headers): [string, string][] {
  const isDocument = (headers.get("content-type") ?? "").toLowerCase().includes("text/html");
  return Object.entries(isDocument ? DOCUMENT : ALWAYS).filter(([name]) => !headers.has(name));
}

/** מוסיף לתגובה את כותרות האבטחה החסרות (תגובה עם כותרות "נעולות" — מועתקת) */
export function withSecurityHeaders(response: Response): Response {
  const missing = missingSecurityHeaders(response.headers);
  if (missing.length === 0) return response;
  try {
    for (const [name, value] of missing) response.headers.set(name, value);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    for (const [name, value] of missing) headers.set(name, value);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}
