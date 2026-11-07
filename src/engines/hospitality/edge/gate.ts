// שער הבקשות לאתר אירוח (plan B2 "Edge"; Stage 2a):
//   • פונקציות שרת → ממשיכות (המתג engine-guard מחליט לכל קריאה);
//   • robots.txt → Disallow: / כל עוד האתר הציבורי סגור; כשהוא פתוח — רק /stay נסרק (+ הקבצים
//     של העמודים ומפת האתר, E5), עם שורת Sitemap בכתובת הקנונית;
//   • sitemap.xml (E5) → רק כשהאתר פתוח: העמודים הציבוריים בלבד (website/seo.ts); סגור → 404;
//   • אזור הניהול (/manage/**) ועמוד הכניסה מהשער (/admin-handoff) → ממשיכים לאפליקציה,
//     רק כשאזור הניהול פעיל לאתר (מתג הסביבה + דגל המסד + דגל הניהול);
//     /admin (כתובת הנחיתה של ה-handoff הקיים) → 302 ל-/manage;
//   • אתר מושעה (כשאזור הניהול פעיל) → עמוד "האתר מושעה" (403);
//   • האתר הציבורי (Stage 4; /stay/**) → ממשיך, רק כשהאתר פתוח (מתג הסביבה + דגל המסד +
//     hospitality_frontend_enabled); "/" → 302 ל-/stay; אתר מושעה → "האתר מושעה" (403);
//   • כל עמוד / קובץ אחר → 404 — אף עמוד של החנויות לא מוצג בכתובת של אתר אירוח. כשהאתר פתוח —
//     "העמוד לא נמצא" עם קישור לדף הבית; כשהוא סגור — "האתר עדיין לא פתוח".
//   • בכל העמודים הסטטיים — קרדיט נוריאל הקבוע (F1), כמו בכל עמוד של האתר.
import { nurielCreditHtml } from "@/platform/branding/credit";
import type { EdgeRequest, SiteRef } from "@/platform/engines/contract";
import { MANAGE_PATH, SITE_PATH } from "../config";
import { robotsTxt } from "../website/seo";
import { ADMIN_LANDING, isBrandAssetPath, isManagementPath, isSitePath } from "./paths";

// עמוד סטטי (בלי React ובלי נתוני העסק): צבעי ערכת "יוקרה", גופני מערכת, ניגודיות AA
const page = (title: string, text: string, homeLink = false) => `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8" /><title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" />
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;font:16px/1.6 system-ui,-apple-system,"Segoe UI",Heebo,Arial,sans-serif;background:#fbf9f4;color:#2b2621}
main{flex:1;display:flex;align-items:center;justify-content:center;padding:4rem 1.5rem;text-align:center}
.box{max-width:28rem}
.rule{display:block;width:3.5rem;height:1px;margin:0 auto 2rem;background:#8a6a2f}
h1{margin:0;font-size:2rem;font-weight:500;line-height:1.25}
p.text{margin:1rem 0 0;color:#5e544a}
a.home{display:inline-flex;align-items:center;min-height:2.75rem;margin-top:2rem;padding:0 1.5rem;border-radius:.375rem;background:#2b2621;color:#fbf9f4;text-decoration:none;font-size:.9rem}
footer{background:#221d19;color:#ede7dc;padding:1.25rem 1rem;font-size:.75rem;text-align:center}
footer a{color:inherit;display:inline-flex;flex-direction:column;gap:.15rem;text-decoration:none}
footer a:hover{text-decoration:underline}
</style>
</head><body><main><div class="box"><span class="rule" aria-hidden="true"></span><h1>${title}</h1><p class="text">${text}</p>${
  homeLink ? `<a class="home" href="${SITE_PATH}">לדף הבית של האתר</a>` : ""
}</div></main><footer>${nurielCreditHtml()}</footer></body></html>`;

const NOT_OPEN_HTML = page("האתר עדיין לא פתוח", "האתר בהקמה. נסו שוב בקרוב.");
const NOT_FOUND_HTML = page("העמוד לא נמצא", "ייתכן שהקישור השתנה או שהעמוד הוסר.", true);
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

// בלי סיומת קובץ: נתיב עם סיומת (.ics) נחשב בשרת לקובץ סטטי ולא מגיע לשער של האתר
const ICAL_PATH = /^\/ical\/([0-9a-f]{40})$/;

export interface GateOptions {
  /** אזור הניהול פעיל לאתר */
  managementOpen: () => Promise<boolean>;
  /** יומן הייצוא של יחידה (/ical/<token>) — null: טוקן לא מוכר / המנוע כבוי */
  icalFeed?: (token: string) => Promise<Response | null>;
  /** האתר הציבורי פתוח (Stage 4) */
  siteOpen?: () => Promise<boolean>;
  /** E5: הכתובת הקנונית של האתר (לשורת Sitemap ב-robots.txt); null — בלי השורה */
  siteOrigin?: () => Promise<string | null>;
  /** E5: מפת האתר; null — לא זמינה (404) */
  sitemap?: () => Promise<Response | null>;
}

export async function hospitalityGate(
  site: SiteRef,
  request: EdgeRequest,
  opts: GateOptions = { managementOpen: async () => false },
): Promise<Response | null> {
  const siteOpen = opts.siteOpen ?? (async () => false);
  if (request.pathname.startsWith("/_serverFn")) return null;
  // סנכרון ערוצים: יומן הייצוא של יחידה — לילות תפוסים בלבד, לפי טוקן סודי
  const ical = ICAL_PATH.exec(request.pathname);
  if (ical) {
    const feed = request.method === "GET" && opts.icalFeed ? await opts.icalFeed(ical[1]!) : null;
    return (
      feed ??
      new Response("Not found\n", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" },
      })
    );
  }
  if (request.pathname === "/robots.txt") {
    const open = site.status === "active" && (await siteOpen());
    const origin = open && opts.siteOrigin ? await opts.siteOrigin() : null;
    return new Response(robotsTxt(open, origin), {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (request.pathname === "/sitemap.xml") {
    const open = site.status === "active" && (await siteOpen());
    const map = open && request.method === "GET" && opts.sitemap ? await opts.sitemap() : null;
    if (map) return map;
    return html(open ? NOT_FOUND_HTML : NOT_OPEN_HTML, 404);
  }
  // A1: האייקונים, תמונת השיתוף והמניפסט מהלוגו (/stay/brand/…) — באתר פעיל שהאתר הציבורי או אזור
  // הניהול שלו פתוחים (גם מסך הבית של הניהול). אחרת — 404 כמו כל קובץ, בלי לחשוף כלום.
  if (isBrandAssetPath(request.pathname)) {
    const allowed =
      request.method === "GET" &&
      site.status === "active" &&
      ((await siteOpen()) || (await opts.managementOpen()));
    if (allowed) return null;
    return new Response("Not found\n", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" },
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
  // עמוד שלא קיים: באתר פתוח — "העמוד לא נמצא" (עם קישור הביתה); אחרת — "האתר עדיין לא פתוח"
  // (הדגלים במטמון קצר, כך שבקשות אקראיות לא מעמיסות על המסד)
  const open = site.status === "active" && (await siteOpen());
  return html(open ? NOT_FOUND_HTML : NOT_OPEN_HTML, 404);
}
