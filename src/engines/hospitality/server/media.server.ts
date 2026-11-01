// תמונות וסרטונים (Stage 2e) — צד שרת בלבד:
//   • בדיקת התוכן האמיתי (חתימת הקובץ — לא הסיומת ולא ה-Content-Type שהדפדפן שלח);
//   • תמונה: פענוח וקידוד מחדש עם sharp (מסיר מטא-דאטה ומיקום, מנטרל קבצים "כפולים"),
//     4 גדלים ב-WebP: 1600 (המקור שלנו), 960, 480 ותמונה ממוזערת 320×240. בלי SVG, בלי
//     HEIC, בלי אנימציה, עד 50 מגה-פיקסל;
//   • סרטון: MP4 / MOV / WebM לפי החתימה, עד 50MB (נשמר כמו שהוא — אין קידוד מחדש);
//   • כתיבה לדלי hosp-media עם הטוקן של המשתמש ו-x-tenant-id של האתר — מדיניות ה-Storage
//     בודקת שוב נתיב "<tenant>/…", הרשאת media והדגל (G12, נבדק מול Storage האמיתי);
//   • מחיקה — רק הנתיבים שפונקציות המסד החזירו.
import { randomUUID } from "node:crypto";
import type SharpModule from "sharp";
import { apiClient } from "@/platform/supabase/api-client.server";
import { supabaseUrl } from "@/platform/supabase/env.server";
import { sniffImageType } from "@/platform/media/remote-image.server";
import { HOSPITALITY_SCHEMA } from "../config";
import { HospitalityError } from "./rpc.server";

export const MEDIA_BUCKET = "hosp-media";
export const IMAGE_UPLOAD_MAX_BYTES = 15 * 1024 * 1024;
export const VIDEO_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const MAX_PIXELS = 50_000_000;
const SIZES = { main: 1600, "960": 960, "480": 480 } as const;
const THUMB = { width: 320, height: 240 };
const QUALITY = 80;

export class MediaError extends HospitalityError {
  constructor(message: string) {
    super(message, "22023");
  }
}

export interface StoredFile {
  path: string;
  bytes: Buffer;
  contentType: string;
}
export interface PreparedMedia {
  kind: "image" | "video";
  files: StoredFile[];
  item: {
    kind: "image" | "video";
    storage_path: string;
    variants: Record<string, string>;
    width: number | null;
    height: number | null;
    size_bytes: number;
  };
}

type SharpFactory = typeof SharpModule;
let sharpPromise: Promise<SharpFactory> | null = null;
function loadSharp(): Promise<SharpFactory> {
  sharpPromise ??= import("sharp").then((m) => (m.default ?? m) as unknown as SharpFactory);
  return sharpPromise;
}

/** סוג סרטון לפי החתימה: ftyp (MP4 / MOV) או EBML (WebM) */
export function sniffVideoType(bytes: Uint8Array): "mp4" | "mov" | "webm" | null {
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...Array.from(bytes.subarray(from, to)));
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp") return ascii(8, 10) === "qt" ? "mov" : "mp4";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return "webm";
  return null;
}

const VIDEO_TYPES = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" } as const;

/** הקובץ שהועלה / הורד → קבצים לשמירה + הפריט לרישום במסד. כל דבר אחר — הודעה בעברית */
export async function prepareMedia(
  siteId: string,
  bytes: Buffer,
  allowVideo: boolean,
): Promise<PreparedMedia> {
  if (bytes.length === 0) throw new MediaError("הקובץ ריק");
  const id = randomUUID();
  const video = sniffVideoType(bytes);
  if (video) {
    if (!allowVideo) throw new MediaError("הקישור לא מוביל לקובץ תמונה");
    if (bytes.length > VIDEO_UPLOAD_MAX_BYTES) throw new MediaError("הסרטון גדול מדי — עד 50MB");
    const path = `${siteId}/${id}.${video}`;
    return {
      kind: "video",
      files: [{ path, bytes, contentType: VIDEO_TYPES[video] }],
      item: {
        kind: "video",
        storage_path: path,
        variants: {},
        width: null,
        height: null,
        size_bytes: bytes.length,
      },
    };
  }
  if (bytes.length > IMAGE_UPLOAD_MAX_BYTES) throw new MediaError("התמונה גדולה מדי — עד 15MB");
  const kind = sniffImageType(bytes);
  if (kind === "svg")
    throw new MediaError("קובצי SVG לא נתמכים מטעמי אבטחה — השתמשו ב-JPG / PNG / WEBP");
  if (kind === "heif") throw new MediaError("תמונות HEIC לא נתמכות — השתמשו ב-JPG / PNG / WEBP");
  if (!kind || kind === "html")
    throw new MediaError("הקובץ אינו תמונה או סרטון נתמך (JPG, PNG, WEBP, MP4)");
  const sharp = await loadSharp();
  try {
    const source = () =>
      sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "error", animated: false }).rotate();
    const meta = await source().metadata();
    if (!meta.format || !["jpeg", "png", "webp", "gif", "avif", "tiff"].includes(meta.format))
      throw new MediaError("פורמט התמונה לא נתמך — השתמשו ב-JPG / PNG / WEBP");
    const out = async (width: number) =>
      source()
        .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toBuffer({ resolveWithObject: true });
    const main = await out(SIZES.main);
    const w960 = await out(SIZES["960"]);
    const w480 = await out(SIZES["480"]);
    const thumb = await source()
      .resize({ ...THUMB, fit: "cover", position: "attention" })
      .webp({ quality: QUALITY })
      .toBuffer();
    const base = `${siteId}/${id}`;
    const files: StoredFile[] = [
      { path: `${base}.webp`, bytes: main.data, contentType: "image/webp" },
      { path: `${base}-960.webp`, bytes: w960.data, contentType: "image/webp" },
      { path: `${base}-480.webp`, bytes: w480.data, contentType: "image/webp" },
      { path: `${base}-thumb.webp`, bytes: thumb, contentType: "image/webp" },
    ];
    return {
      kind: "image",
      files,
      item: {
        kind: "image",
        storage_path: `${base}.webp`,
        variants: {
          "960": `${base}-960.webp`,
          "480": `${base}-480.webp`,
          thumb: `${base}-thumb.webp`,
        },
        width: main.info.width,
        height: main.info.height,
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

function storage(siteId: string, accessToken: string) {
  return apiClient({ schema: HOSPITALITY_SCHEMA, siteId, accessToken }).storage.from(MEDIA_BUCKET);
}

/** שמירה בדלי עם הטוקן של המשתמש; כישלון באמצע — מה שכבר נשמר נמחק */
export async function storeFiles(
  siteId: string,
  accessToken: string,
  files: StoredFile[],
): Promise<void> {
  const bucket = storage(siteId, accessToken);
  const done: string[] = [];
  for (const f of files) {
    const { error } = await bucket.upload(f.path, f.bytes, {
      contentType: f.contentType,
      upsert: false,
      cacheControl: "31536000",
    });
    if (error) {
      await removeFiles(siteId, accessToken, done);
      console.error("[hospitality] media upload failed", error.message);
      throw new MediaError(
        /row-level security|unauthorized|403/i.test(error.message)
          ? "אין הרשאה להעלות תמונות באתר הזה"
          : "שמירת הקובץ נכשלה — נסו שוב",
      );
    }
    done.push(f.path);
  }
}

/** מחיקה מהדלי — רק נתיבים שהמסד החזיר (של האתר הזה). כישלון — נרשם, לא מפיל את הפעולה */
export async function removeFiles(
  siteId: string,
  accessToken: string,
  paths: string[],
): Promise<void> {
  const own = paths.filter((p) => p.startsWith(`${siteId}/`) && !p.includes(".."));
  if (own.length === 0) return;
  const { error } = await storage(siteId, accessToken).remove(own);
  if (error) console.error("[hospitality] media cleanup failed", own.length, error.message);
}

export const publicUrl = (path: string | null | undefined) =>
  path ? `${supabaseUrl()}/storage/v1/object/public/${MEDIA_BUCKET}/${path}` : null;
