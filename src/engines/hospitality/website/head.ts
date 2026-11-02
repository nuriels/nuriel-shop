// כותרות העמוד של האתר הציבורי (SEO): שם, תיאור, תמונת שיתוף, כתובת קנונית, Open Graph, Twitter
// Cards, אינדוקס, אימות Google Search Console (בדף הבית) ונתונים מובנים (LodgingBusiness).
// E5: הערכים מהגדרות "גוגל ושיתוף" של הגרסה המפורסמת; שדה ריק — ברירת המחדל. הכול נבנה כאן
// מערכים שנבדקו (normalizeDesign) — אין HTML שהעסק הזין.
import { SITE_PATH } from "../config";
import type { PublicSite, PublicUnit } from "../types/website";
import { siteCopy } from "./copy";
import { normalizeDesign } from "./design/schema";
import { firstSentence } from "./lib/format";
import { heroImage, mediaById, unitCover } from "./lib/media";
import { seoDefaults, siteSeo } from "./seo";

type Meta = Record<string, string>;
type Link = { rel: string; href: string };
export interface PageHead {
  meta: Meta[];
  links: Link[];
}

function base(o: {
  title: string;
  description: string;
  image: string | null;
  url: string | null;
  siteName: string;
}): Meta[] {
  return [
    { title: o.title },
    { name: "description", content: o.description },
    { name: "robots", content: "index, follow" },
    { property: "og:title", content: o.title },
    { property: "og:description", content: o.description },
    { property: "og:type", content: "website" },
    { property: "og:locale", content: "he_IL" },
    { property: "og:site_name", content: o.siteName },
    ...(o.url ? [{ property: "og:url", content: o.url }] : []),
    { name: "twitter:card", content: o.image ? "summary_large_image" : "summary" },
    { name: "twitter:title", content: o.title },
    { name: "twitter:description", content: o.description },
    ...(o.image
      ? [
          { property: "og:image", content: o.image },
          { name: "twitter:image", content: o.image },
        ]
      : []),
  ];
}

const canonical = (url: string | null): Link[] => (url ? [{ rel: "canonical", href: url }] : []);
const absolute = (site: PublicSite, path: string) => (site.origin ? `${site.origin}${path}` : null);

function describe(site: PublicSite): string {
  const p = site.properties.find((x) => x.description?.trim());
  return p?.description ? firstSentence(p.description) : site.business.name;
}

export function siteHomeHead(site: PublicSite | undefined): PageHead {
  if (!site) return { meta: [], links: [] };
  const t = siteCopy("he");
  const p = site.properties[0];
  const kind = (p?.property_type ? t.propertyTypes[p.property_type] : "") ?? "";
  const seo = siteSeo(site);
  const defaults = seoDefaults(site, kind);
  const title = seo.title || defaults.title;
  const description = seo.description || defaults.description;
  // הלוגו (D2) לא משמש כתמונת שיתוף; הוא נכנס לנתונים המובנים כ-logo. תמונת שיתוף שנבחרה (E5) —
  // קודמת לתמונת הפתיח
  const logoId = normalizeDesign(site.design?.document ?? null, site.design?.theme).logo;
  const image = mediaById(site, seo.image)?.url ?? heroImage(site, logoId)?.url ?? null;
  const logo = mediaById(site, logoId)?.url ?? null;
  const url = absolute(site, SITE_PATH);
  const prices = site.units.map((u) => u.base_price);
  const ld = {
    "@context": "https://schema.org",
    "@type": "LodgingBusiness",
    name: site.business.name,
    description: describe(site),
    ...(url ? { url } : {}),
    ...(image ? { image } : {}),
    ...(logo ? { logo } : {}),
    ...(site.business.phone ? { telephone: site.business.phone } : {}),
    ...(site.business.email ? { email: site.business.email } : {}),
    ...(site.business.address ? { address: site.business.address } : {}),
    ...(site.business.check_in_time ? { checkinTime: site.business.check_in_time } : {}),
    ...(site.business.check_out_time ? { checkoutTime: site.business.check_out_time } : {}),
    ...(p?.location
      ? { geo: { "@type": "GeoCoordinates", latitude: p.location.lat, longitude: p.location.lng } }
      : {}),
    ...(prices.length
      ? { priceRange: `${Math.min(...prices)}–${Math.max(...prices)} ${site.business.currency}` }
      : {}),
  };
  return {
    meta: [
      ...base({ title, description, image, url, siteName: site.business.name }),
      // אימות Search Console: רק קוד תקין (נבדק ב-normalizeDesign), כ-content של תגית שנבנית כאן
      ...(seo.google ? [{ name: "google-site-verification", content: seo.google }] : []),
      { "script:ld+json": ld } as unknown as Meta,
    ],
    links: canonical(url),
  };
}

export function siteHomeMeta(site: PublicSite | undefined) {
  return siteHomeHead(site).meta;
}

/** עמוד יחידה / סוג חדר; path — הכתובת הקנונית (חדר ששייך לסוג → עמוד הסוג) */
export function siteUnitHead(site: PublicSite, unit: PublicUnit, path: string): PageHead {
  const title = unit.seo_title?.trim() || `${unit.name} | ${site.business.name}`;
  const description =
    unit.seo_description?.trim() ||
    (unit.description ? firstSentence(unit.description) : describe(site));
  const url = absolute(site, path);
  return {
    meta: base({
      title,
      description,
      image: unitCover(unit, site)?.url ?? null,
      url,
      siteName: site.business.name,
    }),
    links: canonical(url),
  };
}

export function siteUnitMeta(site: PublicSite, unit: PublicUnit) {
  return siteUnitHead(site, unit, `${SITE_PATH}/units/${encodeURIComponent(unit.slug)}`).meta;
}

/** עמודים פרטיים של האתר (הזמנה, ניהול ההזמנה, טיוטות משפטיות) — לא לאינדוקס */
export function privatePageMeta(title: string, site: PublicSite | undefined) {
  return [
    { title: site ? `${title} | ${site.business.name}` : title },
    { name: "robots", content: "noindex, nofollow" },
  ];
}
