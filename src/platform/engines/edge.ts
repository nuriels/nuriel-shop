// שער הבקשות (עמודים / קבצים) לפי סוג האתר: אתר Ecommerce ממשיך בדיוק כמו היום;
// אתר של מנוע אחר — המנוע מחליט (plan B2 "Edge").
import type { EdgeRequest, SiteRef } from "./contract";
import { DEFAULT_ENGINE, type EngineRegistry } from "./registry";

export async function gateEdgeRequest(
  registry: EngineRegistry,
  site: SiteRef,
  request: EdgeRequest,
): Promise<Response | null> {
  if (site.siteType === DEFAULT_ENGINE) return null;
  const engine = registry.get(site.siteType);
  // אתר של מנוע שלא רשום — לא חושפים אותו
  if (!engine) return new Response("Not found", { status: 404 });
  return engine.gate(site, request);
}
