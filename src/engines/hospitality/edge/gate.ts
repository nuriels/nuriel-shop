// שער הבקשות לאתר אירוח (plan B2 "Edge"):
//   • פונקציות שרת → ממשיכות (המתג engine-guard מחליט לכל קריאה);
//   • robots.txt → Disallow: / (שום דבר לא נסרק לפני שהאתר עולה);
//   • כל עמוד / קובץ אחר → 404. אתר האורחים (renderer, ערכות עיצוב) נבנה בשלב 4
//     ויופעל אז לפי hospitality_frontend_enabled; עד אז אף עמוד של החנויות לא
//     מוצג בכתובת של אתר אירוח.
import type { EdgeRequest, SiteRef } from "@/platform/engines/contract";

const NOT_OPEN_HTML = `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8" /><title>האתר עדיין לא פתוח</title>
<meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" />
<style>body{font:15px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:1.5rem;background:#fafafa;color:#111}</style>
</head><body><div><h1>האתר עדיין לא פתוח</h1><p>האתר בהקמה. נסו שוב בקרוב.</p></div></body></html>`;

export async function hospitalityGate(
  _site: SiteRef,
  request: EdgeRequest,
): Promise<Response | null> {
  if (request.pathname.startsWith("/_serverFn")) return null;
  if (request.pathname === "/robots.txt") {
    return new Response("User-agent: *\nDisallow: /\n", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return new Response(NOT_OPEN_HTML, {
    status: 404,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}
