// תמונות וגלריות (Stage 2e): בדיקת הקלט בשרת ובדפדפן — אותם כללים והודעות כמו המסד
// (מיגרציה 12). קישור לסרטון: YouTube / Vimeo בלבד → ספק + מזהה (הקישור לא נפתח).
import type { GalleryKind, GalleryRef } from "../types/media";
import { InputError, uuid } from "./input";

export const ALT_MAX = 250;
export const GALLERY_MAX = 60;

type Raw = Record<string, unknown> | null | undefined;

export function parseGallery(input: Raw): GalleryRef {
  const i = input ?? {};
  const kind = i["ownerKind"];
  if (kind !== "site" && kind !== "property" && kind !== "unit")
    throw new InputError("הגלריה לא נמצאה");
  return {
    ownerKind: kind as GalleryKind,
    ownerId: kind === "site" ? null : uuid(i["ownerId"], kind === "unit" ? "היחידה" : "המתחם"),
  };
}

export function altError(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return "טקסט חלופי — ערך לא תקין";
  return v.trim().length > ALT_MAX ? `טקסט חלופי ארוך מדי (עד ${ALT_MAX} תווים)` : null;
}
const alt = (v: unknown) => {
  const e = altError(v);
  if (e) throw new InputError(e);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};

export type VideoLink = { provider: "youtube" | "vimeo"; id: string };

/** youtube.com/watch?v=… · youtu.be/… · youtube.com/shorts/… · /embed/… · vimeo.com/123 · player.vimeo.com/video/123 */
export function parseVideoLink(text: string): VideoLink | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\.|^m\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  let id: string | undefined;
  if (host === "youtu.be") id = parts[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (parts[0] === "watch") id = url.searchParams.get("v") ?? undefined;
    else if (["shorts", "embed", "live", "v"].includes(parts[0] ?? "")) id = parts[1];
  }
  if (id !== undefined) return /^[A-Za-z0-9_-]{11}$/.test(id) ? { provider: "youtube", id } : null;
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const vid = parts.find((p) => /^\d{6,12}$/.test(p));
    return vid ? { provider: "vimeo", id: vid } : null;
  }
  return null;
}

export function parseVideoLinkInput(
  input: Raw,
): GalleryRef & { video: VideoLink; alt: string | null } {
  const i = input ?? {};
  const video = typeof i["url"] === "string" ? parseVideoLink(i["url"]) : null;
  if (!video) throw new InputError("קישור הסרטון לא תקין — רק YouTube או Vimeo");
  return { ...parseGallery(i), video, alt: alt(i["alt"]) };
}

export function parseImportInput(input: Raw): GalleryRef & { url: string; alt: string | null } {
  const i = input ?? {};
  const url = i["url"];
  if (typeof url !== "string" || url.trim() === "" || url.length > 1000)
    throw new InputError("יש להדביק קישור לתמונה");
  if (!/^https?:\/\//i.test(url.trim())) throw new InputError("רק קישורי http / https נתמכים");
  return { ...parseGallery(i), url: url.trim(), alt: alt(i["alt"]) };
}

export function parseMediaId(input: Raw): { id: string } {
  return { id: uuid((input ?? {})["id"], "התמונה") };
}

export function parseAlt(input: Raw): { id: string; alt: string | null } {
  return { ...parseMediaId(input), alt: alt((input ?? {})["alt"]) };
}

export function parseMediaOrder(input: Raw): GalleryRef & { expected: string[]; ids: string[] } {
  const i = input ?? {};
  const list = (v: unknown, what: string) => {
    if (!Array.isArray(v) || v.length > GALLERY_MAX)
      throw new InputError(`${what} — רשימה לא תקינה`);
    return v.map((x) => uuid(x, what));
  };
  const expected = list(i["expected"], "הסדר הקודם");
  const ids = list(i["ids"], "הסדר החדש");
  if (
    ids.length !== expected.length ||
    new Set(ids).size !== ids.length ||
    ids.some((x) => !expected.includes(x))
  )
    throw new InputError("רשימת הסדר לא תקינה");
  return { ...parseGallery(i), expected, ids };
}

/** העלאה / החלפה (FormData): הגלריה, הקובץ ו-ALT; או id לפריט שמוחלף */
export function parseUploadForm(data: unknown): {
  gallery: GalleryRef;
  replaceId: string | null;
  file: File;
  alt: string | null;
} {
  if (!(data instanceof FormData)) throw new InputError("בקשה לא תקינה");
  const file = data.get("file");
  if (!(file instanceof File) || file.size === 0) throw new InputError("לא נבחר קובץ");
  if (file.size > 50 * 1024 * 1024) throw new InputError("הקובץ גדול מדי — עד 50MB");
  const replace = data.get("replaceId");
  const str = (k: string) =>
    typeof data.get(k) === "string" ? (data.get(k) as string) : undefined;
  return {
    gallery: parseGallery({ ownerKind: str("ownerKind"), ownerId: str("ownerId") || undefined }),
    replaceId: replace ? uuid(replace, "התמונה") : null,
    file,
    alt: alt(str("alt") ?? null),
  };
}

export const formatBytes = (n: number) =>
  n >= 1024 * 1024 * 1024
    ? `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
    : n >= 1024 * 1024
      ? `${(n / 1024 / 1024).toFixed(1)} MB`
      : `${Math.max(1, Math.round(n / 1024))} KB`;
