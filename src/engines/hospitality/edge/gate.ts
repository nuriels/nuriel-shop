// שער הבקשות לאתר אירוח (plan B2 "Edge"; Stage 2a):
//   • פונקציות שרת → ממשיכות (המתג engine-guard מחליט לכל קריאה);
//   • robots.txt → Disallow: / כל עוד האתר הציבורי סגור; כשהוא פתוח — רק /stay נסרק;
//   • אזור הניהול (/manage/**) ועמוד הכניסה מהשער (/admin-handoff) → ממשיכים לאפליקציה,
//     רק כשאזור הניהול פעיל לאתר (מתג הסביבה + דגל המסד + דגל הניהול);
//     /admin (כתובת הנחיתה של ה-handoff הקיים) → 302 ל-/manage;
//   • אתר מושעה (כשאזור הניהול פעיל) → עמוד "האתר מושעה" (403);
//   • האתר הציבורי (Stage 4; /stay/**) → ממשיך, רק כשהאתר פתוח (מתג הסביבה + דגל המסד +
//     hospitality_frontend_enabled); "/" → 302 ל-/stay; אתר מושעה → "האתר מושעה" (403);
//   • כל עמוד / קובץ אחר → 404 — אף עמוד של החנויות לא מוצג בכתובת של אתר אירוח.
import type { EdgeRequest, SiteRef } from "@/platform/engines/contract";
import { MANAGE_PATH, SITE_PATH } from "../config";
import { ADMIN_LANDING, isManagementPath, isSitePath } from "./paths";

const page = (title: string, text: string) => `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8" /><title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" />
<style>body{font:15px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:1.5rem;background:#fafafa;color:#111}</style>
</head><body><main><h1>${title}</h1><p>${text}</p></main></body></html>`;

const NOT_OPEN_HTML = page("האתר עדיין לא פתוח", "האתר בהקמה. נסו שוב בקרוב.");
const SUSPENDED_HTML = page("האתר מושעה", "האתר הושעה זמנית. לבירור פנו לתמיכה של נוריאל.");

const html = (body: string, status: number) =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });

const ROBOTS_CLOSED = "User-agent: *\nDisallow: /\n";
const ROBOTS_OPEN = `User-agent: *\nAllow: ${SITE_PATH}$\nAllow: ${SITE_PATH}/units/\nAllow: ${SITE_PATH}/rooms/\nDisallow: /\n`;

export interface GateOptions {
  /** אזור הניהול פעיל לאתר */
  managementOpen: () => Promise<boolean>;
  /** האתר הציבורי פתוח (Stage 4) */
  siteOpen?: () => Promise<boolean>;
}

export async function hospitalityGate(
  site: SiteRef,
  request: EdgeRequest,
  opts: GateOptions = { managementOpen: async () => false },
): Promise<Response | null> {
  const siteOpen = opts.siteOpen ?? (async () => false);
  if (request.pathname.startsWith("/_serverFn")) return null;
  if (request.pathname === "/robots.txt") {
    const open = site.status === "active" && (await siteOpen());
    return new Response(open ? ROBOTS_OPEN : ROBOTS_CLOSED, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  // האתר הציבורי: הבית ("/" → /stay), עמודי היחידות, ההזמנה וניהול ההזמנה של האורח
  if ((request.pathname === "/" || isSitePath(request.pathname)) && (await siteOpen())) {
    if (site.status === "suspended") return html(SUSPENDED_HTML, 403);
    if (request.pathname === "/") {
      return new Response(null, {
        status: 302,
        headers: { location: SITE_PATH, "cache-control": "no-store" },
      });
    }
    return null;
  }
  const wantsManagement =
    isManagementPath(request.pathname) || ADMIN_LANDING.test(request.pathname);
  if (wantsManagement && (await opts.managementOpen())) {
    // אתר מושעה: אזור הניהול סגור (בלי לחשוף כלום כשהאזור כבוי — אז 404 כמו כל עמוד)
    if (site.status === "suspended") return html(SUSPENDED_HTML, 403);
    if (ADMIN_LANDING.test(request.pathname)) {
      return new Response(null, {
        status: 302,
        headers: { location: MANAGE_PATH, "cache-control": "no-store" },
      });
    }
    return null;
  }
  return html(NOT_OPEN_HTML, 404);
}
