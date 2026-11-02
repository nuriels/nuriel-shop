// תמונות וגלריות (Stage 2e) — מה שפונקציות המסד מחזירות (מיגרציה 12), עם הקישורים הציבוריים.
// "brand" — הלוגו (מיגרציה 42): נשמר בנפרד, לא מוצג ב"תמונות" ולא נהיה תמונה ראשית.
export type GalleryKind = "site" | "property" | "unit" | "brand";

export interface MediaItem {
  id: string;
  kind: "image" | "video" | "embed";
  alt: string | null;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  is_cover: boolean;
  sort_order: number;
  is_demo: boolean;
  licence_ref: string | null;
  source_url: string | null;
  embed_provider: "youtube" | "vimeo" | null;
  embed_id: string | null;
  /** הקובץ שלנו (WebP 1600 / הסרטון); null בהטמעה */
  url: string | null;
  /** תמונה ממוזערת לניהול (או התמונה עצמה) */
  thumb_url: string | null;
  /** srcset לאתר: 480w, 960w, 1600w */
  srcset: string | null;
}

export interface MediaUsage {
  bytes: number;
  files: number;
  items: number;
}

export interface Gallery {
  owner_kind: GalleryKind;
  owner_id: string | null;
  label: string;
  usage: MediaUsage;
  items: MediaItem[];
}

export interface GalleryCard {
  id: string;
  name: string;
  count: number;
  cover: MediaItem | null;
}
export interface GalleriesOverview {
  usage: MediaUsage;
  site: { count: number; cover: MediaItem | null };
  properties: (GalleryCard & { units: (GalleryCard & { is_active: boolean })[] })[];
}

export interface GalleryRef {
  ownerKind: GalleryKind;
  ownerId: string | null;
}

export type MediaActionResult =
  { status: "done"; gallery: Gallery } | { status: "conflict"; message: string; gallery: Gallery };
