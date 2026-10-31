// שער הבקשות לאתר אירוח (plan B2 "Edge"; Stage 2a):
//   • פונקציות שרת → ממשיכות (המתג engine-guard מחליט לכל קריאה);
//   • robots.txt → Disallow: / (שום דבר לא נסרק לפני שהאתר עולה);
//   • אזור הניהול (/manage/**) ועמוד הכניסה מהשער (/admin-handoff) → ממשיכים לאפליקציה,
//     רק כשאזור הניהול פעיל לאתר (מתג הסביבה + דגל המסד + דגל הניהול);
//     /admin (כתובת הנחיתה של ה-handoff הקיים) → 302 ל-/manage;
//   • אתר מושעה (כשאזור הניהול פעיל) → עמוד "האתר מושעה" (403);
//   • כל עמוד / קובץ אחר → 404. אתר האורחים (renderer, ערכות עיצוב) נבנה בשלב 4
//     ויופעל אז לפי hospitality_frontend_enabled; עד אז אף עמוד של החנויות לא
//     מוצג בכתובת של אתר אירוח.
import type { EdgeRequest, SiteRef } from "@/platform/engines/contract";
import { MANAGE_PATH } from "../config";
import { ADMIN_LANDING, isManagementPath } from "./paths";

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

export async function hospitalityGate(
  site: SiteRef,
  request: EdgeRequest,
  opts: { managementOpen: () => Promise<boolean> } = { managementOpen: async () => false },
): Promise<Response | null> {
  if (request.pathname.startsWith("/_serverFn")) return null;
  if (request.pathname === "/robots.txt") {
    return new Response("User-agent: *\nDisallow: /\n", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
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
