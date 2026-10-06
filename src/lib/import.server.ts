/**
 * ייבוא מוצר מקישור (חלק 29) — חילוץ פרטי המוצר מה-HTML של עמוד מוצר:
 * כותרת, תיאור, מפרט, תמונות ומחיר. טהור (בלי רשת), ונבדק בלי שרת:
 * scripts/import-check.ts · scripts/url-import-check.ts.
 *
 * תמונות — לפי הסדר: הגלריה המובנית (AliExpress: imagePathList, JSON-LD של
 * המוצר, תמונות הצבעים skuPropertyImagePath), og:image, ואז סריקה כללית של
 * <img> (עד 24, בלי אייקונים / לוגו / פיקסלים). תמונה מוקטנת של AliExpress
 * (A.jpg_220x220.jpg, A.jpg_.webp) מוחלפת במקור — ונספרת פעם אחת.
 */

import type { ScrapedProduct, ScrapedSpec } from "@/lib/url-import";

const MAX_IMAGES = 60;
const MAX_GENERIC_IMAGES = 24;
const MAX_SPECS = 40;
const TITLE_MAX = 200;
const DESCRIPTION_MAX = 3000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  times: "×",
  deg: "°",
  reg: "®",
  trade: "™",
  copy: "©",
  shy: "",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, code: string) => {
    if (code.startsWith("#")) {
      const n = /^#x/i.test(code) ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isInteger(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** טקסט נקי: בלי תגיות וסקריפטים, ישויות מפוענחות, רווחים מצומצמים */
function cleanText(raw: unknown, max: number, multiline = false): string {
  if (typeof raw !== "string") return "";
  const text = decodeEntities(
    raw
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  );
  const tidy = multiline
    ? text
        .replace(/[^\S\n]+/g, " ")
        .replace(/\s*\n\s*/g, "\n")
        .replace(/\n{2,}/g, "\n")
    : text.replace(/\s+/g, " ");
  return tidy.trim().slice(0, max).trim();
}

const JSON_STRING = /"((?:\\.|[^"\\])*)"/g;

/** ערך מחרוזת JSON (עם escapes) → טקסט */
function jsonString(inner: string): string {
  try {
    return JSON.parse(`"${inner}"`) as string;
  } catch {
    return inner.replace(/\\\//g, "/");
  }
}

function tagAttributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of tag.matchAll(
    /([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g,
  )) {
    const key = match[1]!.toLowerCase();
    if (!(key in out)) out[key] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return out;
}

/** כל תגיות <meta> — property / name / itemprop → הערכים (לפי הסדר) */
function metaMap(html: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = tagAttributes(match[0]);
    const key = (
      attributes["property"] ??
      attributes["name"] ??
      attributes["itemprop"] ??
      ""
    ).toLowerCase();
    const content = attributes["content"];
    if (key === "" || content === undefined) continue;
    const list = map.get(key) ?? [];
    list.push(content);
    map.set(key, list);
  }
  return map;
}

type JsonObject = Record<string, unknown>;

/** כל האובייקטים בבלוקי JSON-LD (כולל @graph ו-offers) */
function jsonLdNodes(html: string): JsonObject[] {
  const nodes: JsonObject[] = [];
  const walk = (value: unknown, depth: number): void => {
    if (depth > 6 || value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    const node = value as JsonObject;
    nodes.push(node);
    for (const key of ["@graph", "mainEntity", "itemListElement", "hasVariant", "item"]) {
      if (key in node) walk(node[key], depth + 1);
    }
  };
  for (const match of html.matchAll(
    /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      walk(JSON.parse(match[1]!.trim()), 0);
    } catch {
      // JSON-LD שבור — מדלגים
    }
  }
  return nodes;
}

function isProductNode(node: JsonObject): boolean {
  const type = node["@type"];
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => t === "Product" || t === "ProductGroup" || t === "IndividualProduct");
}

function ldImages(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(ldImages);
  if (value !== null && typeof value === "object") {
    const node = value as JsonObject;
    return ldImages(node["url"] ?? node["contentUrl"] ?? null);
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* תמונות                                                              */
/* ------------------------------------------------------------------ */

/** סיומות הקטנה / המרה של AliExpress: A.jpg_220x220.jpg · A.jpg_.webp · A.png_960x960q75.png_.avif */
const ALI_SUFFIX =
  /(\.(?:jpe?g|png|webp|gif|avif))(?:_(?:\d+x\d+(?:q\d+)?|Q\d+)(?:\.(?:jpe?g|png|webp|gif|avif))?)?(?:_\.(?:webp|avif|jpe?g|png))?$/i;

/** אייקונים, לוגו, פיקסלי מעקב — רק בסריקה הכללית של <img> */
const JUNK_IMAGE =
  /(?:^|[/_.-])(?:icons?|logos?|sprites?|avatars?|placeholders?|blank|spacer|pixel|loading|loader|spinner|flags?|badges?|rating|stars?|qr(?:code)?|payments?|visa|mastercard|paypal|banners?)(?=[/_.\-\d]|$)/i;
const TRACKERS = /facebook\.com\/tr|google-analytics|googletagmanager|doubleclick|bat\.bing\.com/i;

/** קישור תמונה מוחלט ונקי (null = לא תמונה שאפשר להוריד) */
export function normalizeImageUrl(raw: string, base?: string): string | null {
  let value = decodeEntities(raw).trim();
  if (value === "" || /^(?:data|blob|javascript|about):/i.test(value)) return null;
  if (value.startsWith("//")) value = `https:${value}`;
  let url: URL;
  try {
    url = base ? new URL(value, base) : new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (/(?:^|\.)alicdn\.com$|aliexpress/i.test(url.hostname)) {
    url.pathname = url.pathname.replace(ALI_SUFFIX, "$1");
  }
  if (/\.svg$/i.test(url.pathname)) return null;
  url.hash = "";
  return url.toString();
}

function bestFromSrcset(srcset: string | undefined): string | undefined {
  if (!srcset) return undefined;
  let best: { url: string; size: number } | undefined;
  for (const part of srcset.split(",")) {
    const [url, descriptor] = part.trim().split(/\s+/);
    if (!url) continue;
    const size = Number.parseFloat(descriptor ?? "1") || 1;
    if (!best || size > best.size) best = { url, size };
  }
  return best?.url;
}

/** כל תמונות המוצר בעמוד — הגלריה קודם, בלי כפילויות */
export function extractImages(html: string, baseUrl?: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | undefined): boolean => {
    if (!raw || result.length >= MAX_IMAGES) return false;
    const url = normalizeImageUrl(raw, baseUrl);
    if (!url || seen.has(url)) return false;
    seen.add(url);
    result.push(url);
    return true;
  };

  // 1. הגלריה של AliExpress (מערכי JSON בסקריפטים של העמוד)
  for (const match of html.matchAll(/"(?:imagePathList|summImagePathList)"\s*:\s*\[([^\]]*)\]/g)) {
    for (const item of match[1]!.matchAll(JSON_STRING)) add(jsonString(item[1]!));
  }
  // 2. JSON-LD של המוצר (Shopify, WooCommerce ועוד)
  for (const node of jsonLdNodes(html)) {
    if (isProductNode(node)) for (const image of ldImages(node["image"])) add(image);
  }
  // 3. תמונות הצבעים / הדגמים
  for (const match of html.matchAll(/"skuPropertyImagePath"\s*:\s*"((?:\\.|[^"\\])*)"/g)) {
    add(jsonString(match[1]!));
  }
  // 4. התמונה לשיתוף
  const meta = metaMap(html);
  for (const key of [
    "og:image",
    "og:image:secure_url",
    "og:image:url",
    "twitter:image",
    "twitter:image:src",
    "image",
  ]) {
    for (const value of meta.get(key) ?? []) add(value);
  }
  // 5. סריקה כללית של <img> — עד 24
  let generic = 0;
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    if (generic >= MAX_GENERIC_IMAGES || result.length >= MAX_IMAGES) break;
    const attributes = tagAttributes(match[0]);
    const width = Number.parseInt(attributes["width"] ?? "", 10);
    const height = Number.parseInt(attributes["height"] ?? "", 10);
    if ((width > 0 && width < 100) || (height > 0 && height < 100)) continue;
    const source = [
      attributes["data-src"],
      attributes["data-lazy-src"],
      attributes["data-original"],
      attributes["data-zoom-image"],
      attributes["data-large_image"],
      bestFromSrcset(attributes["data-srcset"]),
      bestFromSrcset(attributes["srcset"]),
      attributes["src"],
    ].find((value) => value !== undefined && value.trim() !== "" && !/^data:/i.test(value));
    if (!source || JUNK_IMAGE.test(source) || TRACKERS.test(source)) continue;
    if (add(source)) generic += 1;
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* כותרת                                                               */
/* ------------------------------------------------------------------ */

/** " | AliExpress", " - Amazon.com" וכו' בסוף הכותרת */
const SITE_SUFFIX =
  /\s*[|\-–—:]\s*(?:aliexpress|amazon|ebay|temu|shein|etsy|walmart|wish|banggood|alibaba)\b[^|]*$/i;

const TITLE_NOISE = [
  /\bfree\s+shipping\b/gi,
  /\bhot\s+sal(?:e|es|ing)\b/gi,
  /\bwholesale\b/gi,
  /\bdrop\s*shipping\b/gi,
  /\bdropship\b/gi,
  /\bnew\s+arrivals?\b/gi,
  /\bbest\s+sell(?:er|ers|ing)\b/gi,
  /\bhigh\s+quality\b/gi,
  /\bfast\s+(?:shipping|delivery)\b/gi,
  /\bin\s+stock\b/gi,
  /\bbrand\s+new\b/gi,
  /\bfactory\s+(?:price|direct)\b/gi,
  /\b(?:big\s+)?(?:promotion|discount|clearance)\b/gi,
  /\baliexpress\b/gi,
  /\b(?:19|20)\d{2}\b/g,
];

const TAIL_STOPWORDS = new Set([
  "for",
  "with",
  "and",
  "or",
  "of",
  "the",
  "to",
  "in",
  "on",
  "a",
  "an",
  "by",
  "from",
  "&",
  "+",
  "-",
  "של",
  "עם",
  "או",
]);

function dropTail(words: string[]): string[] {
  const out = [...words];
  while (out.length > 1 && TAIL_STOPWORDS.has(out.at(-1)!.toLowerCase())) out.pop();
  return out;
}

/** הכותרת המלאה: בלי תגיות / סיומת האתר, עד 200 תווים */
export function cleanTitle(raw: string): string {
  return cleanText(raw, TITLE_MAX * 2)
    .replace(SITE_SUFFIX, "")
    .trim()
    .slice(0, TITLE_MAX)
    .trim();
}

/**
 * הצעה קצרה לשם המוצר: בלי סיומת האתר ובלי רעשי שיווק (Free Shipping,
 * Hot Sale, שנה...), חיתוך במפריד הראשון (פסיק / | / סוגריים), עד 8 מילים
 * ו-60 תווים, בלי מילת קישור בסוף ("For", "with").
 */
export function shortenTitle(raw: string): string {
  const original = cleanText(raw, TITLE_MAX * 2);
  let title = original.replace(SITE_SUFFIX, " ");
  for (const pattern of TITLE_NOISE) title = title.replace(pattern, " ");
  title = title
    .replace(/\s+/g, " ")
    .replace(/^\s*new\b\s*/i, "")
    .replace(/^[\s,|\-–—:]+|[\s,|\-–—:]+$/g, "")
    .trim();
  const separator = title.search(/\s*[,|([–—]\s*|\s+-\s+/);
  if (separator > 0) {
    const head = title.slice(0, separator).trim();
    if (head.split(/\s+/).length >= 2) title = head;
  }
  let short = dropTail(title.split(/\s+/).filter(Boolean).slice(0, 8)).join(" ");
  if (short.length > 60) {
    short = short.slice(0, 60);
    const cut = short.lastIndexOf(" ");
    if (cut > 20) short = short.slice(0, cut);
    short = dropTail(short.split(" ")).join(" ");
  }
  short = short.replace(/[\s,|\-–—:]+$/, "").trim();
  return short !== "" ? short : original.slice(0, 60).trim();
}

/* ------------------------------------------------------------------ */
/* מפרט, תיאור ומחיר                                                    */
/* ------------------------------------------------------------------ */

function extractSpecs(html: string, product: JsonObject | null): ScrapedSpec[] {
  const specs: ScrapedSpec[] = [];
  const seen = new Set<string>();
  const add = (rawName: unknown, rawValue: unknown): void => {
    if (specs.length >= MAX_SPECS) return;
    const name = cleanText(
      typeof rawName === "string" ? rawName : String(rawName ?? ""),
      80,
    ).replace(/\s*[:：]\s*$/, "");
    const value = cleanText(typeof rawValue === "string" ? rawValue : String(rawValue ?? ""), 300);
    if (name === "" || value === "") return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    specs.push({ name, value });
  };

  // AliExpress: specsModule.props = [{ attrName, attrValue }]
  for (const match of html.matchAll(/\{[^{}]*"attrName"\s*:[^{}]*\}/g)) {
    const name = /"attrName"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(match[0])?.[1];
    const value = /"attrValue"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(match[0])?.[1];
    if (name !== undefined && value !== undefined) add(jsonString(name), jsonString(value));
  }
  // JSON-LD: additionalProperty = [{ name, value }]
  const extra = product?.["additionalProperty"];
  for (const item of Array.isArray(extra) ? extra : []) {
    if (item !== null && typeof item === "object") {
      const property = item as JsonObject;
      add(property["name"], property["value"]);
    }
  }
  if (specs.length > 0) return specs;

  // טבלת מפרט: שורות של שני תאים (שם | ערך)
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1]!.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(
      (cell) => cell[1]!,
    );
    if (cells.length === 2 && cleanText(cells[0], 81).length <= 60) add(cells[0], cells[1]);
  }
  // רשימת הגדרות: <dt>שם</dt><dd>ערך</dd>
  for (const match of html.matchAll(
    /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi,
  )) {
    add(match[1], match[2]);
  }
  return specs;
}

/** משפטי שיווק כלליים של האתר (לא תיאור של המוצר) */
const BOILERPLATE =
  /smarter shopping|better living|directly from china suppliers|aliexpress\.com|enjoy\s*✓?\s*free shipping|shop with confidence/i;

function parsePrice(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;
  let text = value.replace(/[^\d.,]/g, "");
  if (text.includes(",") && text.includes(".")) text = text.replace(/,/g, "");
  else if (/,\d{1,2}$/.test(text)) text = text.replace(",", ".");
  else text = text.replace(/,/g, "");
  const n = Number.parseFloat(text);
  return Number.isFinite(n) && n > 0 && n < 10_000_000 ? Math.round(n * 100) / 100 : null;
}

function offerOf(product: JsonObject | null): JsonObject | null {
  const offers = product?.["offers"];
  const list = Array.isArray(offers) ? offers : offers ? [offers] : [];
  for (const item of list) {
    if (item !== null && typeof item === "object") return item as JsonObject;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* הכל יחד                                                             */
/* ------------------------------------------------------------------ */

export function parseProductPage(html: string, pageUrl: string): ScrapedProduct {
  const meta = metaMap(html);
  const firstMeta = (...keys: string[]): string => {
    for (const key of keys) {
      const value = meta.get(key)?.find((item) => item.trim() !== "");
      if (value) return value;
    }
    return "";
  };
  const product = jsonLdNodes(html).find(isProductNode) ?? null;
  let host = "";
  try {
    host = new URL(pageUrl).hostname.replace(/^www\./i, "");
  } catch {
    host = "";
  }
  const aliexpress = /aliexpress/i.test(host) || /"imagePathList"/.test(html);
  const jsonValue = (pattern: RegExp): string => {
    const match = pattern.exec(html);
    return match ? jsonString(match[1]!) : "";
  };

  const rawTitle =
    jsonValue(/"titleModule"\s*:\s*\{[^{}]*?"subject"\s*:\s*"((?:\\.|[^"\\])*)"/) ||
    (aliexpress ? jsonValue(/"subject"\s*:\s*"((?:\\.|[^"\\])*)"/) : "") ||
    (typeof product?.["name"] === "string" ? product["name"] : "") ||
    firstMeta("og:title", "twitter:title") ||
    (/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ?? "") ||
    (/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const title = cleanTitle(rawTitle);

  const description =
    [
      typeof product?.["description"] === "string" ? product["description"] : "",
      firstMeta("og:description", "description", "twitter:description"),
    ]
      .map((candidate) => cleanText(candidate, DESCRIPTION_MAX, true))
      .find(
        (candidate) =>
          candidate.length >= 15 &&
          !BOILERPLATE.test(candidate) &&
          candidate.toLowerCase() !== title.toLowerCase(),
      ) ?? "";

  const offer = offerOf(product);
  const price =
    parsePrice(offer?.["price"]) ??
    parsePrice(offer?.["lowPrice"]) ??
    parsePrice(firstMeta("product:price:amount", "og:price:amount"));
  const currencyRaw =
    (typeof offer?.["priceCurrency"] === "string" ? offer["priceCurrency"] : "") ||
    firstMeta("product:price:currency", "og:price:currency");
  const currency = /^[A-Za-z]{3}$/.test(currencyRaw.trim())
    ? currencyRaw.trim().toUpperCase()
    : null;

  return {
    title,
    shortTitle: title ? shortenTitle(title) : "",
    description,
    specs: extractSpecs(html, product),
    images: extractImages(html, pageUrl),
    price,
    currency: price === null ? null : currency,
    siteName: cleanText(firstMeta("og:site_name"), 80) || host || null,
  };
}
