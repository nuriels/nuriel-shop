import { createServerFn } from "@tanstack/react-start";
import { fetchHomeBanners } from "@/lib/banners";
import type { CategoryRow } from "@/lib/category-tree";
import type { CatalogItem } from "@/lib/catalog";
import { loadSiteSettings } from "@/lib/site";
import type { StorefrontSeed } from "@/lib/storefront-seed";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** הקטלוג של אורח זהה לכל האורחים של אותה חנות — מטמון קצר לחנות (המפתח: מזהה החנות בלבד) */
const CATALOG_TTL_MS = 60_000;
const CATALOG_CACHE_MAX = 200;
const catalogCache = new Map<string, { at: number; rows: CatalogItem[] }>();

/** תיאור ארוך — מקוצר ב-HTML הראשוני (הכרטיסים מציגים שורה-שתיים); הדפדפן טוען את המלא מיד אחר כך */
export const SEED_DESCRIPTION_MAX = 600;

export function trimSeedDescription(item: CatalogItem): CatalogItem {
  const text = item.description;
  if (!text || text.length <= SEED_DESCRIPTION_MAX) return item;
  return { ...item, description: text.slice(0, SEED_DESCRIPTION_MAX) };
}

export function clearStorefrontSeedCache(): void {
  catalogCache.clear();
}

type Input = { productId?: string | null; catalog?: boolean; banners?: boolean };

/**
 * מה שאורח רואה בעמוד החנות — לבניית העמוד בשרת. אותן שאילתות כמו בדפדפן של אורח: get_catalog (בלי
 * משתמש → המחירון הרגיל; חנות מוקפאת / שבת → ריק), הקטגוריות וההגדרות הציבוריות. הלקוח של השרת מוגבל
 * לחנות של הבקשה (tenant_id + x-tenant-id), כמו בכל פונקציות השרת.
 */
export const getStorefrontSeed = createServerFn({ method: "GET" })
  .inputValidator((input: Input) => {
    const id = String(input?.productId ?? "")
      .trim()
      .toLowerCase();
    return {
      productId: UUID.test(id) ? id : null,
      catalog: input?.catalog === true,
      banners: input?.banners === true,
    };
  })
  .handler(async ({ data }): Promise<StorefrontSeed | null> => {
    const { isPlatformRequest, maybeCurrentTenant } =
      await import("@/integrations/supabase/tenant.server");
    const tenant = maybeCurrentTenant();
    if (isPlatformRequest() || !tenant) return null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      const [settings, categories] = await Promise.all([
        loadSiteSettings(supabaseAdmin),
        supabaseAdmin
          .from("categories")
          .select("id, name, parent_name, sort_order, image_url, show_on_homepage")
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true }),
      ]);
      const base = {
        settings,
        categories: (categories.data ?? []) as CategoryRow[],
        banners: null,
      };
      // מצב תחזוקה: העמוד מציג רק את מסך התחזוקה — לא שולחים מוצרים ב-HTML
      if (settings.maintenance_mode) return { ...base, catalog: null };

      if (data.productId) {
        const { data: rows, error } = await supabaseAdmin
          .rpc("get_catalog")
          .eq("id", data.productId)
          .limit(1);
        if (error) throw new Error(error.message);
        return { ...base, catalog: (rows ?? []) as CatalogItem[] };
      }
      if (!data.catalog) return { ...base, catalog: null };

      // תקלה בבאנרים לא עוצרת את העמוד (כמו בדפדפן)
      const banners = data.banners ? await fetchHomeBanners(supabaseAdmin).catch(() => null) : null;
      const hit = catalogCache.get(tenant.id);
      if (hit && Date.now() - hit.at < CATALOG_TTL_MS) {
        return { ...base, banners, catalog: hit.rows };
      }
      const { fetchAllRows } = await import("@/lib/fetch-all");
      // אותו סדר כמו בדפדפן (index.tsx): מה שיש במלאי קודם
      const { data: rows, error } = await fetchAllRows((from, to) =>
        supabaseAdmin
          .rpc("get_catalog")
          .order("is_out_of_stock", { ascending: true })
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
      );
      if (error) throw new Error(error.message);
      const catalog = (rows as CatalogItem[]).map(trimSeedDescription);
      if (catalogCache.size >= CATALOG_CACHE_MAX) catalogCache.clear();
      catalogCache.set(tenant.id, { at: Date.now(), rows: catalog });
      return { ...base, banners, catalog };
    } catch (error) {
      // בלי נתונים מהשרת העמוד נטען בדפדפן בדיוק כמו קודם
      console.error("[storefront-seed]", error instanceof Error ? error.message : error);
      return null;
    }
  });
