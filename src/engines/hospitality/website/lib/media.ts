// בחירת תמונות לאתר: תמונת הפתיח, תמונה ראשית ליחידה, והגלריה המאוחדת (בלי כפילויות).
import type { PublicAmenity, PublicMedia, PublicSite, PublicUnit } from "../../types/website";

const isImage = (m: PublicMedia) => m.kind === "image" && !!m.url;

/** הפתיח: גלריית האתר → המתחם הראשון → היחידה הראשונה (הראשית קודם). exclude — הלוגו (D2) */
export function heroImage(site: PublicSite, exclude?: string): PublicMedia | null {
  return (
    site.gallery.find((m) => isImage(m) && m.id !== exclude) ??
    site.properties.flatMap((p) => p.media).find(isImage) ??
    site.units.flatMap((u) => u.media).find(isImage) ??
    null
  );
}

/** התמונה של יחידה; "כל המתחם" בלי תמונות משלו → של אחת היחידות שלו / של המתחם */
export function unitCover(unit: PublicUnit, site: PublicSite): PublicMedia | null {
  const own = unit.media.find(isImage);
  if (own) return own;
  const members = site.units.filter((u) => unit.member_ids?.includes(u.id));
  return (
    members.flatMap((u) => u.media).find(isImage) ??
    site.properties.find((p) => p.id === unit.property_id)?.media.find(isImage) ??
    null
  );
}

/** כל התמונות והסרטונים של היחידה (משלה, ואחר כך של המתחם) */
export function unitMedia(unit: PublicUnit, site: PublicSite): PublicMedia[] {
  const property = site.properties.find((p) => p.id === unit.property_id);
  const members = site.units.filter((u) => unit.member_ids?.includes(u.id));
  return dedupe([...unit.media, ...members.flatMap((u) => u.media), ...(property?.media ?? [])]);
}

/** הגלריה של עמוד הבית: האתר, המתחמים, היחידות. exclude — הלוגו (D2: לא מוצג כתמונה בגלריה) */
export function siteGallery(site: PublicSite, exclude?: string): PublicMedia[] {
  return dedupe([
    ...site.gallery.filter((m) => m.id !== exclude),
    ...site.properties.flatMap((p) => p.media),
    ...site.units.flatMap((u) => u.media),
  ]);
}

/** בלי כפילויות ובלי פריטים ריקים */
export function dedupeMedia(items: PublicMedia[]): PublicMedia[] {
  return dedupe(items);
}

function dedupe(items: PublicMedia[]): PublicMedia[] {
  const seen = new Set<string>();
  return items.filter((m) => {
    if (m.kind === "image" ? !m.url : !m.embed_id && !m.url) return false;
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

/** כתובת ההטמעה של סרטון (YouTube בלי עוגיות / Vimeo) */
export function embedSrc(m: PublicMedia): string | null {
  if (m.kind !== "embed" || !m.embed_id) return null;
  return m.embed_provider === "vimeo"
    ? `https://player.vimeo.com/video/${encodeURIComponent(m.embed_id)}`
    : `https://www.youtube-nocookie.com/embed/${encodeURIComponent(m.embed_id)}`;
}

/** מתקנים בלי כפילויות (לפי השם) */
export function uniqueAmenities(list: PublicAmenity[]): PublicAmenity[] {
  const seen = new Map<string, PublicAmenity>();
  for (const a of list) if (!seen.has(a.name)) seen.set(a.name, a);
  return [...seen.values()];
}

/** כל התמונות והסרטונים של האתר (גלריה, מתחמים, יחידות) — לבחירה בעורך ולמקטעים */
export function allMedia(site: PublicSite): PublicMedia[] {
  return siteGallery(site);
}

/** תמונה לפי מזהה (רק מהתמונות של האתר הזה — וגם מהלוגואים שלו, מיגרציה 42) */
export function mediaById(site: PublicSite, id: string | undefined): PublicMedia | null {
  if (!id) return null;
  return (
    [...(site.brand ?? []), ...allMedia(site)].find((m) => m.id === id && m.kind === "image") ??
    null
  );
}
