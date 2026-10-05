import { createServerFn } from "@tanstack/react-start";
import { plainText } from "@/lib/marketing";

/**
 * SEO לעמוד מוצר (חלק 14): נטען בשרת (SSR) לפני שהעמוד נשלח, כך שגוגל,
 * ווטסאפ ופייסבוק רואים כותרת, תיאור, תמונה ומחיר אמיתיים — גם בלי להריץ
 * JavaScript. המחיר — של אורח (המחירון הרגיל, כולל מבצע בתוקף).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ProductSeo = {
  id: string;
  name: string;
  /** <title> — כותרת ה-SEO של המוצר, או "שם המוצר | שם החנות" */
  title: string;
  description: string;
  image: string | null;
  /** חלק 21: כל התמונות של המוצר (הראשית ראשונה) — ל-JSON-LD */
  images: string[];
  /** סיום מבצע פעיל (priceValidUntil) */
  saleEndsAt: string | null;
  price: number;
  regularPrice: number;
  inStock: boolean;
  sku: string;
  barcode: string | null;
  category: string;
  storeName: string;
  /** הכתובת הקנונית של העמוד (הדומיין הראשי של החנות) */
  url: string | null;
  /** הכתובת הראשית של החנות (לפירורי הלחם) */
  origin: string | null;
};

export const getProductSeo = createServerFn({ method: "GET" })
  .inputValidator((input: { id: string }) => {
    const id = String(input?.id ?? "")
      .trim()
      .toLowerCase();
    return { id: UUID.test(id) ? id : "" };
  })
  .handler(async ({ data }): Promise<ProductSeo | null> => {
    if (!data.id) return null;
    const { isPlatformRequest, maybeCurrentTenant } =
      await import("@/integrations/supabase/tenant.server");
    if (isPlatformRequest() || !maybeCurrentTenant()) return null;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: rows, error }, { data: settings }, { data: extra }] = await Promise.all([
      supabaseAdmin.rpc("storefront_feed_products").eq("id", data.id).limit(1),
      supabaseAdmin
        .from("site_settings")
        .select("business_name, site_title")
        .eq("id", true)
        .maybeSingle(),
      // תמונות נוספות ותוקף המבצע — לסכמת המוצר (המוצר עצמו כבר נבדק ב-RPC)
      supabaseAdmin
        .from("global_products")
        .select("images, sale_ends_at")
        .eq("id", data.id)
        .maybeSingle(),
    ]);
    if (error) {
      console.error("[seo] product lookup failed", error.message);
      return null;
    }
    const product = rows?.[0];
    if (!product) return null;

    const { DEFAULT_STORE_NAME } = await import("@/lib/branding");
    let url: string | null = null;
    let origin: string | null = null;
    try {
      const { tenantSiteOrigin } = await import("@/integrations/supabase/tenant.server");
      origin = tenantSiteOrigin();
      url = `${origin}/product/${product.id}`;
    } catch {
      url = null;
    }
    const httpUrl = (value: string | null | undefined): value is string =>
      typeof value === "string" && /^https?:\/\//i.test(value);
    const mainImage = httpUrl(product.image_url) ? product.image_url : null;
    const images = [
      ...new Set([...(mainImage ? [mainImage] : []), ...(extra?.images ?? []).filter(httpUrl)]),
    ].slice(0, 10);
    // המחיר בפיד כבר כולל מבצע בתוקף — אז גם תוקף המבצע רלוונטי
    const onSale = Number(product.price) < Number(product.regular_price);
    const saleEndsAt = onSale ? (extra?.sale_ends_at ?? null) : null;
    const storeName =
      settings?.business_name?.trim() || settings?.site_title?.trim() || DEFAULT_STORE_NAME;
    const description =
      plainText(product.seo_description, 320) ||
      plainText(product.description, 160) ||
      `${product.name} — ${storeName}`;
    return {
      id: product.id,
      name: product.name,
      title: product.seo_title?.trim() || `${product.name} | ${storeName}`,
      description,
      image: mainImage,
      images,
      saleEndsAt,
      price: Number(product.price),
      regularPrice: Number(product.regular_price),
      inStock: product.in_stock === true,
      sku: product.sku,
      barcode: product.barcode,
      category: product.category,
      storeName,
      url,
      origin,
    };
  });
