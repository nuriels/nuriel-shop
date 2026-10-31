// קבצי פונקציות שרת שמשותפים לכל המוצרים (plan B2) — התחברות, קודי כניסה,
// סיסמה, מעבר בין אתרים, תמיכה, handoff, דומיין, הסכמת דיוור, טפסי האתר,
// הסכם בעלים, הגדרות מייל, התראות, הפלטפורמה והשער. הם קיימים כבר היום
// (קוד Ecommerce ישן) ולא זזים; הם רק מסומנים כאן כשייכים לפלטפורמה, כדי
// שהמתג (engine-guard) יאפשר אותם בכל סוג אתר.
// בדיקת הארכיטקטורה מוודאת שכל קובץ כאן קיים ומכיל createServerFn.

export const LEGACY_SHARED_SERVER_FN_FILES: readonly string[] = [
  "src/lib/auth.functions.ts",
  "src/lib/login-code.functions.ts",
  "src/lib/password.functions.ts",
  "src/lib/store-switcher.functions.ts",
  "src/lib/support.functions.ts",
  "src/lib/handoff.functions.ts",
  "src/lib/custom-domain.functions.ts",
  "src/lib/marketing-consent.functions.ts",
  "src/lib/site-forms.functions.ts",
  "src/lib/owner-agreement.functions.ts",
  "src/lib/email.functions.ts",
  "src/lib/notifications.functions.ts",
  "src/lib/platform.functions.ts",
  "src/lib/platform-grow.functions.ts",
  "src/lib/platform-files.functions.ts",
  "src/lib/portal.functions.ts",
];

const SHARED = new Set(LEGACY_SHARED_SERVER_FN_FILES);

/** פונקציות השרת של הפלטפורמה: הקבצים המשותפים, וכל מה שתחת src/platform */
export function isPlatformServerFn(filename: string): boolean {
  return SHARED.has(filename) || filename.startsWith("src/platform/");
}
