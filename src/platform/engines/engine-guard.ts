// המתג (dispatcher) של פונקציות השרת (plan B2): כל פונקציית שרת רצה רק באתר
// של המנוע שלה, ורק כשהמנוע פעיל לאתר. פונקציות הפלטפורמה רצות בכל אתר.
// אתר Ecommerce: ההחלטה מיידית, בלי פנייה למסד (Ecommerce תמיד פעיל).
import { createMiddleware } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import type { ServerFnOwner, SiteRef } from "./contract";
import type { EngineRegistry } from "./registry";

export type GuardDecision = "allow" | "not_found";

/**
 * טבלת ההחלטה (טהורה — נבדקת ביחידה):
 *   • בעלים = פלטפורמה → מותר
 *   • בלי אתר (פאנל הפלטפורמה / בקשה בלי אתר) → רק Ecommerce (כמו היום)
 *   • בעלים = סוג האתר → מותר אם המנוע פעיל לאתר
 *   • בעלים ≠ סוג האתר → לא נמצא (גם פונקציה לא מוכרת באתר שאינו Ecommerce)
 */
export function decideServerFnAccess(input: {
  owner: ServerFnOwner;
  site: SiteRef | null;
  ownerEnabled: boolean;
}): GuardDecision {
  const { owner, site, ownerEnabled } = input;
  if (owner === "platform") return "allow";
  if (!site) return owner === "ecommerce" ? "allow" : "not_found";
  if (owner !== site.siteType) return "not_found";
  return ownerEnabled ? "allow" : "not_found";
}

/** ההחלטה לקריאה אחת: מי הבעלים, איזה אתר, והאם המנוע פעיל (רק כשצריך) */
export async function guardServerFn(
  registry: EngineRegistry,
  filename: string,
  currentSite: () => Promise<SiteRef | null>,
): Promise<GuardDecision> {
  const owner = registry.ownerOf(filename);
  if (owner === "platform") return "allow";
  const site = await currentSite();
  const engine = site && owner === site.siteType ? registry.get(owner) : undefined;
  const ownerEnabled = engine ? await engine.enabledFor(site!) : false;
  return decideServerFnAccess({ owner, site, ownerEnabled });
}

/** middleware גלובלי לפונקציות השרת (נרשם ב-src/start.ts דרך שורש ההרכבה) */
export function createEngineGuard(registry: EngineRegistry) {
  return createMiddleware({ type: "function" }).server(async ({ next, serverFnMeta }) => {
    const { currentSite } = await import("../tenancy/current-site.server");
    const decision = await guardServerFn(registry, serverFnMeta.filename, currentSite);
    if (decision !== "allow") {
      // סטטוס HTTP 404 (TanStack מחזיר שגיאת notFound של פונקציית שרת עם 200 אם לא נקבע)
      try {
        const { setResponseStatus } = await import("@tanstack/react-start/server");
        setResponseStatus(404);
      } catch {
        // בלי הקשר בקשה (בדיקות יחידה) — מספיק ה-notFound
      }
      throw notFound();
    }
    return next();
  });
}
