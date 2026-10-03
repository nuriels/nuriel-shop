/**
 * לוגיקת "הגדלת מכירות" בעגלה — טהורה (בלי מסד ובלי ממשק), ונבדקת ביחידה:
 *  - הטבות "קנה וקבל": אילו מתנות מגיעות לעגלה עכשיו, ומה חסר כדי לקבל עוד
 *  - מד משלוח חינם
 *  - איזה מוצר קופה (Order Bump) להציע
 *  - המלצות "מוצרים נוספים שאולי תאהבו"
 *
 * המתנות בעגלה הן תצוגה בלבד: בשליחת ההזמנה המסד מחשב אותן מחדש
 * (apply_order_gifts) לפי המחירים האמיתיים — אותם כללים בדיוק כמו כאן.
 */

import type { CartPromotionCondition } from "@/integrations/supabase/types";
import type { CatalogItem } from "@/lib/catalog";
import { cartTotal, type CartItem } from "@/lib/orders";
import { hasVariants } from "@/lib/variants";

export type CartPromotion = {
  id: string;
  name: string;
  is_active: boolean;
  condition_type: CartPromotionCondition;
  /** min_subtotal: סכום המוצרים בעגלה שממנו מקבלים את המתנה */
  min_subtotal: number | null;
  /** category_quantity: הקטגוריה (כולל תתי-קטגוריות) והכמות המינימלית ביחידות */
  category: string | null;
  min_quantity: number | null;
  gift_product_id: string;
  gift_quantity: number;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
};

export const CART_PROMOTION_COLUMNS =
  "id, name, is_active, condition_type, min_subtotal, category, min_quantity, gift_product_id, gift_quantity, starts_at, ends_at, sort_order" as const;

/** הטבה פעילה עכשיו: מסומנת כפעילה ובתוך טווח התאריכים (אם הוגדר) */
export function isPromotionLive(promotion: CartPromotion, now: number = Date.now()): boolean {
  if (!promotion.is_active) return false;
  if (promotion.starts_at && new Date(promotion.starts_at).getTime() > now) return false;
  if (promotion.ends_at && new Date(promotion.ends_at).getTime() <= now) return false;
  return true;
}

/**
 * סכום המוצרים בעגלה — הבסיס להטבות ולמשלוח חינם: מחיר × כמות של כל
 * השורות, בלי פיקדון ובלי מתנות (אותו בסיס שהמסד משתמש בו).
 */
export function cartSubtotal(items: CartItem[]): number {
  return cartTotal(items);
}

/** השוואת סכומים באגורות — בלי הפתעות של נקודה צפה (299.999 ≠ 300) */
const cents = (value: number) => Math.round(value * 100);

export type GiftLine = {
  promotion: CartPromotion;
  product: CatalogItem;
  quantity: number;
};

/** הטבה שעוד לא הושגה: כמה חסר (₪ או יחידות) כדי לקבל את המתנה */
export type PromotionHint = {
  promotion: CartPromotion;
  product: CatalogItem;
  kind: "amount" | "units";
  missing: number;
};

export type PromotionEvaluation = {
  gifts: GiftLine[];
  /** ממוינות מהקרובה ביותר להשגה */
  hints: PromotionHint[];
};

/**
 * אילו מתנות מגיעות לעגלה עכשיו, ואילו כמעט. מתנה שהמוצר שלה לא זמין
 * ללקוח (מוסתר / אזל) לא נכנסת ולא מוצגת — בדיוק כמו במסד.
 */
export function evaluateCartPromotions(input: {
  items: CartItem[];
  promotions: CartPromotion[];
  catalogById: Map<string, CatalogItem>;
  /** הקטגוריה וכל תתי-הקטגוריות שלה */
  subtree: (category: string) => Set<string>;
  now?: number;
}): PromotionEvaluation {
  const now = input.now ?? Date.now();
  const subtotal = cartSubtotal(input.items);
  const gifts: GiftLine[] = [];
  const hints: (PromotionHint & { closeness: number })[] = [];

  const live = input.promotions
    .filter((p) => isPromotionLive(p, now))
    .sort((a, b) => a.sort_order - b.sort_order);

  for (const promotion of live) {
    const product = input.catalogById.get(promotion.gift_product_id);
    if (!product || product.is_out_of_stock) continue;

    if (promotion.condition_type === "min_subtotal" && promotion.min_subtotal !== null) {
      const target = promotion.min_subtotal;
      if (cents(subtotal) >= cents(target)) {
        gifts.push({ promotion, product, quantity: promotion.gift_quantity });
      } else {
        const missing = (cents(target) - cents(subtotal)) / 100;
        hints.push({ promotion, product, kind: "amount", missing, closeness: missing / target });
      }
    } else if (
      promotion.condition_type === "category_quantity" &&
      promotion.category !== null &&
      promotion.min_quantity !== null
    ) {
      const names = input.subtree(promotion.category);
      const units = input.items
        .filter((item) => names.has(item.category))
        .reduce((sum, item) => sum + item.quantity, 0);
      if (units >= promotion.min_quantity) {
        gifts.push({ promotion, product, quantity: promotion.gift_quantity });
      } else {
        const missing = promotion.min_quantity - units;
        hints.push({
          promotion,
          product,
          kind: "units",
          missing,
          closeness: missing / promotion.min_quantity,
        });
      }
    }
  }

  hints.sort((a, b) => a.closeness - b.closeness);
  return { gifts, hints: hints.map(({ closeness: _closeness, ...hint }) => hint) };
}

export type FreeShippingProgress = {
  threshold: number;
  /** כמה חסר (0 כשכבר הגיעו) */
  remaining: number;
  reached: boolean;
  /** 0–1, למד ההתקדמות */
  ratio: number;
};

/** מד משלוח חינם; null כשהחנות לא הגדירה סכום (הפיצ'ר כבוי) */
export function freeShippingProgress(
  subtotal: number,
  threshold: number | null | undefined,
): FreeShippingProgress | null {
  if (threshold === null || threshold === undefined || !(threshold > 0)) return null;
  const remaining = Math.max(0, (cents(threshold) - cents(subtotal)) / 100);
  return {
    threshold,
    remaining,
    reached: remaining === 0,
    ratio: Math.min(1, Math.max(0, subtotal / threshold)),
  };
}

export type OrderBump = { product_id: string; pitch: string | null };
export type OrderBumpOffer = { product: CatalogItem; pitch: string | null };

/**
 * מוצר הקופה להצעה: הראשון שזמין ללקוח (יש לו מחיר, לא אזל) ושעוד לא בעגלה.
 * `keepId` — מוצר שכבר נוסף דרך ההצעה בפתיחה הזו של הסל: נשאר מוצג (מסומן)
 * כדי שאפשר יהיה להתחרט.
 */
export function pickOrderBump(input: {
  bumps: OrderBump[];
  catalogById: Map<string, CatalogItem>;
  cartIds: Set<string>;
  keepId?: string | null;
}): OrderBumpOffer | null {
  const { bumps, catalogById, cartIds, keepId } = input;
  if (keepId && cartIds.has(keepId)) {
    const kept = bumps.find((b) => b.product_id === keepId);
    const product = catalogById.get(keepId);
    if (kept && product) return { product, pitch: kept.pitch };
  }
  for (const bump of bumps) {
    const product = catalogById.get(bump.product_id);
    if (!product || product.price === null || product.is_out_of_stock) continue;
    // מוצר עם וריאציות צריך בחירה (צבע / מידה) — לא מתאים לסימון אחד בקופה
    if (hasVariants(product)) continue;
    if (cartIds.has(product.id)) continue;
    return { product, pitch: bump.pitch };
  }
  return null;
}

export type RelationRow = { product_id: string; related_product_id: string; sort_order: number };

/** מוצר → המוצרים הקשורים שהמנהל בחר, לפי הסדר שלו */
export function relatedMapFrom(rows: RelationRow[]): Map<string, string[]> {
  const sorted = [...rows].sort((a, b) => a.sort_order - b.sort_order);
  const map = new Map<string, string[]>();
  for (const row of sorted) {
    const list = map.get(row.product_id) ?? [];
    list.push(row.related_product_id);
    map.set(row.product_id, list);
  }
  return map;
}

export const RECOMMENDATIONS_LIMIT = 8;

const available = (item: CatalogItem | undefined, exclude: Set<string>): item is CatalogItem =>
  item !== undefined && !item.is_out_of_stock && !exclude.has(item.id);

/**
 * "מוצרים נוספים שאולי תאהבו" בעמוד מוצר: המוצרים שהמנהל בחר ידנית; אם לא
 * בחר — מוצרים מאותה קטגוריה (לפי סדר הקטלוג). בלי המוצר עצמו ובלי מה שאזל.
 */
export function recommendForProduct(
  product: CatalogItem,
  ctx: {
    catalog: CatalogItem[];
    catalogById: Map<string, CatalogItem>;
    related: Map<string, string[]>;
    exclude?: Set<string>;
    limit?: number;
  },
): CatalogItem[] {
  const limit = ctx.limit ?? RECOMMENDATIONS_LIMIT;
  const exclude = new Set(ctx.exclude ?? []);
  exclude.add(product.id);

  const manual = (ctx.related.get(product.id) ?? [])
    .map((id) => ctx.catalogById.get(id))
    .filter((item): item is CatalogItem => available(item, exclude));
  if (manual.length > 0) return manual.slice(0, limit);

  return ctx.catalog
    .filter((item) => item.category === product.category && available(item, exclude))
    .slice(0, limit);
}

/**
 * המלצות בסל: קודם המוצרים שהמנהל קישר למוצרים שבסל, ואז מוצרים מאותן
 * קטגוריות — בלי מה שכבר בסל ובלי מה שאזל.
 */
export function recommendForCart(
  items: CartItem[],
  ctx: {
    catalog: CatalogItem[];
    catalogById: Map<string, CatalogItem>;
    related: Map<string, string[]>;
    exclude?: Set<string>;
    limit?: number;
  },
): CatalogItem[] {
  const limit = ctx.limit ?? RECOMMENDATIONS_LIMIT;
  const exclude = new Set([...(ctx.exclude ?? []), ...items.map((i) => i.productId)]);
  const picked: CatalogItem[] = [];
  const take = (item: CatalogItem | undefined) => {
    if (picked.length < limit && available(item, exclude)) {
      picked.push(item);
      exclude.add(item.id);
    }
  };

  for (const line of items) {
    for (const id of ctx.related.get(line.productId) ?? []) take(ctx.catalogById.get(id));
  }
  const categories = new Set(items.map((i) => i.category));
  for (const item of ctx.catalog) {
    if (picked.length >= limit) break;
    if (categories.has(item.category)) take(item);
  }
  return picked;
}
