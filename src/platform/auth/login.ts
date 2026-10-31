// כניסה עם סיסמה או עם קוד במייל — אותן פונקציות שרת קיימות ומשותפות
// (src/lib/auth.functions.ts, src/lib/login-code.functions.ts — בבעלות הפלטפורמה,
// LEGACY_SHARED_SERVER_FN_FILES), בלי שינוי. בלי Google: הכניסה עם Google לא
// מופעלת במנועים חדשים עד שממצא ה-OAuth ייסגר (docs/security/oauth-pkce-analysis.md).
export { loginWithIdentifier } from "@/lib/auth.functions";
export {
  LOGIN_CODE_RESEND_SECONDS,
  requestLoginCode,
  verifyLoginCode,
} from "@/lib/login-code.functions";
