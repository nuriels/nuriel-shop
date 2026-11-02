import { createServerFn } from "@tanstack/react-start";
import type { LandingData } from "@/lib/portal-landing";

/**
 * דף הנחיתה של שער הפלטפורמה (nuriel-app2) — פונקציות השרת.
 *
 * isPortalSite — האם הבקשה היא לאתר השער. עמוד הבית משתמש בה כדי לרנדר את דף הנחיתה בשרת
 *   (SSR מלא), בלי לשנות דבר בחנויות: בכל אתר אחר עמוד הבית נשאר "data-only" כמו היום.
 *   בלי גישה למסד — רק החנות של הבקשה (כבר זוהתה בשרת).
 *
 * getPortalLanding — המחירים וימי הניסיון מהמסד בזמן הטעינה (portal-landing.server.ts — אותו
 *   מקור משמש גם את /llms.txt של השער). בכל אתר אחר — null.
 */

export const isPortalSite = createServerFn({ method: "GET" }).handler(
  async (): Promise<boolean> => {
    const { maybeCurrentTenant, isPlatformRequest } =
      await import("@/integrations/supabase/tenant.server");
    const { PORTAL_STORE_SLUG } = await import("@/lib/portal");
    return !isPlatformRequest() && maybeCurrentTenant()?.slug === PORTAL_STORE_SLUG;
  },
);

export const getPortalLanding = createServerFn({ method: "GET" }).handler(
  async (): Promise<LandingData | null> => {
    const { loadPortalLanding } = await import("@/lib/portal-landing.server");
    return loadPortalLanding();
  },
);
