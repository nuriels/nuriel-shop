import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  SCAN_BATCH_SIZE,
  SCAN_MAX_PRODUCTS,
  normBarcode,
  type DiffField,
  type ScanRow,
  type ScanSummary,
  type SourceProduct,
} from "@/lib/source-scan";
import type { ImportSummary } from "@/lib/csv-import";
import type { SourceDiscovery } from "@/server/services/source-scan";

/**
 * חלק 44: "סריקת אתר מקור" — Server Actions. מנהל החנות בלבד, והכל מוגבל לחנות של הבקשה:
 *
 *  discoverSourceCatalog — מקבל כתובת (זמנית, לסריקה הזו בלבד — שום כתובת לא נשמרת), מגלה
 *                          את המוצרים הקריאים באתר ומחזיר רשימת עמודי מוצר לקריאה במנות.
 *  fetchSourceBatch      — קורא מנה קטנה של עמודי מוצר (אותו אתר בלבד).
 *  compareSourceCatalog  — משווה את מה שנסרק לקטלוג של החנות הפעילה בלבד (קריאה בלבד).
 *  applySourceChanges    — מבצע רק את מה שהמשתמש אישר: הוספת מוצרים (דרך import_products
 *                          הקיים) ועדכון שדות מסוימים של מוצר קיים (בהרשאות המנהל, RLS).
 * הסריקה וההשוואה אינן משנות דבר. אין מחיקות. הכל נבדק גם כאן, לא רק בממשק.
 */

async function requireStoreAdmin(userId: string): Promise<void> {
  const { loadCaller } = await import("@/lib/caller.server");
  const caller = await loadCaller(userId);
  if (caller.role !== "admin") throw new Error("רק מנהל החנות יכול לסרוק אתר מקור ולייבא מוצרים");
}

const str = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** מוצר מקור מהדפדפן → ערכים נקיים (הלקוח אינו מהימן; גם הוא רק מנהל החנות) */
function cleanSource(input: unknown): SourceProduct | null {
  const p = (input ?? {}) as Record<string, unknown>;
  const url = str(p["url"], 1000);
  const name = str(p["name"], 200);
  if (!/^https?:\/\//i.test(url) || !name) return null;
  const price = typeof p["price"] === "number" && Number.isFinite(p["price"]) ? p["price"] : null;
  const stockRaw = p["stock"];
  const stock =
    typeof stockRaw === "number" &&
    Number.isInteger(stockRaw) &&
    stockRaw >= 0 &&
    stockRaw < 10_000_000
      ? stockRaw
      : null;
  const images = Array.isArray(p["images"])
    ? (p["images"] as unknown[])
        .map((i) => str(i, 1000))
        .filter((i) => /^https?:\/\//i.test(i))
        .slice(0, 5)
    : [];
  const image = str(p["image"], 1000);
  return {
    url,
    name,
    price:
      price !== null && price >= 0 && price < 100_000_000 ? Math.round(price * 100) / 100 : null,
    sku: str(p["sku"], 64) || null,
    barcode: normBarcode(str(p["barcode"], 40)),
    description: str(p["description"], 1500),
    image: /^https?:\/\//i.test(image) ? image : (images[0] ?? null),
    images,
    category: str(p["category"], 60) || null,
    stock,
    availability:
      p["availability"] === "in_stock" || p["availability"] === "out_of_stock"
        ? p["availability"]
        : null,
  };
}

export const discoverSourceCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { url: string }) => ({ url: String(input?.url ?? "").slice(0, 3000) }))
  .handler(async ({ data, context }): Promise<SourceDiscovery> => {
    await requireStoreAdmin(context.userId);
    const { allowAction } = await import("@/lib/rate-limit.server");
    if (!allowAction(`source-scan:${context.userId}`, 12, 10 * 60 * 1000)) {
      throw new Error("יותר מדי סריקות בדקות האחרונות — נסו שוב בעוד כמה דקות");
    }
    const { discoverSource } = await import("@/server/services/source-scan");
    const result = await discoverSource(data.url);
    console.info(
      "[source-scan] discovered",
      JSON.stringify({
        host: new URL(result.origin).host,
        platform: result.platform,
        inline: result.inline.length,
        pages: result.productUrls.length,
      }),
    );
    return result;
  });

export const fetchSourceBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      origin: string;
      urls: string[];
      hints?: Record<string, { name: string; price: number | null }>;
    }) => {
      const origin = String(input?.origin ?? "");
      if (!/^https?:\/\/[^/]+$/i.test(origin)) throw new Error("כתובת האתר לא תקינה");
      if (!Array.isArray(input?.urls) || input.urls.length === 0) throw new Error("המנה ריקה");
      if (input.urls.length > SCAN_BATCH_SIZE) throw new Error(`עד ${SCAN_BATCH_SIZE} עמודים במנה`);
      const urls = input.urls.map((u) => str(u, 1000)).filter((u) => /^https?:\/\//i.test(u));
      const hints: Record<string, { name: string; price: number | null }> = {};
      for (const url of urls) {
        const hint = input.hints?.[url];
        if (hint && typeof hint.name === "string") {
          hints[url] = {
            name: str(hint.name, 200),
            price:
              typeof hint.price === "number" && Number.isFinite(hint.price) ? hint.price : null,
          };
        }
      }
      return { origin, urls, hints };
    },
  )
  .handler(async ({ data, context }) => {
    await requireStoreAdmin(context.userId);
    const { allowAction } = await import("@/lib/rate-limit.server");
    if (!allowAction(`source-batch:${context.userId}`, 400, 10 * 60 * 1000)) {
      throw new Error("יותר מדי בקשות בדקות האחרונות — נסו שוב בעוד כמה דקות");
    }
    const { fetchSourceProducts } = await import("@/server/services/source-scan");
    return fetchSourceProducts(data.origin, data.urls, data.hints);
  });

export type CompareResult = {
  rows: ScanRow[];
  summary: ScanSummary;
  storeName: string;
  catalogSize: number;
};

export const compareSourceCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { products: unknown[] }) => {
    if (!Array.isArray(input?.products)) throw new Error("אין נתוני סריקה");
    if (input.products.length > SCAN_MAX_PRODUCTS + 50) throw new Error("יותר מדי מוצרים בסריקה");
    const products = input.products.map(cleanSource).filter((p): p is SourceProduct => p !== null);
    return { products };
  })
  .handler(async ({ data, context }): Promise<CompareResult> => {
    await requireStoreAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { fetchAllRows } = await import("@/lib/fetch-all");
    const { compareCatalog } = await import("@/lib/source-scan");

    // הקטלוג של החנות הפעילה בלבד (supabaseAdmin מוגבל לחנות של הבקשה)
    const products = await fetchAllRows((from, to) =>
      supabaseAdmin
        .from("global_products")
        .select(
          "id, sku, barcode, name, price_tier1, description, image_url, category, stock_quantity, uniform_price",
        )
        .order("id")
        .range(from, to),
    );
    if (products.error) throw new Error("טעינת הקטלוג נכשלה");
    const categories = await supabaseAdmin.from("categories").select("name");
    const names = new Set((categories.data ?? []).map((c) => c.name));
    for (const p of products.data) names.add(p.category);

    const { rows, summary } = compareCatalog(
      data.products,
      products.data.map((p) => ({ ...p, price_tier1: Number(p.price_tier1) })),
      names,
    );
    const { data: settings } = await supabaseAdmin
      .from("site_settings")
      .select("business_name, site_title")
      .eq("id", true)
      .maybeSingle();
    return {
      rows,
      summary,
      storeName: settings?.business_name?.trim() || settings?.site_title?.trim() || "",
      catalogSize: products.data.length,
    };
  });

export type ApplyInput = {
  adds: SourceProduct[];
  updates: { productId: string; fields: DiffField[]; source: SourceProduct }[];
};

export type ApplyResult = {
  added: ImportSummary | null;
  updated: { productId: string; ok: boolean; error?: string }[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS: DiffField[] = [
  "name",
  "price",
  "description",
  "image",
  "barcode",
  "category",
  "stock",
];

export const applySourceChanges = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: ApplyInput) => {
    const adds = (Array.isArray(input?.adds) ? input.adds : [])
      .map(cleanSource)
      .filter((p): p is SourceProduct => p !== null);
    if (adds.length > 10) throw new Error("עד 10 מוצרים חדשים בכל מנה");
    const rawUpdates = Array.isArray(input?.updates) ? input.updates : [];
    if (rawUpdates.length > 20) throw new Error("עד 20 עדכונים בכל מנה");
    const updates = rawUpdates.flatMap((u) => {
      const source = cleanSource(u?.source);
      const productId = String(u?.productId ?? "");
      if (!source || !UUID.test(productId)) return [];
      const fields = [...new Set(Array.isArray(u.fields) ? u.fields : [])].filter(
        (f): f is DiffField => FIELDS.includes(f),
      );
      return fields.length > 0 ? [{ productId: productId.toLowerCase(), fields, source }] : [];
    });
    if (adds.length === 0 && updates.length === 0) throw new Error("לא אושר שום שינוי");
    return { adds, updates };
  })
  .handler(async ({ data, context }): Promise<ApplyResult> => {
    await requireStoreAdmin(context.userId);
    const { allowAction } = await import("@/lib/rate-limit.server");
    if (!allowAction(`source-apply:${context.userId}`, 120, 10 * 60 * 1000)) {
      throw new Error("יותר מדי פעולות בדקות האחרונות — נסו שוב בעוד כמה דקות");
    }
    const { applyApproved } = await import("@/server/services/source-apply");
    return applyApproved(data, context.supabase);
  });
