// E5: גוגל ושיתוף לאתר האירוח — טהור (נבדק ביחידה), משותף לשער (robots.txt, sitemap.xml), לכותרות
// העמודים ולעורך:
//   • כתובת קנונית: הדומיין של העסק אם יש, אחרת הכתובת בפלטפורמה (או לפי הבחירה בעורך);
//   • מפת אתר: רק העמודים הציבוריים — הבית, יחידות וסוגי חדרים. בלי ניהול, בלי הזמנה, בלי
//     "ההזמנה שלי" ובלי עמודים שלא לאינדוקס; כל כתובת פעם אחת; XML תקין (escape);
//   • robots.txt: סגור — הכול חסום; פתוח — עמודי האתר, הקבצים שהעמודים צריכים (CSS / JS / גופנים)
//     ומפת האתר;
//   • קוד האימות של Google — גם מהתגית המלאה שמודבקת מ-Search Console.
import { SITE_PATH } from "../config";
import type { PublicSite } from "../types/website";
import { GOOGLE_TOKEN, normalizeDesign, type SiteSeo } from "./design/schema";
import { firstSentence } from "./lib/format";
import { siteListing } from "./lib/listing";

export interface SiteAddresses {
  /** הכתובת הראשית של העסק (דומיין משלו, אם יש) */
  primary: string | null;
  /** הכתובת בפלטפורמה (<slug>.<הדומיין של הפלטפורמה>) */
  subdomain: string | null;
}

const ORIGIN = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i;
const clean = (o: string | null | undefined) => {
  const s = o?.trim().replace(/\/+$/, "") ?? "";
  return ORIGIN.test(s) ? s : null;
};

/** הכתובת הקנונית של האתר לפי הבחירה (ברירת המחדל — הכתובת הראשית) */
export function canonicalOrigin(addresses: SiteAddresses, seo: SiteSeo | undefined): string | null {
  const primary = clean(addresses.primary);
  const sub = clean(addresses.subdomain);
  return seo?.canonical === "subdomain" ? (sub ?? primary) : (primary ?? sub);
}

/** הגדרות גוגל ושיתוף של הגרסה שבאתר (המפורסמת; בתצוגה המקדימה — הטיוטה) */
export function siteSeo(site: Pick<PublicSite, "design">): SiteSeo {
  return normalizeDesign(site.design?.document ?? null, site.design?.theme).seo ?? {};
}

/** "קוד" או התגית המלאה מ-Search Console → הקוד בלבד; לא תקין → null */
export function extractGoogleToken(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const m = /content\s*=\s*["']([^"']+)["']/i.exec(s);
  const token = (m ? m[1]! : s).trim();
  return GOOGLE_TOKEN.test(token) ? token : null;
}

export interface SitemapEntry {
  path: string;
  /** YYYY-MM-DD */
  lastmod?: string | undefined;
}

const seg = (slug: string) => encodeURIComponent(slug);

/** העמודים הציבוריים של האתר — כל אחד פעם אחת */
export function sitemapEntries(site: PublicSite): SitemapEntry[] {
  const published = site.design?.kind === "published" ? site.design.updated_at : null;
  const out: SitemapEntry[] = [
    { path: SITE_PATH, lastmod: published ? published.slice(0, 10) : undefined },
  ];
  for (const item of siteListing(site)) {
    out.push({
      path:
        item.kind === "unit"
          ? `${SITE_PATH}/units/${seg(item.unit.slug)}`
          : `${SITE_PATH}/rooms/${seg(item.type.type.slug)}`,
    });
  }
  const seen = new Set<string>();
  return out.filter((e) => !seen.has(e.path) && seen.add(e.path) && e.path.startsWith(SITE_PATH));
}

const xml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export function buildSitemap(origin: string, entries: SitemapEntry[]): string {
  const base = clean(origin);
  if (!base) throw new Error("invalid origin");
  const urls = entries
    .map(
      (e) =>
        `  <url>\n    <loc>${xml(base + e.path)}</loc>${
          e.lastmod && /^\d{4}-\d{2}-\d{2}$/.test(e.lastmod)
            ? `\n    <lastmod>${e.lastmod}</lastmod>`
            : ""
        }\n  </url>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** robots.txt: סגור — הכול חסום; פתוח — עמודי האתר, הקבצים של העמודים ומפת האתר */
export function robotsTxt(open: boolean, origin: string | null): string {
  if (!open) return "User-agent: *\nDisallow: /\n";
  const base = clean(origin);
  return [
    "User-agent: *",
    `Allow: ${SITE_PATH}$`,
    `Allow: ${SITE_PATH}/units/`,
    `Allow: ${SITE_PATH}/rooms/`,
    // הסגנון והקוד של העמודים — גוגל צריך אותם כדי להציג את העמוד כמו לגולש
    "Allow: /assets/",
    "Allow: /fonts/",
    "Allow: /sitemap.xml",
    "Disallow: /",
    ...(base ? ["", `Sitemap: ${base}/sitemap.xml`] : []),
    "",
  ].join("\n");
}

/** ברירות המחדל (כשהשדה ריק) — לכותרות העמוד, ל-placeholder בעורך ולתצוגה המקדימה של גוגל */
export function seoDefaults(
  site: Pick<PublicSite, "business" | "properties">,
  kindLabel: string,
): { title: string; description: string } {
  const p = site.properties.find((x) => x.description?.trim());
  return {
    title: kindLabel ? `${site.business.name} | ${kindLabel}` : site.business.name,
    description: p?.description ? firstSentence(p.description) : site.business.name,
  };
}
