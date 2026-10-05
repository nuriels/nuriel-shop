/**
 * קבצים "חיים" לכל חנות (חלק 14) — נוצרים מהמסד בכל בקשה (עם מטמון קצר):
 *  - /robots.txt  — מה גוגל סורק, וקישור למפת האתר
 *  - /sitemap.xml — דף הבית, עמודי מידע, קטגוריות ועמוד לכל מוצר
 *  - /zap.xml     — פיד המוצרים לזאפ השוואת מחירים (רק "הצג בזאפ", במלאי, עם מחיר).
 *                   חלק 15: נעול (403) עד שהחנות רוכשת את התוסף "חיבור לזאפ".
 *
 * נקרא מ-src/server.ts (לפני האפליקציה), בתוך runWithTenant — supabaseAdmin
 * כבר מוגבל לחנות של הבקשה. הכתובות בקבצים — מהדומיין שממנו הגיעה הבקשה
 * (גוגל דורש שמפת האתר והעמודים יהיו באותו דומיין).
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  isPlatformRequest,
  maybeCurrentTenant,
  storeLockReason,
} from "@/integrations/supabase/tenant.server";
import { DEFAULT_STORE_NAME } from "@/lib/branding";
import { plainText } from "@/lib/marketing";
import { PORTAL_STORE_SLUG } from "@/lib/portal";

export const FEED_PATHS = new Set(["/robots.txt", "/sitemap.xml", "/zap.xml"]);

type FeedProduct = {
  id: string;
  sku: string;
  name: string;
  category: string;
  description: string | null;
  image_url: string | null;
  barcode: string | null;
  price: number;
  in_stock: boolean;
  is_digital: boolean;
  show_in_zap: boolean;
  updated_at: string;
};

/** https://host[:port] של הבקשה (מאחורי nginx — לפי x-forwarded-*) */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host)
    .split(",")[0]!
    .trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const isLocal = /^(localhost|127\.|\[::1\])/.test(host);
  const proto = forwardedProto || (isLocal ? url.protocol.replace(":", "") : "https");
  return `${proto}://${host}`;
}

/** תווים מותרים ב-XML 1.0 + escape */
// בכוונה: מסננים תווי בקרה שאסורים ב-XML (חוץ מטאב ושורה חדשה)
// eslint-disable-next-line no-control-regex
const XML_INVALID = /[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;

export function xmlEscape(value: string): string {
  return value
    .replace(XML_INVALID, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function textResponse(body: string, contentType: string, maxAge: number, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": contentType,
      "cache-control": maxAge > 0 ? `public, max-age=${maxAge}` : "no-store",
    },
  });
}

async function loadFeedProducts(): Promise<FeedProduct[]> {
  const rows: FeedProduct[] = [];
  const PAGE = 1000;
  // עד 50,000 כתובות (המגבלה של קובץ sitemap אחד)
  for (let from = 0; from < 50_000; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .rpc("storefront_feed_products")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as FeedProduct[];
    rows.push(
      ...page.map((row) => ({ ...row, price: Number(row.price), in_stock: row.in_stock === true })),
    );
    if (page.length < PAGE) break;
  }
  return rows;
}

function absoluteUrl(origin: string, url: string | null): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return `${origin}${url}`;
  return null;
}

// ------------------------------------------------------------
// robots.txt
// ------------------------------------------------------------

const PRIVATE_PATHS = [
  "/admin",
  "/admin-handoff",
  "/agent",
  "/warehouse",
  "/courier/",
  "/checkout",
  "/account",
  "/orders",
  "/agreement",
  "/login",
  "/register",
  "/reset-password",
  "/locked",
  "/forbidden",
  "/_serverFn/",
];

export function renderRobots(origin: string, open: boolean): string {
  if (!open) return "User-agent: *\nDisallow: /\n";
  return [
    "User-agent: *",
    "Allow: /",
    ...PRIVATE_PATHS.map((path) => `Disallow: ${path}`),
    "",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

// ------------------------------------------------------------
// sitemap.xml
// ------------------------------------------------------------

type SitemapEntry = { loc: string; lastmod?: string | null; priority?: string };

export function renderSitemap(entries: SitemapEntry[]): string {
  const urls = entries
    .map((entry) => {
      const parts = [`<loc>${xmlEscape(entry.loc)}</loc>`];
      if (entry.lastmod) parts.push(`<lastmod>${entry.lastmod.slice(0, 10)}</lastmod>`);
      if (entry.priority) parts.push(`<priority>${entry.priority}</priority>`);
      return `  <url>${parts.join("")}</url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

async function sitemapEntries(origin: string): Promise<SitemapEntry[]> {
  const tenant = maybeCurrentTenant();
  // שער הפלטפורמה — רק דף הנחיתה
  if (tenant?.slug === PORTAL_STORE_SLUG) return [{ loc: `${origin}/`, priority: "1.0" }];

  const [products, { data: categories }] = await Promise.all([
    loadFeedProducts(),
    supabaseAdmin.from("categories").select("name, parent_name"),
  ]);
  const newest = products.reduce<string | null>(
    (latest, p) => (!latest || p.updated_at > latest ? p.updated_at : latest),
    null,
  );
  const entries: SitemapEntry[] = [
    { loc: `${origin}/`, lastmod: newest, priority: "1.0" },
    { loc: `${origin}/about`, priority: "0.5" },
    { loc: `${origin}/contact`, priority: "0.5" },
    { loc: `${origin}/sitemap`, priority: "0.3" },
    { loc: `${origin}/terms`, priority: "0.2" },
    { loc: `${origin}/privacy`, priority: "0.2" },
    { loc: `${origin}/cancellations`, priority: "0.2" },
  ];

  // קטגוריות שיש בהן מוצרים (כולל קטגוריות-אב שלהן)
  const parentOf = new Map((categories ?? []).map((c) => [c.name, c.parent_name ?? null]));
  const withProducts = new Set<string>();
  for (const product of products) {
    let name: string | null = product.category;
    let guard = 0;
    while (name && !withProducts.has(name) && guard++ < 10) {
      withProducts.add(name);
      name = parentOf.get(name) ?? null;
    }
  }
  for (const name of [...withProducts].sort((a, b) => a.localeCompare(b, "he"))) {
    entries.push({ loc: `${origin}/?category=${encodeURIComponent(name)}`, priority: "0.7" });
  }

  for (const product of products) {
    entries.push({
      loc: `${origin}/product/${product.id}`,
      lastmod: product.updated_at,
      priority: "0.8",
    });
  }
  return entries.slice(0, 50_000);
}

// ------------------------------------------------------------
// zap.xml
// ------------------------------------------------------------

type ZapStore = {
  name: string;
  origin: string;
  deliveryDays: number;
  shipmentCost: number;
  freeShippingThreshold: number | null;
  vatMultiplier: number;
};

function israelDateTime(now: Date): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jerusalem",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return {
    date: `${parts["day"]}/${parts["month"]}/${parts["year"]}`,
    time: `${parts["hour"]}:${parts["minute"]}:${parts["second"]}`,
  };
}

const money = (value: number) => (Math.round(value * 100) / 100).toFixed(2);

/**
 * הפיד בתקן של זאפ: STORE ← PRODUCTS ← PRODUCT. המחיר — כולל מע"מ (כמו
 * שהצרכן משלם); דמי המשלוח — שיטת המשלוח הזולה של החנות (0 למוצר דיגיטלי
 * או מעל סף המשלוח החינם).
 */
export function renderZapFeed(store: ZapStore, products: FeedProduct[], now = new Date()): string {
  const { date, time } = israelDateTime(now);
  const items = products
    .filter((p) => p.show_in_zap && p.in_stock && p.price > 0)
    .map((p, index) => {
      const price = p.price * store.vatMultiplier;
      // סף המשלוח החינם — לפי המחיר בקטלוג (כמו בקופה), לא לפי המחיר עם מע"מ
      const shipping =
        p.is_digital ||
        (store.freeShippingThreshold !== null && p.price >= store.freeShippingThreshold)
          ? 0
          : store.shipmentCost;
      const image = absoluteUrl(store.origin, p.image_url);
      const fields: [string, string][] = [
        ["PRODUCT_URL", `${store.origin}/product/${p.id}`],
        ["PRODUCT_NAME", p.name],
        ["MODEL", p.barcode ?? p.sku],
        ["DETAILS", plainText(p.description, 1000)],
        ["CATALOG_NUMBER", p.sku],
        ["CURRENCY", "ILS"],
        ["PRICE", money(price)],
        ["SHIPMENT_COST", money(shipping)],
        ["DELIVERY_TIME", String(p.is_digital ? 0 : store.deliveryDays)],
        ["MANUFACTURER", ""],
        ["WARRANTY", ""],
        ["IMAGE", image ?? ""],
        ["TAX", "1"],
      ];
      return `<PRODUCT NUM="${index + 1}">\n${fields
        .map(([tag, value]) => `<${tag}>${xmlEscape(value)}</${tag}>`)
        .join("\n")}\n</PRODUCT>`;
    });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<STORE URL="${xmlEscape(store.origin)}" DATE="${date}" TIME="${time}" NAME="${xmlEscape(store.name)}">\n<PRODUCTS>\n${items.join("\n")}\n</PRODUCTS>\n</STORE>\n`;
}

async function zapStore(origin: string): Promise<ZapStore> {
  const [{ data: settings }, { data: methods }] = await Promise.all([
    supabaseAdmin
      .from("site_settings")
      .select(
        "business_name, site_title, zap_delivery_days, free_shipping_threshold, prices_include_vat, vat_rate",
      )
      .eq("id", true)
      .maybeSingle(),
    supabaseAdmin.from("shipping_methods").select("kind, price").eq("is_active", true),
  ]);
  const delivery = (methods ?? [])
    .filter((m) => m.kind === "delivery")
    .map((m) => Number(m.price))
    .filter((price) => Number.isFinite(price) && price >= 0);
  const vatRate = Number(settings?.vat_rate ?? 18);
  return {
    name:
      settings?.business_name?.trim() ||
      settings?.site_title?.trim() ||
      maybeCurrentTenant()?.name ||
      DEFAULT_STORE_NAME,
    origin,
    deliveryDays: Number(settings?.zap_delivery_days ?? 3),
    shipmentCost: delivery.length > 0 ? Math.min(...delivery) : 0,
    freeShippingThreshold:
      settings?.free_shipping_threshold != null ? Number(settings.free_shipping_threshold) : null,
    vatMultiplier:
      settings?.prices_include_vat === false && Number.isFinite(vatRate) ? 1 + vatRate / 100 : 1,
  };
}

// ------------------------------------------------------------
// הנתב
// ------------------------------------------------------------

/** התוסף "חיבור לזאפ" פעיל בחנות (מצב המנוי של הבקשה — כולל התוספים) */
export function zapFeedUnlocked(): boolean {
  return maybeCurrentTenant()?.subscription.features.zapFeed === true;
}

export async function renderFeed(pathname: string, request: Request): Promise<Response> {
  const origin = requestOrigin(request);
  // דומיין פאנל הפלטפורמה / חנות נעולה — לא לסריקה
  const open = !isPlatformRequest() && storeLockReason() === null;

  if (pathname === "/robots.txt") {
    return textResponse(renderRobots(origin, open), "text/plain; charset=utf-8", 3600);
  }
  if (!open) return textResponse("Not found\n", "text/plain; charset=utf-8", 0, 404);

  try {
    if (pathname === "/sitemap.xml") {
      return textResponse(
        renderSitemap(await sitemapEntries(origin)),
        "application/xml; charset=utf-8",
        3600,
      );
    }
    // חלק 15: הפיד נפתח רק עם התוסף "חיבור לזאפ" (גם בפרימיום)
    if (!zapFeedUnlocked()) {
      return textResponse(
        "Zap feed is not enabled for this store (add-on required)\n",
        "text/plain; charset=utf-8",
        0,
        403,
      );
    }
    const [store, products] = await Promise.all([zapStore(origin), loadFeedProducts()]);
    return textResponse(renderZapFeed(store, products), "application/xml; charset=utf-8", 1800);
  } catch (error) {
    console.error("[feeds] failed", pathname, error);
    return textResponse("Temporarily unavailable\n", "text/plain; charset=utf-8", 0, 503);
  }
}
