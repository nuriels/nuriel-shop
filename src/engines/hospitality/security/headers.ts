// כותרות אבטחה לעמודי Hospitality (האתר הציבורי ואזור הניהול) — דרך ה-headers של הנתיבים, בלי
// לגעת בכניסה המשותפת לשרת (src/server.ts) ובלי להשפיע על החנויות (תוכנית האבטחה API-08):
//   • HSTS — הדפדפן ייגש לכתובת רק ב-https (180 יום; בלי includeSubDomains — כל עסק בתת-דומיין משלו);
//   • nosniff; Referrer-Policy; Permissions-Policy — בלי מצלמה / מיקרופון / מיקום / תשלום בדפדפן;
//   • מסגור רק מאותו אתר (frame-ancestors / X-Frame-Options) — נגד clickjacking; התצוגה המקדימה
//     של עורך האתר נטענת ב-iframe מאותה כתובת, ולכן 'self';
//   • CSP בסיסי שלא שובר כלום: base-uri, object-src, form-action. CSP מלא לסקריפטים (nonce) —
//     ברשימת ההמשך (docs/hospitality/security-launch.md).
// אזור הניהול: גם בלי שמירה במטמון (העמוד כולל נתוני העסק) ובלי Referer לאתרים אחרים.

const COMMON: Record<string, string> = {
  "Strict-Transport-Security": "max-age=15552000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "Content-Security-Policy":
    "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'",
};

export const SITE_SECURITY_HEADERS: Record<string, string> = {
  ...COMMON,
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

export const MANAGE_SECURITY_HEADERS: Record<string, string> = {
  ...COMMON,
  "Referrer-Policy": "same-origin",
  "Cache-Control": "private, no-store",
};
