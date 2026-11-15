// מתי המנוע פעיל לאתר (צד שרת): מתג הסביבה + דגלי האתר. כל תקלה בבדיקה → כבוי.
import { featureEnabled } from "@/platform/feature-flags/flags.server";
import { BP_FLAGS, businessProfileSwitchOn } from "./config";

/** המנוע וממשק הניהול: BUSINESS_PROFILE_ENGINE=on + business_profile_enabled (פלטפורמה + אתר) */
export async function studioEnabled(siteId: string): Promise<boolean> {
  if (!businessProfileSwitchOn()) return false;
  return featureEnabled(BP_FLAGS.enabled, siteId);
}

/**
 * האתר הציבורי: כל מה שלמעלה + business_profile_public (נדלק לאתר רק באישור הפרסום הראשון) + גרסה
 * מפורסמת. המסד בודק את כל התנאים בעצמו (bp_public_site); כאן — מטמון קצר, כדי שבקשות לעמודים לא
 * יעמיסו על המסד.
 */
const TTL_MS = 15_000;
const liveCache = new Map<string, { on: boolean; expires: number }>();

export async function siteEnabled(siteId: string): Promise<boolean> {
  if (!(await studioEnabled(siteId))) return false;
  if (!(await featureEnabled(BP_FLAGS.public, siteId))) return false;
  const hit = liveCache.get(siteId);
  if (hit && hit.expires > Date.now()) return hit.on;
  let on = false;
  try {
    const { loadPublicSite } = await import("./data/public-site.server");
    on = (await loadPublicSite(siteId)) !== null;
  } catch {
    on = false;
  }
  liveCache.set(siteId, { on, expires: Date.now() + TTL_MS });
  return on;
}

/** אחרי פרסום / אישור — המטמון של האתר מתנקה כדי שהשינוי ייראה מיד */
export function invalidateSiteEnabled(siteId: string): void {
  liveCache.delete(siteId);
}
