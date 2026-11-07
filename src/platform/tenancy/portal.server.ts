// מתאם (adapter): הכתובת של שער הפלטפורמה (nuriel-app2) — הכניסה המרכזית של Nuriel (Google / קוד
// למייל). שלב א' 3: הכניסה עם Google לבעלי עסקי אירוח עוברת דרך השער בלבד — חזרת ה-OAuth היא רק לכתובת
// של Nuriel, לא לכתובת של אתר (docs/security/oauth-pkce-analysis.md), ומשם קוד חד-פעמי לאתר
// (/admin-handoff, הקיים). בלי שינוי בשער עצמו.
import { originForTenant } from "@/integrations/supabase/tenant.server";
import { PORTAL_STORE_SLUG } from "@/lib/portal";

/** "<השער>/#login" — חלון הכניסה של השער נפתח מיד; null — אין כתובת (סביבה בלי דומיין) */
export function portalLoginUrl(): string | null {
  try {
    return `${originForTenant({ slug: PORTAL_STORE_SLUG, domain: null, is_default: false })}/#login`;
  } catch {
    return null;
  }
}
