import { createServerFn } from "@tanstack/react-start";
import { plainText } from "@/lib/marketing";
import type { StorePage } from "@/lib/pages";

/**
 * עמוד תוכן לחזית החנות — נטען בשרת (חלק 31), כך שהכותרת, התיאור, הכתובת
 * הקנונית ופירורי הלחם נמצאים כבר ב-HTML שגוגל מקבל. רק עמוד שפורסם; טיוטה
 * (שרק מנהל רואה) נטענת בדפדפן עם ההרשאות של המנהל.
 */

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type StorePageSeo = Pick<
  StorePage,
  "slug" | "title" | "content_html" | "is_published" | "updated_at"
> & {
  /** תיאור לגוגל ולשיתוף — מתחילת התוכן */
  description: string;
  storeName: string;
  /** הכתובת הרשמית של החנות (לפירורי הלחם) */
  origin: string | null;
};

export const getStorePageSeo = createServerFn({ method: "GET" })
  .inputValidator((input: { slug: string }) => {
    const slug = String(input?.slug ?? "")
      .trim()
      .toLowerCase();
    return { slug: slug.length <= 80 && SLUG.test(slug) ? slug : "" };
  })
  .handler(async ({ data }): Promise<StorePageSeo | null> => {
    if (!data.slug) return null;
    const { isPlatformRequest, maybeCurrentTenant, tenantSiteOrigin } =
      await import("@/integrations/supabase/tenant.server");
    if (isPlatformRequest() || !maybeCurrentTenant()) return null;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: page, error }, { data: settings }] = await Promise.all([
      supabaseAdmin
        .from("pages")
        .select("slug, title, content_html, is_published, updated_at")
        .eq("slug", data.slug)
        .eq("is_published", true)
        .maybeSingle(),
      supabaseAdmin
        .from("site_settings")
        .select("business_name, site_title")
        .eq("id", true)
        .maybeSingle(),
    ]);
    if (error) {
      console.error("[pages] lookup failed", error.message);
      return null;
    }
    if (!page) return null;

    const { DEFAULT_STORE_NAME } = await import("@/lib/branding");
    let origin: string | null = null;
    try {
      origin = tenantSiteOrigin();
    } catch {
      origin = null;
    }
    const storeName =
      settings?.business_name?.trim() || settings?.site_title?.trim() || DEFAULT_STORE_NAME;
    return {
      ...page,
      description: plainText(page.content_html, 160) || `${page.title} — ${storeName}`,
      storeName,
      origin,
    };
  });
