/**
 * הורדת עמוד מוצר (HTML) מאתר חיצוני — לייבוא מוצר מקישור (חלק 29).
 *
 * אותן הגנות כמו בהורדת התמונות (image-fetch.ts): רק http / https, כל כתובת
 * IP נבדקת לפני החיבור (SSRF — כתובות פנימיות חסומות, גם אחרי הפניה), עד 6
 * הפניות, עד 6MB ו-15 שניות. עוגיות שהאתר מציב בהפניה נשלחות בבקשה הבאה
 * לאותו אתר (AliExpress מפנה דרך דומיין של שפה / אזור ומצפה להן).
 * הקידוד לפי Content-Type / <meta charset> (גם windows-1255 של אתרים ישנים).
 */

import http from "node:http";
import https from "node:https";
import { assertFetchableUrl, ImageImportError, safeLookup } from "@/server/services/image-fetch";

export const PAGE_MAX_BYTES = 6 * 1024 * 1024;
export const PAGE_FETCH_TIMEOUT_MS = 15_000;
const PAGE_MAX_REDIRECTS = 6;

const PAGE_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
  "Accept-Language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
  "Accept-Encoding": "identity",
};

export type FetchedPage = { html: string; finalUrl: string };

type PageHop = { redirect: string; setCookies: string[] } | { body: Buffer; contentType: string };

function pageStatusError(status: number): ImageImportError {
  if (status === 404 || status === 410) {
    return new ImageImportError("http_404", `עמוד המוצר לא נמצא (${status}) — בדקו את הקישור`);
  }
  if (status === 401 || status === 403) {
    return new ImageImportError("http_403", `האתר חוסם גישה אוטומטית לעמוד (${status})`);
  }
  if (status === 429) {
    return new ImageImportError("http_429", "האתר מגביל בקשות (429) — נסו שוב בעוד כמה דקות");
  }
  if (status >= 500) {
    return new ImageImportError("http_5xx", `תקלה באתר המקור (${status}) — נסו שוב מאוחר יותר`);
  }
  return new ImageImportError("http_error", `האתר החזיר שגיאה (${status})`);
}

const pageTimeout = () => new ImageImportError("timeout", "האתר לא הגיב בזמן — נסו שוב");
const pageTooLarge = () => new ImageImportError("too_large", "העמוד גדול מדי (מעל 6MB)");

/** "האתר" של כתובת — להחלטה לאן מותר לשלוח את העוגיות (shop.co.il / aliexpress.com) */
function siteOf(host: string): string {
  const labels = host.toLowerCase().split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const second = labels.at(-2)!;
  const tld = labels.at(-1)!;
  const size =
    tld.length === 2 && ["co", "com", "org", "net", "ac", "gov", "edu", "or", "ne"].includes(second)
      ? 3
      : 2;
  return labels.slice(-size).join(".");
}

function requestPage(url: URL, timeoutMs: number, cookie: string): Promise<PageHop> {
  return new Promise<PageHop>((resolve, reject) => {
    let settled = false;
    const finish = (error: unknown, value?: PageHop) => {
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
        headers: cookie ? { ...PAGE_HEADERS, Cookie: cookie } : PAGE_HEADERS,
        lookup: safeLookup,
        agent: false,
        timeout: timeoutMs,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const setCookies = response.headers["set-cookie"] ?? [];
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          finish(null, { redirect: response.headers.location, setCookies });
          request.destroy();
          return;
        }
        if (status < 200 || status >= 300) {
          response.resume();
          finish(pageStatusError(status));
          request.destroy();
          return;
        }
        const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
        if (contentType !== "" && !/html|xml|text\/plain/.test(contentType)) {
          response.resume();
          finish(
            contentType.startsWith("image/")
              ? new ImageImportError(
                  "not_page",
                  "זה קישור לתמונה ולא לעמוד מוצר — העתיקו את הכתובת של עמוד המוצר",
                )
              : new ImageImportError("not_page", "הקישור לא מוביל לעמוד אינטרנט של מוצר"),
          );
          request.destroy();
          return;
        }
        if (Number(response.headers["content-length"] ?? 0) > PAGE_MAX_BYTES) {
          response.resume();
          finish(pageTooLarge());
          request.destroy();
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > PAGE_MAX_BYTES) {
            finish(pageTooLarge());
            request.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => finish(null, { body: Buffer.concat(chunks), contentType }));
        response.on("aborted", () =>
          finish(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })),
        );
        response.on("error", (error) => finish(error));
      },
    );
    const timer = setTimeout(() => {
      finish(pageTimeout());
      request.destroy();
    }, timeoutMs);
    request.on("timeout", () => {
      finish(pageTimeout());
      request.destroy();
    });
    request.on("error", (error) => finish(error));
    request.end();
  });
}

/** הבייטים → טקסט, לפי הקידוד שהאתר הצהיר (ברירת מחדל: UTF-8) */
function decodeHtml(body: Buffer, contentType: string): string {
  const fromHeader = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1];
  const head = body.subarray(0, 4096).toString("latin1");
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1];
  const label = (fromHeader ?? fromMeta ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(label).decode(body);
  } catch {
    return new TextDecoder("utf-8").decode(body);
  }
}

/** הורדת עמוד אחד (עם הפניות) — מחזיר את ה-HTML ואת הכתובת הסופית */
export async function fetchRemotePage(rawUrl: string): Promise<FetchedPage> {
  const stopAt = Date.now() + PAGE_FETCH_TIMEOUT_MS;
  let url = assertFetchableUrl(rawUrl);
  // עוגיות לפי אתר: site → (שם → "שם=ערך")
  const jar = new Map<string, Map<string, string>>();
  for (let hop = 0; ; hop++) {
    const remaining = stopAt - Date.now();
    if (remaining <= 0) throw pageTimeout();
    const cookies = jar.get(siteOf(url.hostname));
    const result = await requestPage(
      url,
      remaining,
      cookies ? [...cookies.values()].join("; ") : "",
    );
    if ("body" in result) {
      return { html: decodeHtml(result.body, result.contentType), finalUrl: url.toString() };
    }
    if (hop >= PAGE_MAX_REDIRECTS) {
      throw new ImageImportError("redirects", "יותר מדי הפניות (redirect) בקישור");
    }
    if (result.setCookies.length > 0) {
      const site = siteOf(url.hostname);
      const bucket = jar.get(site) ?? new Map<string, string>();
      for (const header of result.setCookies) {
        const pair = header.split(";")[0]!.trim();
        const eq = pair.indexOf("=");
        if (eq > 0) bucket.set(pair.slice(0, eq), pair);
      }
      jar.set(site, bucket);
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

/** עמוד חסימה (בדיקת רובוט / התחברות) במקום עמוד המוצר */
const BLOCK_PAGE =
  /_____tmd_____|\/punish\b|x5secdata|baxia-|cf-chl-|challenge-platform|just a moment\.\.\.|robot check|captcha/i;

export function looksBlocked(html: string, finalUrl: string): boolean {
  try {
    if (/^(?:login|passport|signin|accounts?)\./i.test(new URL(finalUrl).hostname)) return true;
  } catch {
    // כתובת לא תקינה — לפי התוכן
  }
  return BLOCK_PAGE.test(html.slice(0, 300_000));
}

/** כל שגיאה בהורדת העמוד → הודעה קצרה בעברית למנהל */
export function describePageError(error: unknown): string {
  if (error instanceof ImageImportError) return error.message;
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/CERT|certificate/i.test(`${code} ${message}`)) {
    return "תעודת האבטחה (HTTPS) של האתר לא תקינה — לא ניתן למשוך את העמוד";
  }
  if (code === "ENOTFOUND" || code.startsWith("EAI_")) return "האתר לא נמצא — בדקו את הקישור";
  if (code === "ECONNREFUSED") return "האתר לא זמין כרגע (החיבור נדחה)";
  if (code === "ECONNRESET" || code === "EPIPE" || /socket hang up/i.test(message)) {
    return "החיבור לאתר נותק באמצע — נסו שוב";
  }
  if (/^E(?:TIMEDOUT|NETUNREACH|HOSTUNREACH)$/.test(code)) return "האתר לא הגיב — נסו שוב";
  return "משיכת העמוד נכשלה — נסו שוב";
}
