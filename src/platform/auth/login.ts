// כניסה עם סיסמה או עם קוד במייל — אותן פונקציות שרת קיימות ומשותפות
// (src/lib/auth.functions.ts, src/lib/login-code.functions.ts — בבעלות הפלטפורמה,
// LEGACY_SHARED_SERVER_FN_FILES), בלי שינוי. בלי Google כאן: במנועים חדשים OAuth לא מתחיל
// בכתובת של האתר (docs/security/oauth-pkce-analysis.md). שלב א' 3: אזור הניהול של Hospitality
// מפנה לכניסה המרכזית בשער (platform/tenancy/portal.server.ts), וחוזר בקוד חד-פעמי (/admin-handoff).
export { loginWithIdentifier } from "@/lib/auth.functions";
export {
  LOGIN_CODE_RESEND_SECONDS,
  requestLoginCode,
  verifyLoginCode,
} from "@/lib/login-code.functions";
