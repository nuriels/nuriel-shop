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

/** מה שהשער של המנוע קורא מהבקשה: הנתיב, השיטה, ה-query, והכתובת בלי פורט (כפי ש-nginx העביר אותה) */
export function edgeRequestOf(request: Request): EdgeRequest {
  const url = new URL(request.url);
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host)
    .split(",")[0]!
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
  return { pathname: url.pathname, method: request.method, host, search: url.search };
}
