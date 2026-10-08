/**
 * מחולל מדבקות הברקוד (חלק 32) — הנתונים מהדפדפן, בהרשאות המנהל.
 */
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetch-all";
import {
  BARCODE_LABEL_DEFAULT,
  normalizeBarcodeLabelSize,
  type BarcodeLabelSize,
  type LabelProduct,
} from "@/lib/barcode-labels";

export type LabelCatalogProduct = LabelProduct & {
  category: string;
  /** מזהי הקטגוריות הנוספות (product_categories) — השמות לפי עץ הקטגוריות */
  extraCategoryIds: string[];
  image_url: string | null;
  is_hidden: boolean;
};

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** כל המוצרים של החנות, עם הקטגוריות הנוספות (לסינון לפי קטגוריה) */
export async function loadLabelCatalog(): Promise<LabelCatalogProduct[]> {
  const [products, links] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("global_products")
        .select(
          "id, sku, name, category, barcode, image_url, price_tier1, stock_quantity, is_hidden, is_digital",
        )
        .order("category")
        .order("name")
        .order("id")
        .range(from, to),
    ),
    fetchAllRows((from, to) =>
      supabase
        .from("product_categories")
        .select("product_id, category_id")
        .order("product_id")
        .order("category_id")
        .range(from, to),
    ),
  ]);
  if (products.error) throw new Error(products.error.message);
  const extra = new Map<string, string[]>();
  for (const row of (links.data ?? []) as { product_id: string; category_id: string }[]) {
    extra.set(row.product_id, [...(extra.get(row.product_id) ?? []), row.category_id]);
  }
  return (products.data as Record<string, unknown>[]).map((row) => {
    const id = String(row["id"]);
    const category = String(row["category"] ?? "");
    return {
      id,
      sku: String(row["sku"] ?? ""),
      name: String(row["name"] ?? ""),
      barcode: (row["barcode"] as string | null) ?? null,
      price_tier1: num(row["price_tier1"]),
      stock_quantity: num(row["stock_quantity"]),
      is_digital: row["is_digital"] === true,
      category,
      extraCategoryIds: extra.get(id) ?? [],
      image_url: (row["image_url"] as string | null) ?? null,
      is_hidden: row["is_hidden"] === true,
    };
  });
}

/** גודל מדבקת הברקוד השמור של החנות (ברירת מחדל 70×40) */
export async function loadBarcodeLabelSize(): Promise<BarcodeLabelSize> {
  const { data } = await supabase
    .from("site_settings")
    .select("barcode_label_width_mm, barcode_label_height_mm")
    .eq("id", true)
    .maybeSingle();
  if (!data) return { ...BARCODE_LABEL_DEFAULT };
  return normalizeBarcodeLabelSize({
    width: Number(data.barcode_label_width_mm),
    height: Number(data.barcode_label_height_mm),
  });
}

/** שמירת הגודל לחנות — כך שבפעם הבאה (גם ממחשב אחר) הוא כבר מוכן */
export async function saveBarcodeLabelSize(size: BarcodeLabelSize): Promise<void> {
  const { error } = await supabase
    .from("site_settings")
    .update({ barcode_label_width_mm: size.width, barcode_label_height_mm: size.height })
    .eq("id", true);
  if (error) throw new Error(error.message);
}
