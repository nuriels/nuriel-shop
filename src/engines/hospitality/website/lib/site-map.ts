// נתוני האתר מהמסד (public_site / site_preview) → מה שהאתר מקבל: כתובות לתמונות (480 / 960 / 1600),
// מחיר כמספר, ומסמך העיצוב כמחרוזת JSON (נבדק ב-normalizeDesign לפני ההצגה). טהור — publicUrl
// מגיע מהשרת.
import type {
  PublicMedia,
  PublicRoomType,
  PublicSite,
  RawPublicMedia,
  RawPublicSite,
} from "../../types/website";
import type { PublicPackage } from "../../types/packages";

type PublicUrl = (p: string | null | undefined) => string | null;

function mediaUrls(publicUrl: PublicUrl) {
  return ({ path, variants, ...rest }: RawPublicMedia): PublicMedia => {
    const v = variants ?? {};
    return {
      ...rest,
      url: publicUrl(path),
      thumb_url: publicUrl(v["480"] ?? v["thumb"] ?? (rest.kind === "image" ? path : null)),
      srcset:
        rest.kind === "image" && v["480"] && v["960"]
          ? `${publicUrl(v["480"])} 480w, ${publicUrl(v["960"])} 960w, ${publicUrl(path)} ${rest.width ?? 1600}w`
          : null,
    };
  };
}

export function toPublicSite(
  raw: RawPublicSite,
  publicUrl: PublicUrl,
  roomTypes: PublicRoomType[] = [],
  packages: PublicPackage[] = [],
): PublicSite {
  const urls = mediaUrls(publicUrl);
  return {
    ...raw,
    room_types: roomTypes,
    packages: packages.map((p) => ({ ...p, price: Number(p.price) })),
    design: raw.design
      ? { ...raw.design, document: JSON.stringify(raw.design.document ?? {}) }
      : null,
    gallery: raw.gallery.map(urls),
    brand: (raw.brand ?? []).map(urls),
    properties: raw.properties.map((p) => ({ ...p, media: p.media.map(urls) })),
    units: raw.units.map((u) => ({
      ...u,
      base_price: Number(u.base_price),
      media: u.media.map(urls),
    })),
  };
}
