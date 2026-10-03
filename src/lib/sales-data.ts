/**
 * נתוני "הגדלת מכירות" לחנות: הטבות עגלה פעילות, מוצרים קשורים ומוצרי קופה.
 * נטענים יחד עם הקטלוג. כל חלק אופציונלי — תקלה בטעינה שלו (למשל לפני
 * שהמיגרציה הוחלה) רק מכבה את הפיצ'ר, ולא עוצרת את החנות.
 */

import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetch-all";
import {
  CART_PROMOTION_COLUMNS,
  relatedMapFrom,
  type CartPromotion,
  type OrderBump,
  type RelationRow,
} from "@/lib/cart-promotions";

export type SalesData = {
  promotions: CartPromotion[];
  related: Map<string, string[]>;
  bumps: OrderBump[];
};

export const EMPTY_SALES: SalesData = { promotions: [], related: new Map(), bumps: [] };

export async function loadSalesData(): Promise<SalesData> {
  const [promotions, relations, bumps] = await Promise.all([
    supabase
      .from("cart_promotions")
      .select(CART_PROMOTION_COLUMNS)
      .eq("is_active", true)
      .order("sort_order")
      .order("created_at"),
    // בעמודים — חנות עם הרבה מוצרים לא נחתכת במגבלת השורות של ה-API
    fetchAllRows<RelationRow>((from, to) =>
      supabase
        .from("product_relations")
        .select("product_id, related_product_id, sort_order")
        .order("product_id")
        .order("related_product_id")
        .range(from, to),
    ),
    supabase.rpc("get_order_bumps"),
  ]);
  return {
    promotions: promotions.error ? [] : ((promotions.data ?? []) as CartPromotion[]),
    related: relations.error ? new Map() : relatedMapFrom(relations.data),
    bumps: bumps.error ? [] : (bumps.data ?? []),
  };
}
