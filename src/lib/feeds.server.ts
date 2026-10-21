/**
 * קבצים "חיים" לכל חנות (חלק 14) — נוצרים מהמסד בכל בקשה (עם מטמון קצר):
 *  - /robots.txt  — מה גוגל סורק, וקישור למפת האתר
 *  - /sitemap.xml — דף הבית, עמודי החובה (אודות, צור קשר, תקנון, פרטיות,
 *                   ביטולים), קטגוריות ועמוד לכל מוצר — עם תמונת המוצר (חלק 21)
 *  (חלק 38: פיד ה-XML לזאפ /zap.xml הוסר — במקומו עמודי HTML לסורקים של זאפ,
 *   /zap ו-/zap/cat/{id}, ב-src/lib/zap-pages.server.ts)
 *
 * נקרא מ-src/server.ts (לפני האפליקציה), בתוך runWithTenant — supabaseAdmin
 * כבר מוגבל לחנות של הבקשה.
 *
 * חלק 31: הכתובות במפת האתר וב-robots.txt — מהכתובת הרשמית של החנות (דומיין
 * אישי פעיל, אחרת הסאב-דומיין), אותה כתובת כמו ה-canonical בעמודים. כך גם
 * כשנכנסים דרך הסאב-דומיין, גוגל מקבל רק את הכתובות הרשמיות. רק אם אין כתובת
 * רשמית (פיתוח מקומי) — הדומיין של הבקשה.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  isPlatformRequest,
  maybeCurrentTenant,
  storeLockReason,
  tenantSiteOrigin,
} from "@/integrations/supabase/tenant.server";
import { isLocalOrigin } from "@/lib/seo-urls";
import { DEFAULT_STORE_NAME } from "@/lib/branding";
import { GOOGLE_FILE_FORMAT, googleVerificationFileBody, plainText } from "@/lib/marketing";
import { PORTAL_STORE_SLUG } from "@/lib/portal";

export const FEED_PATHS = new Set(["/robots.txt", "/sitemap.xml"]);

export type FeedProduct = {
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

/**
 * חלק 31: הכתובת הרשמית של החנות (כמו ה-canonical) — ואם אין (פיתוח מקומי,
 * חנות בלי כתובת מוגדרת) — הדומיין של הבקשה.
 */
export function feedOrigin(request: Request): string {
  try {
    const official = tenantSiteOrigin().replace(/\/+$/, "");
    if (!isLocalOrigin(official)) return official;
  } catch {
    // אין כתובת רשמית — ממשיכים לדומיין של הבקשה
  }
  return requestOrigin(request);
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

export function textResponse(
  body: string,
  contentType: string,
  maxAge: number,
  status = 200,
): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": contentType,
      "cache-control": maxAge > 0 ? `public, max-age=${maxAge}` : "no-store",
    },
  });
}

export async function loadFeedProducts(): Promise<FeedProduct[]> {
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
  "/payment",
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

type SitemapEntry = {
  loc: string;
  lastmod?: string | null;
  priority?: string;
  /** חלק 21: תמונות העמוד (Image sitemap) — גוגל תמונות מוצא את תמונות המוצרים */
  images?: string[];
};

export function renderSitemap(entries: SitemapEntry[]): string {
  const withImages = entries.some((entry) => (entry.images ?? []).length > 0);
  const urls = entries
    .map((entry) => {
      const parts = [`<loc>${xmlEscape(entry.loc)}</loc>`];
      if (entry.lastmod) parts.push(`<lastmod>${entry.lastmod.slice(0, 10)}</lastmod>`);
      if (entry.priority) parts.push(`<priority>${entry.priority}</priority>`);
      for (const image of entry.images ?? []) {
        parts.push(`<image:image><image:loc>${xmlEscape(image)}</image:loc></image:image>`);
      }
      return `  <url>${parts.join("")}</url>`;
    })
    .join("\n");
  const namespaces = withImages
    ? ' xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"'
    : ' xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset${namespaces}>\n${urls}\n</urlset>\n`;
}

async function sitemapEntries(origin: string): Promise<SitemapEntry[]> {
  const tenant = maybeCurrentTenant();
  // שער הפלטפורמה — רק דף הנחיתה
  if (tenant?.slug === PORTAL_STORE_SLUG) return [{ loc: `${origin}/`, priority: "1.0" }];

  const [products, { data: categories }, { data: pages }] = await Promise.all([
    loadFeedProducts(),
    supabaseAdmin.from("categories").select("name, parent_name"),
    // חלק 30: עמודי התוכן שפורסמו
    supabaseAdmin
      .from("pages")
      .select("slug, updated_at")
      .eq("is_published", true)
      .order("sort_order"),
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
    ...(pages ?? []).map((page) => ({
      loc: `${origin}/pages/${encodeURIComponent(page.slug)}`,
      lastmod: page.updated_at,
      priority: "0.4",
    })),
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
    const image = absoluteUrl(origin, product.image_url);
    entries.push({
      loc: `${origin}/product/${product.id}`,
      lastmod: product.updated_at,
      priority: "0.8",
      ...(image ? { images: [image] } : {}),
    });
  }
  return entries.slice(0, 50_000);
}

// ------------------------------------------------------------
// זאפ — פרטי החנות לעמודי האינדקס (חלק 38: /zap, src/lib/zap-pages.server.ts)
// ------------------------------------------------------------

export type ZapStore = {
  name: string;
  origin: string;
  deliveryDays: number;
  shipmentCost: number;
  freeShippingThreshold: number | null;
  vatMultiplier: number;
};

export async function zapStore(origin: string): Promise<ZapStore> {
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
  const origin = feedOrigin(request);
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
    return textResponse("Not found\n", "text/plain; charset=utf-8", 0, 404);
  } catch (error) {
    console.error("[feeds] failed", pathname, error);
    return textResponse("Temporarily unavailable\n", "text/plain; charset=utf-8", 0, 503);
  }
}

/**
 * אימות בעלות ב-Google Search Console בשיטת קובץ HTML. הקובץ מוגש רק לחנות שהגדירה
 * את שמו (site_settings.google_verification_file) — לכל חנות הקובץ שלה, ושאר החנויות
 * מקבלות 404 רגיל (null → האפליקציה מטפלת). נקרא בתוך runWithTenant.
 */
export async function renderGoogleVerification(pathname: string): Promise<Response | null> {
  const fileName = pathname.replace(/^\//, "");
  if (!GOOGLE_FILE_FORMAT.test(fileName) || isPlatformRequest()) return null;
  const { data } = await supabaseAdmin
    .from("site_settings")
    .select("google_verification_file")
    .eq("id", true)
    .maybeSingle();
  if (data?.google_verification_file !== fileName) return null;
  return new Response(googleVerificationFileBody(fileName), {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}
