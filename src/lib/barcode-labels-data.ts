/**
 * מחולל מדבקות הברקוד (חלק 32) — הנתונים מהדפדפן, בהרשאות העובד המחובר
 * (חלק 33: גם מחסנאי). המוצרים — מקטלוג הצוות במסד, בלי מחיר עלות.
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
  const products = await fetchAllRows((from, to) =>
    supabase.rpc("staff_product_catalog").range(from, to),
  );
  if (products.error) throw new Error(products.error.message);
  const rows = (products.data as Record<string, unknown>[]).map((row) => ({
    id: String(row["id"]),
    sku: String(row["sku"] ?? ""),
    name: String(row["name"] ?? ""),
    barcode: (row["barcode"] as string | null) ?? null,
    price_tier1: num(row["price_tier1"]),
    stock_quantity: num(row["stock_quantity"]),
    is_digital: row["is_digital"] === true,
    category: String(row["category"] ?? ""),
    extraCategoryIds: Array.isArray(row["category_ids"]) ? (row["category_ids"] as string[]) : [],
    image_url: (row["image_url"] as string | null) ?? null,
    is_hidden: row["is_hidden"] === true,
  }));
  // לפי קטגוריה ואז שם (כמו בעץ הקטגוריות)
  return rows.sort(
    (a, b) =>
      a.category.localeCompare(b.category, "he") ||
      a.name.localeCompare(b.name, "he") ||
      a.id.localeCompare(b.id),
  );
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

/**
 * שמירת הגודל לחנות — כך שבפעם הבאה (גם ממחשב אחר) הוא כבר מוכן.
 * פונקציה במסד (save_barcode_label_size) — גם מחסנאי שומר, בלי גישה לשאר ההגדרות.
 */
export async function saveBarcodeLabelSize(size: BarcodeLabelSize): Promise<void> {
  const { error } = await supabase.rpc("save_barcode_label_size", {
    _width_mm: size.width,
    _height_mm: size.height,
  });
  if (error) throw new Error(error.message);
}
