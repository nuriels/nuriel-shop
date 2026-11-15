// ספריית המדיה (מיגרציה 194) — צד שרת בלבד:
//   • סוג הקובץ לפי התוכן (חתימה), לא לפי הסיומת או מה שהדפדפן שלח. SVG, HEIC, HTML ואנימציה — נדחים;
//   • פענוח וקידוד מחדש עם sharp: בלי מטא-דאטה (מיקום, מכשיר), סיבוב לפי EXIF, עד 50 מגה-פיקסל;
//   • WebP ב-3 רוחבים (1600 / 960 / 480) ו-AVIF ברוחב 1600 — כל קובץ עד 8MB (מגבלת הדלי);
//   • שמירה בדלי bp-media עם הטוקן של המשתמש ו-x-tenant-id של האתר — מדיניות ה-Storage בודקת שוב את
//     התיקייה של האתר, הרשאת עריכה והדגל;
//   • מחיקה — רק נתיבים שהמסד החזיר, ורק בתיקייה של האתר.
import type SharpModule from "sharp";
import { sniffImageType } from "@/platform/media/remote-image.server";
import { apiClient } from "@/platform/supabase/api-client.server";
import { supabaseUrl } from "@/platform/supabase/env.server";
import { BusinessProfileError } from "./rpc.server";

export const MEDIA_BUCKET = "bp-media";
export const UPLOAD_MAX_BYTES = 12 * 1024 * 1024;
const MAX_PIXELS = 50_000_000;
const WIDTHS = [1600, 960, 480] as const;

export class MediaError extends BusinessProfileError {
  constructor(message: string) {
    super(message, "22023");
  }
}

export interface PreparedImage {
  files: { path: string; bytes: Buffer; contentType: string }[];
  record: {
    storage_path: string;
    variants: Record<string, string>;
    width: number;
    height: number;
    size_bytes: number;
  };
}

type SharpFactory = typeof SharpModule;
let sharpPromise: Promise<SharpFactory> | null = null;
const loadSharp = () =>
  (sharpPromise ??= import("sharp").then((m) => (m.default ?? m) as unknown as SharpFactory));

export async function prepareImage(
  bytes: Uint8Array,
  siteId: string,
  id: string,
): Promise<PreparedImage> {
  if (bytes.length === 0) throw new MediaError("הקובץ ריק");
  if (bytes.length > UPLOAD_MAX_BYTES) throw new MediaError("התמונה גדולה מדי — עד 12MB");
  const kind = sniffImageType(bytes);
  if (kind === "svg")
    throw new MediaError("קובצי SVG לא נתמכים מטעמי אבטחה — השתמשו ב-JPG / PNG / WEBP");
  if (kind === "heif") throw new MediaError("תמונות HEIC לא נתמכות — השתמשו ב-JPG / PNG / WEBP");
  if (!kind || kind === "html")
    throw new MediaError("הקובץ אינו תמונה נתמכת (JPG, PNG, WEBP, AVIF)");
  const sharp = await loadSharp();
  try {
    const source = () =>
      sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "error", animated: false }).rotate();
    const meta = await source().metadata();
    if (!meta.format || !["jpeg", "png", "webp", "avif", "gif", "tiff"].includes(meta.format))
      throw new MediaError("פורמט התמונה לא נתמך — השתמשו ב-JPG / PNG / WEBP");
    const base = `${siteId}/${id}`;
    const files: PreparedImage["files"] = [];
    let width = 0;
    let height = 0;
    for (const w of WIDTHS) {
      const out = await source()
        .resize({ width: w, height: w, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer({ resolveWithObject: true });
      if (w === 1600) {
        width = out.info.width;
        height = out.info.height;
      }
      files.push({
        path: w === 1600 ? `${base}.webp` : `${base}-${w}.webp`,
        bytes: out.data,
        contentType: "image/webp",
      });
    }
    const avif = await source()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .avif({ quality: 55, effort: 4 })
      .toBuffer();
    files.push({ path: `${base}-1600.avif`, bytes: avif, contentType: "image/avif" });
    return {
      files,
      record: {
        storage_path: `${base}.webp`,
        variants: {
          "960": `${base}-960.webp`,
          "480": `${base}-480.webp`,
          avif: `${base}-1600.avif`,
        },
        width,
        height,
        size_bytes: files.reduce((n, f) => n + f.bytes.length, 0),
      },
    };
  } catch (error) {
    if (error instanceof MediaError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (/pixel limit/i.test(message))
      throw new MediaError("התמונה ענקית מדי לעיבוד (מעל 50 מגה-פיקסל)");
    throw new MediaError("קובץ התמונה פגום או בפורמט לא נתמך");
  }
}

const bucket = (siteId: string, accessToken: string) =>
  apiClient({ schema: "public", siteId, accessToken }).storage.from(MEDIA_BUCKET);

/** שמירה בדלי עם הטוקן של המשתמש; כישלון באמצע — מה שכבר נשמר נמחק */
export async function storeFiles(
  siteId: string,
  accessToken: string,
  files: PreparedImage["files"],
) {
  const done: string[] = [];
  for (const f of files) {
    const { error } = await bucket(siteId, accessToken).upload(f.path, f.bytes, {
      contentType: f.contentType,
      upsert: false,
      cacheControl: "31536000",
    });
    if (error) {
      await removeFiles(siteId, accessToken, done);
      console.error("[business-profile] media upload failed", error.message);
      throw new MediaError(
        /row-level security|unauthorized|403/i.test(error.message)
          ? "אין הרשאה להעלות תמונות באתר הזה"
          : "שמירת הקובץ נכשלה — נסו שוב",
      );
    }
    done.push(f.path);
  }
}

/** מחיקה מהדלי — רק נתיבים בתיקייה של האתר הזה. כישלון — נרשם, לא מפיל את הפעולה */
export async function removeFiles(siteId: string, accessToken: string, paths: string[]) {
  const own = paths.filter((p) => p.startsWith(`${siteId}/`) && !p.includes(".."));
  if (!own.length) return;
  const { error } = await bucket(siteId, accessToken).remove(own);
  if (error) console.error("[business-profile] media cleanup failed", own.length, error.message);
}

export const publicUrl = (path: string | null | undefined) =>
  path ? `${supabaseUrl()}/storage/v1/object/public/${MEDIA_BUCKET}/${path}` : null;

interface RawMedia {
  id: string;
  storage_path: string;
  variants: Record<string, string>;
  width: number | null;
  height: number | null;
}

/** רשומות → מפת המדיה של האתר (כתובות ו-srcset) */
export function toMediaMap(rows: RawMedia[]) {
  const map: Record<
    string,
    {
      url: string;
      width: number | null;
      height: number | null;
      srcset: string | null;
      avif: string | null;
    }
  > = {};
  for (const r of rows) {
    const url = publicUrl(r.storage_path);
    if (!url) continue;
    const v = r.variants ?? {};
    const srcset =
      v["480"] && v["960"]
        ? `${publicUrl(v["480"])} 480w, ${publicUrl(v["960"])} 960w, ${url} ${r.width ?? 1600}w`
        : null;
    map[r.id] = { url, width: r.width, height: r.height, srcset, avif: publicUrl(v["avif"]) };
  }
  return map;
}
