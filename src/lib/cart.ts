/**
 * פעולות טהורות על הסל (בלי React): הוספת מוצר מהקטלוג, וסנכרון הסל מול
 * הקטלוג העדכני — משותף לעמוד הקטלוג ולעמוד הקופה.
 */

import { normalizeQuantity, type CatalogItem } from "@/lib/catalog";
import type { CartItem } from "@/lib/orders";

/** שורת סל חדשה ממוצר בקטלוג */
export function cartItemFromCatalog(item: CatalogItem, quantity: number): CartItem {
  return {
    productId: item.id,
    name: item.name,
    category: item.category,
    imageUrl: item.image_url,
    price: item.price ?? 0,
    quantity,
    hasDeposit: item.has_deposit,
    depositPrice: item.deposit_price,
    depositUnits: item.deposit_units,
    packSize: item.pack_size,
    minOrderQuantity: item.min_order_quantity ?? null,
  };
}

/**
 * הוספה לסל: מתחילים מהמינימום / ממארז שלם (לא מ-1). מוצר שכבר בסל —
 * הכמות מצטרפת. מחזיר את הסל החדש ואת הכמות שנוספה בפועל.
 */
export function addToCartItems(
  current: CartItem[],
  item: CatalogItem,
  requested = 1,
): { items: CartItem[]; quantity: number } {
  const quantity = normalizeQuantity(item, requested);
  const existing = current.find((line) => line.productId === item.id);
  if (existing) {
    return {
      items: current.map((line) =>
        line.productId === item.id ? { ...line, quantity: line.quantity + quantity } : line,
      ),
      quantity,
    };
  }
  return { items: [...current, cartItemFromCatalog(item, quantity)], quantity };
}

export type CartSync = {
  /** הסל אחרי הסנכרון (אותו מערך אם לא השתנה דבר) */
  items: CartItem[];
  /** שורות שיצאו: המוצר הוסתר / נמחק / אזל */
  unavailable: CartItem[];
  /** כמויות שעוגלו לפי גודל המארז / המינימום להזמנה */
  adjusted: boolean;
};

/**
 * סנכרון הסל מול הקטלוג העדכני: מוצר שאינו זמין יוצא; גודל מארז, מינימום,
 * מחיר (למשל אחרי התחברות — המחירון האישי), שם ותמונה מתעדכנים.
 */
export function syncCartWithCatalog(
  items: CartItem[],
  catalogById: Map<string, CatalogItem>,
): CartSync {
  const unavailable = items.filter((line) => {
    const product = catalogById.get(line.productId);
    return !product || product.is_out_of_stock;
  });
  let adjusted = false;
  let changed = unavailable.length > 0;
  const next = items
    .filter((line) => !unavailable.includes(line))
    .map((line) => {
      const product = catalogById.get(line.productId)!;
      const packSize = product.pack_size ?? null;
      const minOrderQuantity = product.min_order_quantity ?? null;
      const quantity = normalizeQuantity(product, line.quantity);
      const price = product.price ?? 0;
      if (
        packSize === (line.packSize ?? null) &&
        minOrderQuantity === (line.minOrderQuantity ?? null) &&
        quantity === line.quantity &&
        price === line.price &&
        product.name === line.name &&
        product.image_url === line.imageUrl &&
        product.has_deposit === (line.hasDeposit ?? false) &&
        product.deposit_price === (line.depositPrice ?? null) &&
        product.deposit_units === (line.depositUnits ?? null)
      ) {
        return line;
      }
      changed = true;
      if (quantity !== line.quantity) adjusted = true;
      return {
        ...line,
        name: product.name,
        imageUrl: product.image_url,
        category: product.category,
        price,
        packSize,
        minOrderQuantity,
        quantity,
        hasDeposit: product.has_deposit,
        depositPrice: product.deposit_price,
        depositUnits: product.deposit_units,
      };
    });
  return { items: changed ? next : items, unavailable, adjusted };
}
