// הכתובת הקנונית ומפת האתר של אתר עסק — רק מהגרסה המפורסמת. SEO מלא (הגדרות לכל עמוד, schema.org,
// llms.txt) — Stage 4.
import { currentSiteAddresses } from "@/platform/tenancy/current-site.server";
import { loadPublicSite } from "./public-site.server";

const ORIGIN = /^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/i;

export async function canonicalSiteOrigin(): Promise<string | null> {
  const { primary, subdomain } = await currentSiteAddresses();
  const pick = (primary ?? subdomain ?? "").replace(/\/+$/, "");
  return ORIGIN.test(pick) ? pick : null;
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** מפת אתר — טהור (נבדק ביחידה) */
export function sitemapXml(origin: string, slugs: string[], lastmod: string | null): string {
  const date = lastmod ? lastmod.slice(0, 10) : null;
  const urls = [...new Set(slugs)].map((slug) => {
    const loc = `${origin}/${slug ? encodeURI(slug) : ""}`;
    return `  <url><loc>${xmlEscape(loc)}</loc>${date ? `<lastmod>${date}</lastmod>` : ""}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

export async function sitemapResponse(siteId: string): Promise<Response | null> {
  const [site, origin] = await Promise.all([loadPublicSite(siteId), canonicalSiteOrigin()]);
  if (!site || !origin) return null;
  const xml = sitemapXml(
    origin,
    site.document.pages.map((p) => p.slug),
    site.publishedAt,
  );
  return new Response(xml, {
    status: 200,
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "no-store" },
  });
}
