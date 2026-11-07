// כותרות העמוד של האתר הציבורי (SEO): שם, תיאור, תמונת שיתוף, כתובת קנונית, Open Graph, Twitter
// Cards, אינדוקס, אימות Google Search Console (בדף הבית) ונתונים מובנים (LodgingBusiness).
// E5: הערכים מהגדרות "גוגל ושיתוף" של הגרסה המפורסמת; שדה ריק — ברירת המחדל. הכול נבנה כאן
// מערכים שנבדקו (normalizeDesign) — אין HTML שהעסק הזין.
import { SITE_PATH } from "../config";
import type { PublicSite, PublicUnit } from "../types/website";
import { siteCopy } from "./copy";
import { brandAssetUrl, SHARE_IMAGE } from "./lib/brand";
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

/** תמונת שיתוף; size — כשידוע (תמונת הלוגו שנוצרת אצלנו), עוזר לסורקים להציג בלי הורדה מקדימה */
type ShareImage = {
  url: string;
  size: { width: number; height: number; type: string } | null;
};

function base(o: {
  title: string;
  description: string;
  image: ShareImage | null;
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
          { property: "og:image", content: o.image.url },
          ...(o.image.size
            ? [
                { property: "og:image:width", content: String(o.image.size.width) },
                { property: "og:image:height", content: String(o.image.size.height) },
                { property: "og:image:type", content: o.image.size.type },
              ]
            : []),
          { property: "og:image:alt", content: o.siteName },
          { name: "twitter:image", content: o.image.url },
        ]
      : []),
  ];
}

/**
 * A1: תמונת השיתוף של העסק (ווטסאפ, פייסבוק ושאר הרשתות) — הלוגו שהעסק העלה, כ-PNG קטן מהדומיין של
 * האתר (/stay/brand/og-image); null — אין לוגו או שהכתובת הקנונית של האתר לא ידועה (סורקים צריכים כתובת
 * מלאה). אף פעם לא הלוגו של נוריאל.
 */
export function logoShareImage(site: PublicSite, logoId: string | undefined): ShareImage | null {
  const logo = logoId ? mediaById(site, logoId) : null;
  if (!logo || logo.kind !== "image" || !site.origin) return null;
  return { url: brandAssetUrl("og-image", logo.id, site.origin), size: SHARE_IMAGE };
}

const photo = (url: string | null | undefined): ShareImage | null =>
  url ? { url, size: null } : null;

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
  // A1: תמונת השיתוף — תמונה שנבחרה בהגדרות "גוגל ושיתוף" (E5) → הלוגו של העסק (PNG קטן מהדומיין
  // של האתר) → תמונת הפתיח. בנתונים המובנים: image — תמונה של המקום, logo — הלוגו.
  const logoId = normalizeDesign(site.design?.document ?? null, site.design?.theme).logo;
  const hero = heroImage(site, logoId)?.url ?? null;
  const share =
    photo(mediaById(site, seo.image)?.url) ?? logoShareImage(site, logoId) ?? photo(hero);
  const image = mediaById(site, seo.image)?.url ?? hero;
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
      ...base({ title, description, image: share, url, siteName: site.business.name }),
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
  // A1: תמונת היחידה; יחידה בלי תמונה — הלוגו של העסק (לא תמונה ריקה ולא האייקון הכללי)
  const logoId = normalizeDesign(site.design?.document ?? null, site.design?.theme).logo;
  return {
    meta: base({
      title,
      description,
      image: photo(unitCover(unit, site)?.url) ?? logoShareImage(site, logoId),
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
