/**
 * חלק 44: "סריקת אתר מקור" — קריאת הקטלוג של אתר חיצוני (צד שרת בלבד).
 *
 * מה נסרק, בסדר זה, ורק מה שהאתר חושף בפועל (בלי לעקוף חסימות / התחברות):
 *  1. עמוד מוצר בודד (JSON-LD / מטא).
 *  2. Shopify (products.json הציבורי) ו-WooCommerce (Store API הציבורי) — כשהאתר מזוהה כאחד מהם.
 *  3. עמוד רשימה / קטגוריה / אינדקס (כולל עמודי הזאפ של החנויות שלנו): JSON-LD של רשימה,
 *     או קישורי מוצרים באותו אתר; עמודי קטגוריה נסרקים עד עומק 2 ו-25 עמודים.
 * כל הורדה עוברת fetchRemotePage (SSRF: כתובות פנימיות חסומות גם אחרי הפניה, עד 6MB, 15 שניות).
 * מוצרים נקראים רק מאותו אתר שהוזן (אותו דומיין); לא סורקים קישורים לאתרים אחרים.
 * שום תוכן שמתקבל מהאתר לא מורץ — רק מנותח כטקסט.
 */

import {
  jsonLdNodes,
  isProductNode,
  offerOf,
  parsePrice,
  parseProductPage,
  type JsonObject,
} from "@/lib/import.server";
import {
  SCAN_MAX_LISTING_PAGES,
  SCAN_MAX_PRODUCTS,
  normBarcode,
  type SourceProduct,
} from "@/lib/source-scan";
import { extractUrlFromText } from "@/lib/url";
import { ImageImportError, settledPool } from "@/server/services/image-fetch";
import { describePageError, fetchRemotePage, looksBlocked } from "@/server/services/page-fetch";

const DISCOVERY_DEADLINE_MS = 45_000;
const LISTING_DELAY_MS = 120;
const FETCH_CONCURRENCY = 3;
const DESCRIPTION_MAX = 1500;
const SHOPIFY_PAGE = 100;
const SHOPIFY_PAGES = 3;
const WOO_PAGE = 50;
const WOO_PAGES = 4;

export type SourcePlatform = "shopify" | "woocommerce" | "jsonld" | "links" | "single" | "none";

export type SourceDiscovery = {
  /** האתר שנסרק (https://host) — רק מוצרים מהדומיין הזה נקראים */
  origin: string;
  sourceUrl: string;
  platform: SourcePlatform;
  /** מוצרים שנקראו במלואם כבר בגילוי (Shopify / Woo / JSON-LD) */
  inline: SourceProduct[];
  /** עמודי מוצר שצריך להוריד בנפרד (במנות) */
  productUrls: string[];
  /** שם + מחיר מהרשימה — גיבוי אם עמוד המוצר נכשל */
  hints: Record<string, { name: string; price: number | null }>;
  listingPages: number;
  /** הסריקה לא כיסתה הכל (מגבלות / עמודים שנכשלו) */
  partial: boolean;
  notes: string[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const hostKey = (host: string) => host.toLowerCase().replace(/^www\./, "");

/** הכתובת שהוזנה → URL תקין, או שגיאה בעברית */
export function parseSourceUrl(raw: string): URL {
  const text = extractUrlFromText(String(raw ?? "").slice(0, 3000));
  if (!text) throw new Error("לא נמצא קישור — הדביקו כתובת מלאה של אתר או של עמוד קטלוג");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error("הקישור לא תקין");
  }
  if (url.username || url.password) throw new Error("קישור עם שם משתמש / סיסמה לא נתמך");
  return url;
}

export function sameSite(a: string, b: string): boolean {
  try {
    return hostKey(new URL(a).hostname) === hostKey(new URL(b).hostname);
  } catch {
    return false;
  }
}

function clipText(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const num = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
};

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6])>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function absoluteUrl(href: string, base: string): string | null {
  try {
    const url = new URL(href, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- JSON-LD

const GTIN_KEYS = ["gtin", "gtin13", "gtin12", "gtin14", "gtin8"];

function availabilityOf(offer: JsonObject | null): SourceProduct["availability"] {
  const text = str(offer?.["availability"]).toLowerCase();
  if (!text) return null;
  if (text.includes("instock") || text.includes("limitedavailability")) return "in_stock";
  if (text.includes("outofstock") || text.includes("soldout") || text.includes("discontinued")) {
    return "out_of_stock";
  }
  return null;
}

/** כמות מלאי — רק ממספר מפורש (inventoryLevel) */
function stockOf(product: JsonObject | null, offer: JsonObject | null): number | null {
  for (const holder of [offer, product]) {
    const level = holder?.["inventoryLevel"];
    if (level && typeof level === "object") {
      const value = num((level as JsonObject)["value"]);
      if (value !== null && value >= 0 && Number.isInteger(value)) return value;
    }
    const direct = num(level);
    if (direct !== null && direct >= 0 && Number.isInteger(direct)) return direct;
  }
  return null;
}

/** קטגוריה: product.category, או הפריט שלפני האחרון ב-BreadcrumbList */
function categoryOf(product: JsonObject | null, nodes: JsonObject[]): string | null {
  const own = product?.["category"];
  if (typeof own === "string" && own.trim()) return clipText(own.split(/[>/]/).pop() ?? own, 60);
  for (const node of nodes) {
    const type = node["@type"];
    if (!(type === "BreadcrumbList" || (Array.isArray(type) && type.includes("BreadcrumbList")))) {
      continue;
    }
    const list = node["itemListElement"];
    if (!Array.isArray(list) || list.length < 3) continue;
    const names = list
      .map((entry) => {
        const e = entry as JsonObject;
        return str(e["name"]) || str((e["item"] as JsonObject | undefined)?.["name"]);
      })
      .filter(Boolean);
    const candidate = names.at(-2);
    if (candidate && !/^(דף הבית|בית|home)$/i.test(candidate)) return clipText(candidate, 60);
  }
  return null;
}

function skuOf(product: JsonObject | null): string | null {
  const direct = product?.["sku"];
  if (typeof direct === "string" && direct.trim()) return direct.trim().slice(0, 64);
  if (typeof direct === "number") return String(direct);
  return null;
}

function barcodeOf(product: JsonObject | null): string | null {
  for (const key of GTIN_KEYS) {
    const value = product?.[key];
    const text = typeof value === "number" ? String(value) : str(value);
    if (normBarcode(text)) return normBarcode(text);
  }
  return null;
}

/** עמוד מוצר → מוצר מקור (JSON-LD + המנתח הקיים של ייבוא מקישור) */
export function productFromPage(html: string, pageUrl: string): SourceProduct | null {
  const scraped = parseProductPage(html, pageUrl);
  const nodes = jsonLdNodes(html);
  const product = nodes.find(isProductNode) ?? null;
  if (!scraped.title) return null;
  const offer = offerOf(product);
  // ProductGroup (כמה וריאציות): מק"ט / ברקוד של וריאציה אחת לא מייצגים את המוצר
  const group = product?.["@type"] === "ProductGroup" || Array.isArray(product?.["hasVariant"]);
  return {
    url: pageUrl,
    name: scraped.title,
    price: scraped.price,
    sku: group ? null : skuOf(product),
    barcode: group ? null : barcodeOf(product),
    description: clipText(scraped.description, DESCRIPTION_MAX),
    image: scraped.images[0] ?? null,
    images: scraped.images.slice(0, 5),
    category: categoryOf(product, nodes),
    stock: stockOf(product, offer),
    availability: availabilityOf(offer),
  };
}

/** מוצר מתוך צומת JSON-LD של רשימה (כשיש בו שם + מחיר) */
function productFromLdNode(node: JsonObject, base: string): SourceProduct | null {
  const name = str(node["name"]);
  const offer = offerOf(node);
  const price = parsePrice(offer?.["price"]) ?? parsePrice(offer?.["lowPrice"]);
  const url = absoluteUrl(str(node["url"]) || str(offer?.["url"]), base);
  if (!name || !url || price === null) return null;
  const image = Array.isArray(node["image"]) ? node["image"][0] : node["image"];
  const imageUrl = typeof image === "string" ? absoluteUrl(image, base) : null;
  return {
    url,
    name: clipText(name, 200),
    price,
    sku: skuOf(node),
    barcode: barcodeOf(node),
    description: clipText(str(node["description"]), DESCRIPTION_MAX),
    image: imageUrl,
    images: imageUrl ? [imageUrl] : [],
    category: typeof node["category"] === "string" ? clipText(node["category"], 60) : null,
    stock: stockOf(node, offer),
    availability: availabilityOf(offer),
  };
}

// ---------------------------------------------------------------- Shopify / WooCommerce

function parseShopify(json: unknown, origin: string): SourceProduct[] {
  const list = (json as { products?: unknown })?.products;
  if (!Array.isArray(list)) return [];
  const out: SourceProduct[] = [];
  for (const entry of list) {
    const p = entry as JsonObject;
    const title = str(p["title"]);
    const handle = str(p["handle"]);
    if (!title || !handle) continue;
    const variants = Array.isArray(p["variants"]) ? (p["variants"] as JsonObject[]) : [];
    const first = variants[0] ?? {};
    const single = variants.length <= 1;
    const prices = variants.map((v) => num(v["price"])).filter((n): n is number => n !== null);
    const quantities = variants.map((v) => num(v["inventory_quantity"]));
    const stock =
      variants.length > 0 && quantities.every((q) => q !== null && q >= 0)
        ? quantities.reduce<number>((sum, q) => sum + (q ?? 0), 0)
        : null;
    const images = (Array.isArray(p["images"]) ? (p["images"] as JsonObject[]) : [])
      .map((i) => str(i["src"]))
      .filter(Boolean)
      .slice(0, 5);
    const availableFlags = variants
      .map((v) => v["available"])
      .filter((v) => typeof v === "boolean");
    out.push({
      url: `${origin}/products/${encodeURIComponent(handle)}`,
      name: clipText(title, 200),
      price: prices.length > 0 ? Math.min(...prices) : null,
      sku: single ? str(first["sku"]) || null : null,
      barcode: single ? normBarcode(str(first["barcode"])) : null,
      description: clipText(htmlToText(str(p["body_html"])), DESCRIPTION_MAX),
      image: images[0] ?? null,
      images,
      category: str(p["product_type"]) || null,
      stock,
      availability:
        availableFlags.length === 0
          ? null
          : availableFlags.some(Boolean)
            ? "in_stock"
            : "out_of_stock",
    });
  }
  return out;
}

function parseWoo(json: unknown): SourceProduct[] {
  if (!Array.isArray(json)) return [];
  const out: SourceProduct[] = [];
  for (const entry of json) {
    const p = entry as JsonObject;
    const name = str(p["name"]);
    const url = str(p["permalink"]);
    if (!name || !url) continue;
    const prices = (p["prices"] ?? {}) as JsonObject;
    const minor = num(prices["currency_minor_unit"]) ?? 2;
    const raw = num(prices["price"]);
    const images = (Array.isArray(p["images"]) ? (p["images"] as JsonObject[]) : [])
      .map((i) => str(i["src"]))
      .filter(Boolean)
      .slice(0, 5);
    const cats = Array.isArray(p["categories"]) ? (p["categories"] as JsonObject[]) : [];
    out.push({
      url,
      name: clipText(name, 200),
      price: raw === null ? null : Math.round(raw) / 10 ** minor,
      sku: str(p["sku"]) || null,
      barcode: null,
      description: clipText(
        htmlToText(str(p["short_description"]) || str(p["description"])),
        DESCRIPTION_MAX,
      ),
      image: images[0] ?? null,
      images,
      category: str(cats[0]?.["name"]) || null,
      stock: null,
      availability:
        typeof p["is_in_stock"] === "boolean"
          ? p["is_in_stock"]
            ? "in_stock"
            : "out_of_stock"
          : null,
    });
  }
  return out;
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const page = await fetchRemotePage(url, { json: true });
    const text = page.html.trim();
    if (!text.startsWith("{") && !text.startsWith("[")) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- קישורים בעמוד

const PRODUCT_PATH =
  /\/(product|products|item|items|prod|p)\/[^/?#]+|\/shop\/[^/?#]+\/[^/?#]+|\/product-page\/|\/(?:he|en)\/product\//i;
const LISTING_PATH =
  /\/(zap\/cat|category|categories|product-category|collections|collection|cat|c|catalog|shop)(\/|$)/i;
const SKIP_PATH =
  /\/(cart|checkout|account|login|register|wishlist|blog|news|contact|about|terms|privacy|cancellations|sitemap|admin|wp-admin|search|tag)(\/|$)/i;
const PRICE_ANCHOR = /^(.{2,200}?)\s+[-–—]\s+([\d.,]+)\s*(?:₪|ש"ח|ש״ח)\s*$/;

type PageLinks = {
  products: string[];
  listings: string[];
  hints: Record<string, { name: string; price: number | null }>;
  next: string | null;
};

export function extractLinks(html: string, pageUrl: string): PageLinks {
  const products = new Set<string>();
  const listings = new Set<string>();
  const hints: PageLinks["hints"] = {};
  let next: string | null = null;
  const rel = /<link\b[^>]*rel=["']next["'][^>]*href=["']([^"']+)["']/i.exec(html);
  if (rel?.[1]) next = absoluteUrl(rel[1], pageUrl);
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = /href\s*=\s*["']([^"'#][^"']*)["']/i.exec(match[1] ?? "")?.[1];
    if (!href) continue;
    const url = absoluteUrl(href.replace(/&amp;/g, "&"), pageUrl);
    if (!url || !sameSite(url, pageUrl)) continue;
    const path = new URL(url).pathname;
    if (SKIP_PATH.test(path)) continue;
    const text = htmlToText(match[2] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const priced = PRICE_ANCHOR.exec(text);
    if (priced || PRODUCT_PATH.test(path)) {
      products.add(url);
      if (priced) {
        hints[url] = { name: clipText(priced[1]!, 200), price: parsePrice(priced[2]) };
      }
    } else if (LISTING_PATH.test(path)) {
      listings.add(url);
    }
    if (!next && /rel=["']next["']/i.test(match[1] ?? "")) next = url;
  }
  return { products: [...products], listings: [...listings], hints, next };
}

// ---------------------------------------------------------------- גילוי

function emptyDiscovery(origin: string, sourceUrl: string): SourceDiscovery {
  return {
    origin,
    sourceUrl,
    platform: "none",
    inline: [],
    productUrls: [],
    hints: {},
    listingPages: 0,
    partial: false,
    notes: [],
  };
}

/** גילוי הקטלוג של הכתובת שהוזנה — בלי לשנות דבר, ובלי לשמור */
export async function discoverSource(rawUrl: string): Promise<SourceDiscovery> {
  const input = parseSourceUrl(rawUrl);
  const deadline = Date.now() + DISCOVERY_DEADLINE_MS;

  let first: { html: string; finalUrl: string };
  try {
    first = await fetchRemotePage(input.toString());
  } catch (error) {
    throw new Error(describePageError(error));
  }
  const final = new URL(first.finalUrl);
  const origin = final.origin;
  const result = emptyDiscovery(origin, first.finalUrl);

  // כתובת שמחזירה JSON ישירות (Shopify products.json / Woo store API)
  const trimmed = first.html.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const json: unknown = JSON.parse(trimmed);
      const shop = parseShopify(json, origin);
      const woo = shop.length === 0 ? parseWoo(json) : [];
      const found = shop.length > 0 ? shop : woo;
      if (found.length > 0) {
        result.platform = shop.length > 0 ? "shopify" : "woocommerce";
        result.inline = found.slice(0, SCAN_MAX_PRODUCTS);
        result.partial = found.length > SCAN_MAX_PRODUCTS;
        if (result.partial) result.notes.push(`נקראו רק ${SCAN_MAX_PRODUCTS} המוצרים הראשונים`);
        return result;
      }
    } catch {
      // לא JSON תקין — ממשיכים כעמוד רגיל
    }
  }

  if (looksBlocked(first.html, first.finalUrl)) {
    throw new Error(
      "האתר חוסם קריאה אוטומטית (בדיקת רובוט או התחברות), ולכן אי אפשר לסרוק אותו. אפשר להשתמש בייצוא קטלוג מהאתר (CSV) או בקישור ישיר לעמוד מוצר.",
    );
  }

  const html = first.html;
  const isShopify = /cdn\.shopify\.com|Shopify\.shop|shopify-section/i.test(html);
  const isWoo = /wp-content\/plugins\/woocommerce|woocommerce-|wc-block/i.test(html);

  if (isShopify) {
    const collection = /\/collections\/([^/?#]+)/.exec(final.pathname)?.[1];
    const base = collection
      ? `${origin}/collections/${collection}/products.json`
      : `${origin}/products.json`;
    const all: SourceProduct[] = [];
    for (let page = 1; page <= SHOPIFY_PAGES && Date.now() < deadline; page++) {
      const json = await fetchJson(`${base}?limit=${SHOPIFY_PAGE}&page=${page}`);
      const batch = json ? parseShopify(json, origin) : [];
      if (batch.length === 0) break;
      all.push(...batch);
      if (batch.length < SHOPIFY_PAGE) break;
      await sleep(LISTING_DELAY_MS);
    }
    if (all.length > 0) {
      result.platform = "shopify";
      result.inline = all.slice(0, SCAN_MAX_PRODUCTS);
      result.partial = all.length >= SHOPIFY_PAGE * SHOPIFY_PAGES || all.length > SCAN_MAX_PRODUCTS;
      if (result.partial) result.notes.push("סריקה חלקית: נקראו עד 300 מוצרים ראשונים של החנות");
      return result;
    }
    result.notes.push("זוהה Shopify אבל רשימת המוצרים הציבורית לא זמינה — נסרק מתוך העמודים");
  }
  if (isWoo) {
    const all: SourceProduct[] = [];
    for (let page = 1; page <= WOO_PAGES && Date.now() < deadline; page++) {
      const json = await fetchJson(
        `${origin}/wp-json/wc/store/v1/products?per_page=${WOO_PAGE}&page=${page}`,
      );
      const batch = json ? parseWoo(json) : [];
      if (batch.length === 0) break;
      all.push(...batch);
      if (batch.length < WOO_PAGE) break;
      await sleep(LISTING_DELAY_MS);
    }
    if (all.length > 0) {
      result.platform = "woocommerce";
      result.inline = all.slice(0, SCAN_MAX_PRODUCTS);
      result.partial = all.length >= WOO_PAGE * WOO_PAGES || all.length > SCAN_MAX_PRODUCTS;
      if (result.partial) result.notes.push("סריקה חלקית: נקראו עד 200 מוצרים ראשונים של החנות");
      return result;
    }
    result.notes.push("זוהה WooCommerce אבל ה-API הציבורי לא זמין — נסרק מתוך העמודים");
  }

  // עמוד מוצר בודד
  const single = productFromPage(html, first.finalUrl);
  const ldNodes = jsonLdNodes(html);
  const looksSingle = ldNodes.some(isProductNode) && single !== null;
  const links = extractLinks(html, first.finalUrl);
  if (looksSingle && links.products.length < 4) {
    result.platform = "single";
    result.inline = [single!];
    result.notes.push("הכתובת היא עמוד של מוצר בודד");
    return result;
  }

  // רשימות: JSON-LD (ItemList / Product) ואז קישורים; עמודי קטגוריה עד עומק 2
  const productUrls = new Set<string>();
  const inline = new Map<string, SourceProduct>();
  const hints: SourceDiscovery["hints"] = {};
  const seenListings = new Set<string>([first.finalUrl]);
  const queue: { url: string; html: string | null; depth: number }[] = [
    { url: first.finalUrl, html, depth: 0 },
  ];
  let pages = 0;
  let failures = 0;
  while (queue.length > 0) {
    const item = queue.shift()!;
    if (Date.now() > deadline) {
      result.partial = true;
      result.notes.push("הסריקה נעצרה מגבלת זמן — נקראה רק חלק מהרשימות");
      break;
    }
    let page = item.html;
    if (page === null) {
      try {
        page = (await fetchRemotePage(item.url)).html;
        await sleep(LISTING_DELAY_MS);
      } catch (error) {
        failures += 1;
        if (error instanceof ImageImportError && error.code === "http_403") {
          result.notes.push("חלק מהעמודים חסומים לגישה אוטומטית");
        }
        continue;
      }
    }
    pages += 1;
    for (const node of jsonLdNodes(page)) {
      if (isProductNode(node)) {
        const product = productFromLdNode(node, item.url);
        if (product) inline.set(product.url, product);
      }
    }
    const found = extractLinks(page, item.url);
    for (const url of found.products) productUrls.add(url);
    Object.assign(hints, found.hints);
    if (found.next && !seenListings.has(found.next) && item.depth < 2) {
      seenListings.add(found.next);
      queue.push({ url: found.next, html: null, depth: item.depth });
    }
    if (item.depth < 2) {
      for (const url of found.listings) {
        if (seenListings.size >= SCAN_MAX_LISTING_PAGES) {
          result.partial = true;
          break;
        }
        if (seenListings.has(url)) continue;
        seenListings.add(url);
        queue.push({ url, html: null, depth: item.depth + 1 });
      }
    }
    if (productUrls.size + inline.size >= SCAN_MAX_PRODUCTS) break;
  }
  if (single && !inline.has(single.url) && looksSingle) inline.set(single.url, single);

  const pageUrls = [...productUrls].filter((url) => !inline.has(url));
  const total = pageUrls.length + inline.size;
  if (total > SCAN_MAX_PRODUCTS) {
    result.partial = true;
    result.notes.push(`נמצאו ${total} מוצרים — ייסרקו ${SCAN_MAX_PRODUCTS} הראשונים בלבד`);
  }
  result.inline = [...inline.values()].slice(0, SCAN_MAX_PRODUCTS);
  result.productUrls = pageUrls.slice(0, Math.max(0, SCAN_MAX_PRODUCTS - result.inline.length));
  result.hints = hints;
  result.listingPages = pages;
  result.platform =
    result.inline.length > 0 && result.productUrls.length === 0 ? "jsonld" : "links";
  if (failures > 0) {
    result.partial = true;
    result.notes.push(`${failures} עמודי רשימה לא נקראו — הסריקה חלקית`);
  }
  if (result.inline.length === 0 && result.productUrls.length === 0) {
    result.platform = "none";
    result.notes.push(
      "לא נמצאו מוצרים שאפשר לקרוא בכתובת הזו. ייתכן שהאתר טוען את המוצרים רק בדפדפן (JavaScript), דורש התחברות או חוסם סריקה. אפשר לנסות כתובת של קטגוריה או של עמוד מוצר, או לייבא מקובץ CSV.",
    );
  }
  return result;
}

// ---------------------------------------------------------------- מנות של עמודי מוצר

export type SourceBatchResult = {
  products: SourceProduct[];
  failed: { url: string; reason: string }[];
};

/** מוריד ומנתח עמודי מוצר מהאתר שנסרק (אותו דומיין בלבד) — מנה קטנה בכל קריאה */
export async function fetchSourceProducts(
  origin: string,
  urls: string[],
  hints: SourceDiscovery["hints"] = {},
): Promise<SourceBatchResult> {
  const products: SourceProduct[] = [];
  const failed: SourceBatchResult["failed"] = [];
  const allowed: string[] = [];
  for (const url of urls) {
    if (sameSite(url, origin)) allowed.push(url);
    else failed.push({ url, reason: "הכתובת אינה באתר שנסרק — דולגה" });
  }
  const outcomes = await settledPool(allowed, FETCH_CONCURRENCY, async (url) => {
    const page = await fetchRemotePage(url);
    if (!sameSite(page.finalUrl, origin)) throw new Error("הפניה לאתר אחר — דולג");
    if (looksBlocked(page.html, page.finalUrl)) throw new Error("האתר חוסם קריאה אוטומטית");
    return productFromPage(page.html, page.finalUrl);
  });
  outcomes.forEach((outcome, index) => {
    const url = allowed[index]!;
    const hint = hints[url];
    if (outcome.status === "fulfilled" && outcome.value) {
      const product = outcome.value;
      // מחיר / שם חסרים בעמוד אבל יש ברשימה — משלימים (ללא ברקוד / מק"ט)
      if (product.price === null && hint?.price) product.price = hint.price;
      products.push({ ...product, url });
    } else if (hint) {
      products.push({
        url,
        name: hint.name,
        price: hint.price,
        sku: null,
        barcode: null,
        description: "",
        image: null,
        images: [],
        category: null,
        stock: null,
        availability: null,
      });
    } else {
      failed.push({
        url,
        reason:
          outcome.status === "rejected"
            ? describePageError(outcome.reason)
            : "לא נמצאו פרטי מוצר בעמוד",
      });
    }
  });
  return { products, failed };
}
