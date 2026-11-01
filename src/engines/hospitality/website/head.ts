// כותרות העמוד של האתר הציבורי (SEO בסיסי): שם, תיאור, תמונת שיתוף, אינדוקס, ונתונים מובנים
// (LodgingBusiness) בעמוד הבית. מפת אתר ו-hreflang — Stage 7.
import type { PublicSite, PublicUnit } from "../types/website";
import { siteCopy } from "./copy";
import { firstSentence } from "./lib/format";
import { heroImage, unitCover } from "./lib/media";

type Meta = Record<string, string>;

function base(title: string, description: string, image: string | null): Meta[] {
  return [
    { title },
    { name: "description", content: description },
    { name: "robots", content: "index, follow" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: image ? "summary_large_image" : "summary" },
    ...(image
      ? [
          { property: "og:image", content: image },
          { name: "twitter:image", content: image },
        ]
      : []),
  ];
}

function describe(site: PublicSite): string {
  const p = site.properties.find((x) => x.description?.trim());
  return p?.description ? firstSentence(p.description) : site.business.name;
}

export function siteHomeMeta(site: PublicSite | undefined) {
  if (!site) return [];
  const t = siteCopy("he");
  const p = site.properties[0];
  const kind = p?.property_type ? t.propertyTypes[p.property_type] : "";
  const title = kind ? `${site.business.name} | ${kind}` : site.business.name;
  const image = heroImage(site)?.url ?? null;
  const prices = site.units.map((u) => u.base_price);
  const ld = {
    "@context": "https://schema.org",
    "@type": "LodgingBusiness",
    name: site.business.name,
    description: describe(site),
    ...(image ? { image } : {}),
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
  return [...base(title, describe(site), image), { "script:ld+json": ld } as unknown as Meta];
}

export function siteUnitMeta(site: PublicSite, unit: PublicUnit) {
  const title = unit.seo_title?.trim() || `${unit.name} | ${site.business.name}`;
  const description =
    unit.seo_description?.trim() ||
    (unit.description ? firstSentence(unit.description) : describe(site));
  return base(title, description, unitCover(unit, site)?.url ?? null);
}

/** עמודים פרטיים של האתר (הזמנה, ניהול ההזמנה, טיוטות משפטיות) — לא לאינדוקס */
export function privatePageMeta(title: string, site: PublicSite | undefined) {
  return [
    { title: site ? `${title} | ${site.business.name}` : title },
    { name: "robots", content: "noindex, nofollow" },
  ];
}
