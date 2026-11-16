// שער הבקשות לאתר עסק (Nuriel Websites, Stage 1):
//   • פונקציות שרת → ממשיכות (המתג engine-guard מחליט לכל קריאה);
//   • robots.txt → Disallow: / כל עוד האתר לא פורסם; אחרי הפרסום — האתר פתוח, בלי /studio, עם Sitemap;
//   • sitemap.xml → רק כשהאתר פורסם (העמודים של הגרסה המפורסמת); אחרת 404. llms.txt / קבצי אימות — 404
//     (SEO מלא — Stage 4);
//   • ממשק הניהול (/studio/**) והכניסה (/admin-handoff) → ממשיכים, רק כשהמנוע פעיל לאתר;
//     /admin (הנחיתה של ה-handoff) → 302 ל-/studio; אתר מושעה → "האתר מושעה" (403);
//   • עמודי האתר ("/", "/about", …) → ממשיכים רק כשיש גרסה מפורסמת שאושרה והאתר פתוח לציבור;
//     אחרת "האתר בהקמה" (404, noindex). אתר מושעה → 403;
//   • הקידומת הפנימית של הנתב (/bp-site/**) וכל נתיב אחר (כולל של החנויות) → 404.
//   • בכל העמודים הסטטיים — קרדיט נוריאל.
import type { EdgeRequest, SiteRef } from "@/platform/engines/contract";
import { STUDIO_PATH } from "../config";
import { creditHtml } from "../site/credit";
import { ADMIN_LANDING, isInternalSitePath, isPublicPagePath, isStudioPath } from "./paths";

const page = (title: string, text: string, homeLink = false) => `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8" /><title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" />
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;flex-direction:column;font:16px/1.6 system-ui,-apple-system,"Segoe UI",Heebo,Arial,sans-serif;background:#f8f6f2;color:#26221e}
main{flex:1;display:flex;align-items:center;justify-content:center;padding:4rem 1.5rem;text-align:center}
.box{max-width:28rem}
h1{margin:0;font-size:1.9rem;font-weight:600;line-height:1.25}
p.text{margin:1rem 0 0;color:#5a5249}
a.home{display:inline-flex;align-items:center;min-height:2.75rem;margin-top:2rem;padding:0 1.5rem;border-radius:999px;background:#26221e;color:#f8f6f2;text-decoration:none;font-size:.9rem}
footer{border-top:1px solid #e4ded5;color:#5a5249;padding:1.25rem 1rem;font-size:.78rem;text-align:center}
footer a{color:inherit}
</style>
</head><body><main><div class="box"><h1>${title}</h1><p class="text">${text}</p>${
  homeLink ? `<a class="home" href="/">לדף הבית</a>` : ""
}</div></main><footer>${creditHtml()}</footer></body></html>`;

const NOT_OPEN_HTML = page("האתר בהקמה", "האתר עדיין לא פורסם. נסו שוב בקרוב.");
const NOT_FOUND_HTML = page("העמוד לא נמצא", "ייתכן שהקישור השתנה או שהעמוד הוסר.", true);
const SUSPENDED_HTML = page("האתר מושעה", "האתר הושעה זמנית.");

const html = (body: string, status: number) =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
const text = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });

/** robots.txt — טהור (נבדק ביחידה) */
export function robotsTxt(open: boolean, origin: string | null): string {
  if (!open) return "User-agent: *\nDisallow: /\n";
  const lines = [
    "User-agent: *",
    "Allow: /",
    `Disallow: ${STUDIO_PATH}`,
    "Disallow: /admin-handoff",
  ];
  if (origin) lines.push("", `Sitemap: ${origin}/sitemap.xml`);
  return `${lines.join("\n")}\n`;
}

/** הכתובות של האתר (מיגרציה 197): הכתובת של הבקשה, תת-הדומיין בפלטפורמה, הכתובת הקנונית, הדומיין האישי */
export interface SiteHosts {
  requestHost: string | null;
  slugHost: string | null;
  canonicalOrigin: string | null;
  customDomain: string | null;
}

/**
 * ההחלטה לפי הכתובת — טהור (נבדק ביחידה). null = ממשיכים.
 *  • ממשק הניהול והכניסה אליו רק בתת-הדומיין של Nuriel: בדומיין האישי → 302 לאותו נתיב בתת-הדומיין
 *    (קוד כניסה וחיבור לניהול לא נוחתים על דומיין שה-DNS שלו בידי בעל העסק — כמו SEC-H2);
 *  • עמודי האתר, robots.txt ו-sitemap.xml בתת-הדומיין, כשיש דומיין אישי פעיל (עם SSL) → 301 לדומיין
 *    הקנוני — אין שתי כתובות לאותו תוכן בגוגל.
 */
export function hostRedirect(
  pathname: string,
  search: string,
  hosts: SiteHosts | null,
): string | null {
  if (!hosts?.requestHost || !hosts.slugHost) return null;
  const { requestHost, slugHost, canonicalOrigin, customDomain } = hosts;
  if (isStudioPath(pathname) || ADMIN_LANDING.test(pathname)) {
    return requestHost !== slugHost && requestHost === customDomain
      ? `https://${slugHost}${pathname}${search}`
      : null;
  }
  if (requestHost !== slugHost || !canonicalOrigin) return null;
  let canonicalHost: string;
  try {
    canonicalHost = new URL(canonicalOrigin).hostname;
  } catch {
    return null;
  }
  if (canonicalHost === slugHost) return null;
  const isPage =
    (isPublicPagePath(pathname) && !isInternalSitePath(pathname)) ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/accessibility";
  return isPage ? `${canonicalOrigin.replace(/\/+$/, "")}${pathname}${search}` : null;
}

export interface GateOptions {
  /** הכתובות של האתר (להפניות לפי כתובת); בלי — אין הפניות */
  hosts?: () => Promise<SiteHosts | null>;
  /** המנוע וממשק הניהול פעילים לאתר (מתג הסביבה + business_profile_enabled) */
  studioOpen: () => Promise<boolean>;
  /** יש גרסה מפורסמת שאושרה והאתר פתוח לציבור */
  siteOpen: () => Promise<boolean>;
  /** הכתובת הקנונית (לשורת Sitemap) */
  siteOrigin?: () => Promise<string | null>;
  /** מפת האתר; null — לא זמינה */
  sitemap?: () => Promise<Response | null>;
}

export async function businessProfileGate(
  site: SiteRef,
  request: EdgeRequest,
  opts: GateOptions,
): Promise<Response | null> {
  const { pathname } = request;
  if (pathname.startsWith("/_serverFn")) return null;

  if (opts.hosts && request.host && (request.method === "GET" || request.method === "HEAD")) {
    const target = hostRedirect(pathname, request.search ?? "", await opts.hosts());
    if (target) {
      const studio = isStudioPath(pathname) || ADMIN_LANDING.test(pathname);
      return new Response(null, {
        status: studio ? 302 : 301,
        headers: {
          location: target,
          "cache-control": studio ? "no-store" : "public, max-age=3600",
        },
      });
    }
  }

  if (pathname === "/robots.txt") {
    const open = site.status === "active" && (await opts.siteOpen());
    const origin = open && opts.siteOrigin ? await opts.siteOrigin() : null;
    return text(robotsTxt(open, origin));
  }
  if (pathname === "/sitemap.xml") {
    const open = site.status === "active" && (await opts.siteOpen());
    const map = open && request.method === "GET" && opts.sitemap ? await opts.sitemap() : null;
    return map ?? html(open ? NOT_FOUND_HTML : NOT_OPEN_HTML, 404);
  }

  if (isStudioPath(pathname) || ADMIN_LANDING.test(pathname)) {
    if (await opts.studioOpen()) {
      if (site.status === "suspended") return html(SUSPENDED_HTML, 403);
      if (ADMIN_LANDING.test(pathname)) {
        return new Response(null, {
          status: 302,
          headers: { location: STUDIO_PATH, "cache-control": "no-store" },
        });
      }
      return null;
    }
    return html(NOT_OPEN_HTML, 404);
  }

  if (!isInternalSitePath(pathname) && isPublicPagePath(pathname)) {
    if (site.status === "suspended") {
      return (await opts.siteOpen()) ? html(SUSPENDED_HTML, 403) : html(NOT_OPEN_HTML, 404);
    }
    return (await opts.siteOpen()) ? null : html(NOT_OPEN_HTML, 404);
  }

  // הקידומת הפנימית, קבצים ונתיבים של מוצרים אחרים — לא קיימים באתר עסק
  const open = site.status === "active" && (await opts.siteOpen());
  return html(open ? NOT_FOUND_HTML : NOT_OPEN_HTML, 404);
}
