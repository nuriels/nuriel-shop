// הגדרות מנוע Hospitality

/** מפתחות הדגלים (נרשמו במיגרציה 3; כולם כבויים כברירת מחדל) */
export const HOSPITALITY_FLAGS = {
  backend: "hospitality_backend_enabled",
  frontend: "hospitality_frontend_enabled",
  onboarding: "hospitality_onboarding_enabled",
  themes: "hospitality_themes_enabled",
  booking: "hospitality_booking_enabled",
} as const;

/** הסכמה במסד */
export const HOSPITALITY_SCHEMA = "hospitality";

/** קבצי פונקציות השרת של המנוע */
export const HOSPITALITY_SOURCE_PREFIX = "src/engines/hospitality/";

/** מתג חירום בסביבה (plan B5): רק "on" מפעיל; לא מוגדר = כבוי (ברירת המחדל בפרודקשן) */
export const HOSPITALITY_ENGINE_ENV = "HOSPITALITY_ENGINE";

export function hospitalitySwitchOn(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (env[HOSPITALITY_ENGINE_ENV] ?? "").trim().toLowerCase() === "on";
}
