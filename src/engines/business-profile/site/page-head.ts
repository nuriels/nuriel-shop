// הכותרות של עמוד באתר העסק: כותרת ותיאור (מהגדרות העמוד, אחרת מפרטי העסק), כתובת קנונית, Open Graph
// (כולל תמונת שיתוף), Twitter, אייקון האתר מהלוגו, ו-schema.org (העסק והאתר) בדף הבית. טהור (נבדק ביחידה).
// אותו חישוב משמש גם לתצוגה המקדימה של תוצאת גוגל בממשק הניהול (seoSummary).
import { tx } from "../document/normalize";
import type { Page, SiteDocument } from "../document/schema";
import type { MediaMap, PublicSiteData } from "../types";
import siteCss from "./site.css?url";

export const SITE_STYLE_LINKS = [
  { rel: "stylesheet", href: "/fonts/bp/websites.css" },
  { rel: "stylesheet", href: siteCss },
];

export interface SeoSummary {
  siteName: string;
  title: string;
  description: string;
  canonical: string | null;
  image: { url: string; width: number | null; height: number | null; alt: string } | null;
  /** אייקון האתר (הלוגו, בגודל הקטן) */
  icon: string | null;
}

/** הגרסה הקטנה של תמונה (480) מתוך ה-srcset, אחרת הכתובת הרגילה */
function smallUrl(m: MediaMap[string]): string {
  const first = m.srcset?.split(",")[0]?.trim().split(/\s+/)[0];
  return first || m.url;
}

function heroImage(page: Page): { media: string | null; alt: { he: string } } | null {
  for (const block of page.blocks) {
    if (block.type !== "hero" || block.hidden) continue;
    const image = (block.props as { image?: { media: string | null; alt: { he: string } } }).image;
    if (image?.media) return image;
  }
  return null;
}

export function seoSummary(
  doc: SiteDocument,
  page: Page,
  media: MediaMap,
  origin: string | null,
  fallbackName: string,
): SeoSummary {
  const name = tx(doc.business.name) || fallbackName;
  const title = tx(page.seo.title) || (page.slug ? `${tx(page.title)} | ${name}` : name);
  const description = tx(page.seo.description) || tx(doc.business.tagline) || name;
  const canonical = origin ? `${origin}/${page.slug ? encodeURI(page.slug) : ""}` : null;
  const candidates = [page.seo.image, heroImage(page), doc.business.logo];
  let image: SeoSummary["image"] = null;
  for (const c of candidates) {
    const m = c?.media ? media[c.media] : undefined;
    if (m) {
      image = { url: m.url, width: m.width, height: m.height, alt: tx(c!.alt) || name };
      break;
    }
  }
  const logo = doc.business.logo.media ? media[doc.business.logo.media] : undefined;
  return {
    siteName: name,
    title,
    description,
    canonical,
    image,
    icon: logo ? smallUrl(logo) : null,
  };
}

/** JSON בטוח בתוך <script type="application/ld+json"> (בלי סגירת התגית / HTML מוזרק) */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(new RegExp(String.fromCharCode(0x2028), "g"), "\\u2028")
    .replace(new RegExp(String.fromCharCode(0x2029), "g"), "\\u2029");
}

/** schema.org לדף הבית: העסק (שירות מקצועי) והאתר (השם שגוגל יכול להציג) */
export function businessJsonLd(doc: SiteDocument, seo: SeoSummary, origin: string) {
  const logo = doc.business.logo.media ? seo.icon : null;
  const business: Record<string, unknown> = {
    "@type": "ProfessionalService",
    "@id": `${origin}/#business`,
    name: seo.siteName,
    url: `${origin}/`,
    description: seo.description,
    inLanguage: "he",
    areaServed: { "@type": "Country", name: "ישראל" },
  };
  if (seo.image) business["image"] = seo.image.url;
  if (logo) business["logo"] = logo;
  if (doc.business.phone) business["telephone"] = doc.business.phone;
  if (doc.business.email) business["email"] = doc.business.email;
  return {
    "@context": "https://schema.org",
    "@graph": [
      business,
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        name: seo.siteName,
        url: `${origin}/`,
        inLanguage: "he",
        publisher: { "@id": `${origin}/#business` },
      },
    ],
  };
}

export function pageHead(site: PublicSiteData, page: Page) {
  const seo = seoSummary(site.document, page, site.media, site.origin, site.name);
  const meta: Record<string, string>[] = [
    { title: seo.title },
    { name: "description", content: seo.description },
    { property: "og:title", content: seo.title },
    { property: "og:description", content: seo.description },
    { property: "og:site_name", content: seo.siteName },
    { property: "og:type", content: "website" },
    { property: "og:locale", content: "he_IL" },
    { name: "twitter:card", content: seo.image ? "summary_large_image" : "summary" },
    { name: "twitter:title", content: seo.title },
    { name: "twitter:description", content: seo.description },
    ...(seo.canonical ? [{ property: "og:url", content: seo.canonical }] : []),
  ];
  if (seo.image) {
    meta.push(
      { property: "og:image", content: seo.image.url },
      { property: "og:image:alt", content: seo.image.alt },
      { name: "twitter:image", content: seo.image.url },
    );
    if (seo.image.width && seo.image.height)
      meta.push(
        { property: "og:image:width", content: String(seo.image.width) },
        { property: "og:image:height", content: String(seo.image.height) },
      );
  }
  const links: { rel: string; href: string; type?: string }[] = [...SITE_STYLE_LINKS];
  if (seo.canonical) links.push({ rel: "canonical", href: seo.canonical });
  if (seo.icon)
    links.push({ rel: "icon", href: seo.icon }, { rel: "apple-touch-icon", href: seo.icon });
  const scripts =
    !page.slug && site.origin
      ? [
          {
            type: "application/ld+json",
            children: jsonLd(businessJsonLd(site.document, seo, site.origin)),
          },
        ]
      : [];
  return { meta, links, scripts };
}
