// הכתובת הקנונית, מפת האתר ו-llms.txt של אתר עסק — רק מהגרסה המפורסמת (מה שכל גולש רואה).
import { currentSiteAddresses } from "@/platform/tenancy/current-site.server";
import { renderLlms } from "@/platform/seo/llms";
import type { SiteDocument } from "../document/schema";
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
    // העמודים + הצהרת הנגישות (בכל אתר עסק)
    [...site.document.pages.map((p) => p.slug), "accessibility"],
    site.publishedAt,
  );
  return new Response(xml, {
    status: 200,
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "no-store" },
  });
}

/**
 * llms.txt — טהור (נבדק ביחידה): שם העסק, המשפט שלו, פרטי הקשר שמוצגים באתר, העמודים והצהרת הנגישות.
 * רק מהגרסה המפורסמת; בלי טיוטות, בלי פניות, בלי שום דבר מהסטודיו.
 */
export function businessLlmsTxt(origin: string, doc: SiteDocument, fallbackName: string): string {
  const base = origin.replace(/\/+$/, "");
  const b = doc.business;
  const home = doc.pages.find((p) => p.slug === "") ?? doc.pages[0];
  return renderLlms({
    name: b.name.he || fallbackName,
    summary: b.tagline.he || home?.seo.description.he,
    facts: [
      ["כתובת", b.address.he],
      ["שעות פעילות", b.hours.he],
      ["טלפון", b.phone],
      ["וואטסאפ", b.whatsapp],
      ["אימייל", b.email],
    ],
    sections: [
      {
        title: "עמודי האתר",
        links: doc.pages.map((p) => ({
          title: p.title.he || (p.slug ? p.slug : "דף הבית"),
          url: `${base}/${p.slug ? encodeURI(p.slug) : ""}`,
          note: p.seo.description.he || null,
        })),
      },
      { title: "מידע נוסף", links: [{ title: "הצהרת נגישות", url: `${base}/accessibility` }] },
    ],
    sitemap: `${base}/sitemap.xml`,
  });
}

export async function llmsResponse(siteId: string): Promise<Response | null> {
  const [site, origin] = await Promise.all([loadPublicSite(siteId), canonicalSiteOrigin()]);
  if (!site || !origin) return null;
  return new Response(businessLlmsTxt(origin, site.document, site.name), {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}
