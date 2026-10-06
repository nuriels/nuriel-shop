/**
 * הורדת תמונות מאתרים חיצוניים ושמירתן אצלנו (חלק 18 — ייבוא מוצרים מ-CSV).
 *
 *   fetchRemoteImage   — הורדה בטוחה של קישור אחד (Buffer):
 *       • רק http / https, בלי שם משתמש / סיסמה בקישור.
 *       • הגנת SSRF: כל כתובת IP שהדומיין מתורגם אליה נבדקת לפני החיבור
 *         (lookup משלנו — החיבור יוצא בדיוק לכתובת שנבדקה, בלי "החלפה" בין
 *         הבדיקה לחיבור). כתובות פנימיות (127.x, 10.x, 192.168.x, 169.254.x
 *         — שרת המטא-דאטה של ענן — IPv6 מקומי וכו') חסומות, גם אחרי הפניה.
 *       • הפניות (redirect) — עד 4, וכל אחת נבדקת מחדש.
 *       • עד 10MB, עד 12 שניות לתמונה (וגם עד הזמן שנשאר למנה כולה).
 *   processImportedImage — המרה ל-WEBP (עד 1000px, איכות 82 — כמו בהעלאה
 *       מהדפדפן) עם sharp. בלי sharp — בדיקת סוג הקובץ לפי התוכן ושמירת
 *       המקור. SVG / HTML / קבצים שאינם תמונה — נדחים.
 *   saveImportedImage — הורדה + עיבוד + העלאה ל-Storage של החנות:
 *       product-images/<tenant>/products/import-<hash>.webp. השם לפי תוכן
 *       התמונה — אותה תמונה (גם בייבוא חוזר) נשמרת פעם אחת.
 *
 * כל כישלון — ImageImportError עם הודעה בעברית, שמוצגת למנהל באזהרות
 * הייבוא. תמונה שנכשלה מדולגת; המוצר עצמו נוצר.
 *
 * לבדיקות בלבד: IMPORT_IMAGE_ALLOW_HOSTS="127.0.0.1,localhost" — דומיינים
 * שמותר להוריד מהם גם בכתובת פנימית. בשרת האמיתי — לא מגדירים.
 */

import { createHash } from "node:crypto";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type SharpModule from "sharp";
import { supabaseAdminUnscoped } from "@/integrations/supabase/client.server";

/** עד כמה בייטים לתמונה אחת (לפני עיבוד) */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** עד כמה זמן להורדת תמונה אחת (כולל הפניות) */
export const IMAGE_FETCH_TIMEOUT_MS = 12_000;
/** עד כמה הפניות (301 / 302 / ...) */
export const IMAGE_MAX_REDIRECTS = 4;
/** הגודל המרבי אחרי עיבוד (כמו בהעלאה מהדפדפן) */
export const IMAGE_MAX_DIMENSION = 1000;
/** איכות ה-WEBP */
export const IMAGE_WEBP_QUALITY = 82;
/** תמונה ענקית (פצצת פיקסלים) — לא מעבדים */
const IMAGE_MAX_PIXELS = 50_000_000;
/** פורטים מותרים (חוץ מברירת המחדל של http / https) */
const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);
const PRODUCT_IMAGES_BUCKET = "product-images";

/** שגיאה בתמונה אחת — ההודעה מוצגת למנהל כמו שהיא */
export class ImageImportError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ImageImportError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* הגנת SSRF — אילו כתובות IP חסומות                                   */
/* ------------------------------------------------------------------ */

const blockList = new net.BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], // "הרשת הזו"
  ["10.0.0.0", 8], // רשת פרטית
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // השרת עצמו
  ["169.254.0.0", 16], // link-local (כולל שרת המטא-דאטה של הענן)
  ["172.16.0.0", 12], // רשת פרטית (כולל רשת ה-Docker)
  ["192.0.0.0", 24], // IETF
  ["192.0.2.0", 24], // תיעוד
  ["192.88.99.0", 24], // 6to4 relay
  ["192.168.0.0", 16], // רשת פרטית
  ["198.18.0.0", 15], // בדיקות ביצועים
  ["198.51.100.0", 24], // תיעוד
  ["203.0.113.0", 24], // תיעוד
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // שמור (כולל 255.255.255.255)
] as const) {
  blockList.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 96], // לא מוגדר / ::1 / IPv4-compatible
  ["100::", 64], // discard
  ["2001::", 32], // Teredo
  ["2001:db8::", 32], // תיעוד
  ["fc00::", 7], // רשת פרטית (ULA)
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (ישן)
  ["ff00::", 8], // multicast
] as const) {
  blockList.addSubnet(network, prefix, "ipv6");
}

/** IPv6 → 8 מספרים של 16 ביט (כולל סיומת IPv4 כמו ::ffff:1.2.3.4). לא תקין → null */
function expandIPv6(address: string): number[] | null {
  let text = address.toLowerCase();
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (v4) {
    const parts = v4.slice(1).map(Number);
    if (parts.some((part) => part > 255)) return null;
    const high = ((parts[0]! << 8) | parts[1]!).toString(16);
    const low = ((parts[2]! << 8) | parts[3]!).toString(16);
    text = `${text.slice(0, v4.index)}${high}:${low}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) =>
    part === ""
      ? []
      : part.split(":").map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN));
  const head = parse(halves[0] ?? "");
  const rest = halves.length === 2 ? parse(halves[1] ?? "") : [];
  if ([...head, ...rest].some((value) => Number.isNaN(value))) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - rest.length;
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...rest];
}

/** IPv4 שמוטמע בתוך IPv6 (mapped / NAT64 / 6to4) — כדי לבדוק אותו כ-IPv4 */
function embeddedIPv4(groups: number[]): string | null {
  const toV4 = (high: number, low: number) => `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  const zeros = (from: number, to: number) => groups.slice(from, to).every((group) => group === 0);
  // ::ffff:a.b.c.d
  if (zeros(0, 5) && groups[5] === 0xffff) return toV4(groups[6]!, groups[7]!);
  // 64:ff9b::a.b.c.d (NAT64)
  if (groups[0] === 0x64 && groups[1] === 0xff9b && zeros(2, 6))
    return toV4(groups[6]!, groups[7]!);
  // 2002:AABB:CCDD::/48 (6to4)
  if (groups[0] === 0x2002) return toV4(groups[1]!, groups[2]!);
  return null;
}

/**
 * האם אסור להתחבר לכתובת הזו (רשת פנימית / שמורה). כתובת שאינה IP — חסומה.
 * "[::1]", "fe80::1%eth0" — נתמכים.
 */
export function isBlockedAddress(address: string): boolean {
  const ip = address
    .trim()
    .replace(/^\[|\]$/g, "")
    .replace(/%.*$/, "");
  if (net.isIPv4(ip)) return blockList.check(ip, "ipv4");
  if (!net.isIPv6(ip)) return true;
  const groups = expandIPv6(ip);
  if (!groups) return true;
  const v4 = embeddedIPv4(groups);
  if (v4 !== null && blockList.check(v4, "ipv4")) return true;
  return blockList.check(ip, "ipv6");
}

/** דומיינים שמותר להוריד מהם גם בכתובת פנימית — לבדיקות בלבד */
function allowedPrivateHosts(): Set<string> {
  const raw = process.env["IMPORT_IMAGE_ALLOW_HOSTS"] ?? "";
  return new Set(
    raw
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
}

function blockedAddressError(): ImageImportError {
  return new ImageImportError(
    "blocked_address",
    "הקישור מפנה לכתובת פנימית ברשת — מטעמי אבטחה לא מורידים ממנה",
  );
}

/**
 * תרגום הדומיין לכתובות IP — וחסימה אם אחת מהן פנימית. החיבור יוצא רק
 * לכתובות שבדקנו כאן (Node מעביר אותן ישר ל-connect).
 */
export const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, "", 4);
      return;
    }
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0) {
      const empty = Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
        code: "ENOTFOUND",
      });
      callback(empty, "", 4);
      return;
    }
    const allowed = allowedPrivateHosts().has(hostname.toLowerCase());
    if (!allowed && list.some((entry) => isBlockedAddress(entry.address))) {
      callback(blockedAddressError(), "", 4);
      return;
    }
    if (options.all) {
      callback(null, list);
    } else {
      callback(null, list[0]!.address, list[0]!.family);
    }
  });
};

/**
 * בדיקת הקישור לפני החיבור: פרוטוקול, פורט, שם משתמש, כתובת IP ישירה.
 * מחזיר URL מנורמל (WHATWG — "http://2130706433" כבר הופך ל-127.0.0.1).
 */
export function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImageImportError("invalid_url", "קישור לא תקין");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ImageImportError("invalid_url", "רק קישורי http / https נתמכים");
  }
  if (url.username || url.password) {
    throw new ImageImportError("invalid_url", "קישור עם שם משתמש / סיסמה לא נתמך");
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const allowed = allowedPrivateHosts().has(host);
  if (net.isIP(host) !== 0) {
    if (!allowed && isBlockedAddress(host)) throw blockedAddressError();
  } else if (
    !allowed &&
    (host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      !host.includes("."))
  ) {
    throw blockedAddressError();
  }
  if (!allowed && !ALLOWED_PORTS.has(url.port)) {
    throw new ImageImportError("invalid_url", `פורט ${url.port} לא נתמך בקישורי תמונות`);
  }
  return url;
}

/* ------------------------------------------------------------------ */
/* הורדה                                                               */
/* ------------------------------------------------------------------ */

const TLS_ERROR_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_REVOKED",
  "CERT_UNTRUSTED",
  "CERT_REJECTED",
  "CERT_SIGNATURE_FAILURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_DECRYPT_CERT_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "HOSTNAME_MISMATCH",
]);

/** HTTP status → הודעה למנהל */
function httpStatusError(status: number): ImageImportError {
  if (status === 404 || status === 410) {
    return new ImageImportError("http_404", `התמונה לא נמצאה בכתובת (${status})`);
  }
  if (status === 401 || status === 403) {
    return new ImageImportError("http_403", `האתר המקורי חוסם הורדה של התמונה (${status})`);
  }
  if (status === 429) {
    return new ImageImportError("http_429", "האתר המקורי מגביל הורדות (429) — נסו שוב מאוחר יותר");
  }
  if (status >= 500) {
    return new ImageImportError("http_5xx", `תקלה באתר המקורי (${status})`);
  }
  return new ImageImportError("http_error", `האתר המקורי החזיר שגיאה (${status})`);
}

/** כל שגיאה (רשת / TLS / HTTP / עיבוד) → הודעה קצרה בעברית */
export function describeImageError(error: unknown): string {
  if (error instanceof ImageImportError) return error.message;
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (TLS_ERROR_CODES.has(code) || /certificate|cert_/i.test(message)) {
    return "תעודת האבטחה (HTTPS) של האתר המקורי לא תקינה — התמונה לא הורדה";
  }
  if (code === "EPROTO" || code.startsWith("ERR_SSL") || /ssl|tls/i.test(message)) {
    return "שגיאת HTTPS בחיבור לאתר המקורי — התמונה לא הורדה";
  }
  if (
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "EAI_NODATA" ||
    code === "EAI_NONAME"
  ) {
    return "האתר של התמונה לא נמצא (הדומיין לא קיים או לא זמין)";
  }
  if (code === "ECONNREFUSED") return "האתר של התמונה לא זמין (החיבור נדחה)";
  if (code === "ECONNRESET" || code === "EPIPE" || /socket hang up/i.test(message)) {
    return "החיבור לאתר של התמונה נותק באמצע";
  }
  if (
    code === "ETIMEDOUT" ||
    code === "ESOCKETTIMEDOUT" ||
    code === "ENETUNREACH" ||
    code === "EHOSTUNREACH"
  ) {
    return "האתר של התמונה לא הגיב";
  }
  return "הורדת התמונה נכשלה";
}

type FetchedImage = { bytes: Buffer; contentType: string; finalUrl: string };

type Hop = { redirect: string } | FetchedImage;

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Nuri1-ImageImport/1.0",
  Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5",
  "Accept-Encoding": "identity",
};

/** בקשה אחת (בלי לעקוב אחרי הפניה) */
function requestOnce(url: URL, timeoutMs: number): Promise<Hop> {
  return new Promise<Hop>((resolve, reject) => {
    let settled = false;
    const finish = (error: unknown, value?: Hop) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value!);
    };
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      url,
      {
        method: "GET",
        headers: REQUEST_HEADERS,
        lookup: safeLookup,
        agent: false,
        timeout: timeoutMs,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          finish(null, { redirect: response.headers.location });
          request.destroy();
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          finish(httpStatusError(status));
          request.destroy();
          return;
        }
        const contentType = String(response.headers["content-type"] ?? "")
          .split(";")[0]!
          .trim()
          .toLowerCase();
        if (contentType.includes("svg")) {
          finish(svgError());
          request.destroy();
          return;
        }
        if (contentType === "text/html" || contentType === "application/xhtml+xml") {
          finish(notImageError());
          request.destroy();
          return;
        }
        const declared = Number(response.headers["content-length"] ?? 0);
        if (declared > IMAGE_MAX_BYTES) {
          finish(tooLargeError());
          request.destroy();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > IMAGE_MAX_BYTES) {
            finish(tooLargeError());
            request.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          if (size === 0) finish(new ImageImportError("empty", "הקובץ בכתובת ריק"));
          else
            finish(null, { bytes: Buffer.concat(chunks), contentType, finalUrl: url.toString() });
        });
        response.on("aborted", () =>
          finish(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })),
        );
        response.on("error", (error) => finish(error));
      },
    );
    const timer = setTimeout(() => {
      finish(timeoutError());
      request.destroy();
    }, timeoutMs);
    request.on("timeout", () => {
      finish(timeoutError());
      request.destroy();
    });
    request.on("error", (error) => finish(error));
    request.end();
  });
}

function timeoutError(): ImageImportError {
  return new ImageImportError("timeout", "האתר של התמונה לא הגיב בזמן");
}

function tooLargeError(): ImageImportError {
  return new ImageImportError("too_large", "התמונה גדולה מדי (מעל 10MB)");
}

function notImageError(): ImageImportError {
  return new ImageImportError("not_image", "הקישור לא מוביל לקובץ תמונה");
}

function svgError(): ImageImportError {
  return new ImageImportError("svg", "תמונות SVG לא נתמכות — השתמשו ב-JPG / PNG / WEBP");
}

/**
 * הורדת תמונה אחת — עם הגנת SSRF, הפניות, מגבלת זמן וגודל.
 * deadline — זמן (Date.now()) שאחריו לא מתחילים / מפסיקים (מגבלת המנה).
 */
export async function fetchRemoteImage(
  rawUrl: string,
  options: { deadline?: number } = {},
): Promise<FetchedImage> {
  const started = Date.now();
  const stopAt = Math.min(started + IMAGE_FETCH_TIMEOUT_MS, options.deadline ?? Infinity);
  let url = assertFetchableUrl(rawUrl);
  for (let hop = 0; ; hop++) {
    const remaining = stopAt - Date.now();
    if (remaining <= 0) throw timeoutError();
    const result = await requestOnce(url, remaining);
    if (!("redirect" in result)) return result;
    if (hop >= IMAGE_MAX_REDIRECTS) {
      throw new ImageImportError("redirects", "יותר מדי הפניות (redirect) בקישור התמונה");
    }
    let next: string;
    try {
      next = new URL(result.redirect, url).toString();
    } catch {
      throw new ImageImportError("invalid_url", "הפניה לקישור לא תקין");
    }
    url = assertFetchableUrl(next);
  }
}

/* ------------------------------------------------------------------ */
/* עיבוד                                                               */
/* ------------------------------------------------------------------ */

export type SniffedType =
  "jpeg" | "png" | "gif" | "webp" | "avif" | "heif" | "tiff" | "svg" | "html";

/** סוג הקובץ לפי הבייטים הראשונים (לא סומכים על Content-Type) */
export function sniffImageType(bytes: Uint8Array): SniffedType | null {
  const at = (index: number) => bytes[index] ?? -1;
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...Array.from(bytes.subarray(from, to)));
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpeg";
  if (at(0) === 0x89 && ascii(1, 4) === "PNG") return "png";
  if (ascii(0, 4) === "GIF8") return "gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (brand === "avif" || brand === "avis") return "avif";
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "heif";
  }
  if (
    (at(0) === 0x49 && at(1) === 0x49 && at(2) === 0x2a) ||
    (at(0) === 0x4d && at(1) === 0x4d && at(3) === 0x2a)
  ) {
    return "tiff";
  }
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, 512))
    .replace(/^\uFEFF/, "")
    .trimStart()
    .toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "svg";
  if (head.startsWith("<")) return "html";
  return null;
}

type SharpFactory = typeof SharpModule;

let sharpLoader: Promise<SharpFactory | null> | null = null;

/** sharp (ספרייה נייטיב) — אם לא נטענת בשרת, עובדים בלי המרה */
function loadSharp(): Promise<SharpFactory | null> {
  sharpLoader ??= import("sharp")
    .then(
      (module) =>
        ((module as unknown as { default?: SharpFactory }).default ?? module) as SharpFactory,
    )
    .catch((error: unknown) => {
      console.warn(
        "[image-import] sharp unavailable — storing original images",
        error instanceof Error ? error.message : error,
      );
      return null;
    });
  return sharpLoader;
}

export type ProcessedImage = { bytes: Buffer; contentType: string; extension: string };

const PASSTHROUGH: Partial<Record<SniffedType, { contentType: string; extension: string }>> = {
  jpeg: { contentType: "image/jpeg", extension: "jpg" },
  png: { contentType: "image/png", extension: "png" },
  gif: { contentType: "image/gif", extension: "gif" },
  webp: { contentType: "image/webp", extension: "webp" },
  avif: { contentType: "image/avif", extension: "avif" },
};

const SHARP_FORMATS = new Set(["jpeg", "png", "gif", "webp", "avif", "heif", "tiff"]);

/** הקובץ שהורד → WEBP קטן (או המקור, אם אין sharp) */
export async function processImportedImage(bytes: Buffer): Promise<ProcessedImage> {
  const kind = sniffImageType(bytes);
  if (kind === "svg") throw svgError();
  if (kind === "html") throw notImageError();
  const sharp = await loadSharp();
  if (!sharp) {
    const passthrough = kind ? PASSTHROUGH[kind] : undefined;
    if (!passthrough) {
      throw new ImageImportError("unsupported", "פורמט התמונה לא נתמך — השתמשו ב-JPG / PNG / WEBP");
    }
    return { bytes, ...passthrough };
  }
  try {
    const image = sharp(bytes, {
      limitInputPixels: IMAGE_MAX_PIXELS,
      failOn: "error",
      animated: false,
    });
    const meta = await image.metadata();
    if (!meta.format || !SHARP_FORMATS.has(meta.format)) {
      throw new ImageImportError("unsupported", "פורמט התמונה לא נתמך — השתמשו ב-JPG / PNG / WEBP");
    }
    const output = await image
      .rotate()
      .resize({
        width: IMAGE_MAX_DIMENSION,
        height: IMAGE_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: IMAGE_WEBP_QUALITY })
      .toBuffer();
    return { bytes: output, contentType: "image/webp", extension: "webp" };
  } catch (error) {
    if (error instanceof ImageImportError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (/pixel limit/i.test(message)) {
      throw new ImageImportError("too_many_pixels", "התמונה ענקית מדי לעיבוד (מעל 50 מגה-פיקסל)");
    }
    if (kind === "heif") {
      throw new ImageImportError(
        "unsupported",
        "תמונות HEIC לא נתמכות — השתמשו ב-JPG / PNG / WEBP",
      );
    }
    throw new ImageImportError(
      kind ? "corrupt" : "not_image",
      kind ? "קובץ התמונה פגום או בפורמט לא נתמך" : "הקישור לא מוביל לקובץ תמונה",
    );
  }
}

/**
 * חלק 22: תמונה (לוגו) → data URL שמסמך ה-PDF יודע להטמיע (jsPDF: רק PNG / JPEG).
 * PNG / JPEG — כמו שהם; WEBP / AVIF / GIF וכו' — מומרים ל-PNG עם sharp (שקיפות
 * נשמרת), מוקטנים לכל היותר ל-maxDimension. לא נתמך / פגום → null.
 */
export async function imageToPdfDataUrl(bytes: Buffer, maxDimension = 600): Promise<string | null> {
  const kind = sniffImageType(bytes);
  if (kind === "png" || kind === "jpeg") {
    return `data:image/${kind};base64,${bytes.toString("base64")}`;
  }
  if (!kind || kind === "svg" || kind === "html") return null;
  const sharp = await loadSharp();
  if (!sharp) return null;
  try {
    const png = await sharp(bytes, {
      limitInputPixels: IMAGE_MAX_PIXELS,
      failOn: "error",
      animated: false,
    })
      .resize({
        width: maxDimension,
        height: maxDimension,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* שמירה ב-Storage                                                     */
/* ------------------------------------------------------------------ */

export type SavedImage = {
  /** הקישור הציבורי אצלנו (נשמר במוצר) */
  url: string;
  /** true = התמונה כבר נשמרה קודם (אותו קישור בייבוא קודם / במנה אחרת) */
  reused: boolean;
};

/** קישור מקורי → הקישור אצלנו, לחצי שעה (ייבוא חוזר / אותה תמונה בכמה מוצרים) */
const savedCache = new Map<string, { url: string; at: number }>();
const SAVED_CACHE_TTL_MS = 30 * 60 * 1000;
const SAVED_CACHE_MAX = 5000;

function cacheGet(key: string): string | null {
  const hit = savedCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > SAVED_CACHE_TTL_MS) {
    savedCache.delete(key);
    return null;
  }
  return hit.url;
}

function cacheSet(key: string, url: string): void {
  if (savedCache.size >= SAVED_CACHE_MAX) {
    const oldest = savedCache.keys().next().value;
    if (oldest !== undefined) savedCache.delete(oldest);
  }
  savedCache.set(key, { url, at: Date.now() });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * הורדה + עיבוד + העלאה לתיקיית החנות. מחזיר את הקישור הציבורי אצלנו.
 * הנתיב לפי תוכן התמונה (sha256 של הקובץ המקורי) — אותה תמונה נשמרת פעם
 * אחת, וייבוא חוזר של אותו קובץ לא מכפיל קבצים.
 */
export async function saveImportedImage(
  tenantId: string,
  sourceUrl: string,
  options: { deadline?: number } = {},
): Promise<SavedImage> {
  if (!UUID.test(tenantId)) throw new ImageImportError("tenant", "החנות לא זוהתה");
  const cacheKey = `${tenantId}\n${sourceUrl}`;
  const cached = cacheGet(cacheKey);
  if (cached) return { url: cached, reused: true };

  const fetched = await fetchRemoteImage(sourceUrl, options);
  const processed = await processImportedImage(fetched.bytes);
  const hash = createHash("sha256").update(fetched.bytes).digest("hex").slice(0, 32);
  const path = `${tenantId}/products/import-${hash}.${processed.extension}`;
  const bucket = supabaseAdminUnscoped.storage.from(PRODUCT_IMAGES_BUCKET);
  const { error } = await bucket.upload(path, processed.bytes, {
    contentType: processed.contentType,
    cacheControl: "31536000",
    upsert: true,
  });
  if (error) {
    console.error("[image-import] upload failed", path, error.message);
    throw new ImageImportError("upload", "שמירת התמונה באתר נכשלה — נסו שוב");
  }
  const url = bucket.getPublicUrl(path).data.publicUrl;
  cacheSet(cacheKey, url);
  return { url, reused: false };
}

/**
 * הרצה מקבילית מוגבלת: עד `limit` משימות בו-זמנית, והתוצאה של כל אחת
 * (הצליחה / נכשלה) — כמו Promise.allSettled, באותו סדר. משימה שנכשלה לא
 * עוצרת את האחרות.
 */
export async function settledPool<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      const [outcome] = await Promise.allSettled([task(items[index]!, index)]);
      results[index] = outcome!;
    }
  };
  await Promise.allSettled(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker()),
  );
  return results;
}
