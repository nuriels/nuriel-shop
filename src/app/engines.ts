// שורש ההרכבה (plan B1): המקום היחיד שמכיר את שני המנועים. רישום וחיבור בלבד —
// בלי לוגיקה עסקית (נבדק בבדיקת הארכיטקטורה). נטען גם בדפדפן (src/start.ts),
// ולכן קוד שרת נטען רק בתוך פונקציות.
import { ecommerceEngine } from "@/engines/ecommerce/engine";
import { hospitalityEngine } from "@/engines/hospitality/engine";
import { gateEdgeRequest } from "@/platform/engines/edge";
import { createEngineGuard } from "@/platform/engines/engine-guard";
import { createEngineRegistry } from "@/platform/engines/registry";

export const engineRegistry = createEngineRegistry([ecommerceEngine, hospitalityEngine]);

/** פונקציות השרת של המנועים שעדיין אין להן ממשק — נכללות בבנייה דרך כאן */
export * as hospitalityServerFunctions from "@/engines/hospitality/server";

/** המתג של פונקציות השרת — נרשם כ-middleware גלובלי ב-src/start.ts */
export const engineGuard = createEngineGuard(engineRegistry);

/** שער הבקשות לפי סוג האתר — נקרא מ-src/server.ts אחרי זיהוי האתר */
export async function gateSiteRequest(
  site: { id: string; status: "active" | "suspended" },
  request: Request,
): Promise<Response | null> {
  const { siteTypeOf } = await import("@/platform/tenancy/site-type.server");
  return gateEdgeRequest(
    engineRegistry,
    { ...site, siteType: await siteTypeOf(site.id) },
    { pathname: new URL(request.url).pathname, method: request.method },
  );
}
