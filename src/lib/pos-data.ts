/**
 * הקופה המהירה (חלק 32) — גישה לנתונים מהדפדפן, בהרשאות העובד המחובר
 * (חלק 33: בעלים, מנהל או קופאי). הקטלוג נטען פעם אחת (חיפוש מיידי, גם עם
 * קורא ברקודים) מקטלוג הצוות במסד — בלי מחיר עלות (staff_product_catalog);
 * חיפוש הלקוחות והיצירה — פונקציות במסד (admin_search_customers /
 * admin_create_order).
 */
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { fetchAllRows } from "@/lib/fetch-all";
import type { PosCustomer, PosOrderPayload, PosProduct, PosVariant } from "@/lib/pos";

export type PosShippingMethod = {
  id: string;
  name: string;
  kind: "delivery" | "pickup";
  price: number;
  description: string;
};

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const numOrNull = (value: unknown): number | null =>
  value === null || value === undefined || value === "" ? null : num(value);

/** כל המוצרים (גם מוסתרים — אפשר למכור בחנות מוצר שלא מוצג באתר) + הוריאציות הפעילות */
export async function loadPosCatalog(): Promise<PosProduct[]> {
  // הסדר נקבע במסד (שם, מזהה) — עמודים יציבים
  const [products, variants] = await Promise.all([
    fetchAllRows((from, to) => supabase.rpc("staff_product_catalog").range(from, to)),
    fetchAllRows((from, to) => supabase.rpc("staff_product_variants").range(from, to)),
  ]);
  if (products.error) throw new Error(products.error.message);
  if (variants.error) throw new Error(variants.error.message);

  const byProduct = new Map<string, PosVariant[]>();
  for (const row of variants.data as Record<string, unknown>[]) {
    const variant: PosVariant = {
      id: String(row["id"]),
      product_id: String(row["product_id"]),
      options: (row["options"] ?? {}) as Record<string, string>,
      sku: (row["sku"] as string | null) ?? null,
      price: numOrNull(row["price"]),
      stock_quantity: numOrNull(row["stock_quantity"]),
      is_active: row["is_active"] !== false,
    };
    byProduct.set(variant.product_id, [...(byProduct.get(variant.product_id) ?? []), variant]);
  }

  return (products.data as Record<string, unknown>[]).map((row) => ({
    id: String(row["id"]),
    sku: String(row["sku"] ?? ""),
    name: String(row["name"] ?? ""),
    category: String(row["category"] ?? ""),
    barcode: (row["barcode"] as string | null) ?? null,
    image_url: (row["image_url"] as string | null) ?? null,
    price_tier1: num(row["price_tier1"]),
    price_tier2: num(row["price_tier2"]),
    price_tier3: num(row["price_tier3"]),
    sale_price: numOrNull(row["sale_price"]),
    sale_starts_at: (row["sale_starts_at"] as string | null) ?? null,
    sale_ends_at: (row["sale_ends_at"] as string | null) ?? null,
    stock_quantity: num(row["stock_quantity"]),
    is_hidden: row["is_hidden"] === true,
    is_digital: row["is_digital"] === true,
    has_deposit: row["has_deposit"] === true,
    deposit_price: numOrNull(row["deposit_price"]),
    deposit_units: numOrNull(row["deposit_units"]),
    variant_attributes: row["variant_attributes"] ?? [],
    variants: byProduct.get(String(row["id"])) ?? [],
  }));
}

/** שיטות המשלוח הפעילות של החנות (מסך "משלוחים") */
export async function loadPosShippingMethods(): Promise<PosShippingMethod[]> {
  const { data, error } = await supabase
    .from("shipping_methods")
    .select("id, name, kind, price, description, sort_order")
    .eq("is_active", true)
    .order("sort_order")
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind === "pickup" ? "pickup" : "delivery",
    price: num(row.price),
    description: row.description ?? "",
  }));
}

/** לקוחות רשומים + קונים קודמים (אורחים) לפי שם / טלפון / אימייל */
export async function searchPosCustomers(term: string): Promise<PosCustomer[]> {
  const { data, error } = await supabase.rpc("admin_search_customers", { _term: term });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    kind: row.kind === "guest" ? "guest" : "account",
    customer_id: row.customer_id ?? null,
    name: row.name ?? "",
    phone: row.phone ?? null,
    email: row.email ?? null,
    city: row.city ?? null,
    address: row.address ?? null,
    zip: row.zip ?? null,
    price_tier: num(row.price_tier) || 1,
    price_list_type: row.price_list_type ?? "regular",
    orders_count: num(row.orders_count),
    last_order_at: row.last_order_at ?? null,
  }));
}

/** המחירון האישי של לקוח (רק כשהוא במחירון אישי) — productId → מחיר */
export async function loadPosCustomPrices(customerId: string): Promise<Map<string, number>> {
  const { data, error } = await fetchAllRows((from, to) =>
    supabase
      .from("user_custom_prices")
      .select("product_id, custom_price")
      .eq("user_id", customerId)
      .order("product_id")
      .range(from, to),
  );
  if (error) throw new Error(error.message);
  return new Map(
    (data as { product_id: string; custom_price: number }[]).map((row) => [
      row.product_id,
      num(row.custom_price),
    ]),
  );
}

export type CreatedPosOrder = {
  id: string;
  order_number: string;
  total: number;
  status: string;
};

/** יצירת ההזמנה במסד — טרנזקציה אחת (נכשל משהו → לא נוצר כלום) */
export async function createPosOrder(payload: PosOrderPayload): Promise<CreatedPosOrder> {
  const { data, error } = await supabase.rpc("admin_create_order", {
    _customer_id: payload._customer_id,
    _items: payload._items as unknown as Json,
    _details: payload._details as Json,
  });
  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row) throw new Error("יצירת ההזמנה נכשלה — נסו שוב");
  return { id: row.id, order_number: row.order_number, total: num(row.total), status: row.status };
}
