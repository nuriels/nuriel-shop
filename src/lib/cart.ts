/**
 * פעולות טהורות על הסל (בלי React): הוספת מוצר מהקטלוג, וסנכרון הסל מול
 * הקטלוג העדכני — משותף לעמוד הקטלוג ולעמוד הקופה.
 *
 * שורה בסל = מוצר + וריאציה (cartLineKey): שתי מידות של אותה חולצה הן שתי
 * שורות, כל אחת עם הכמות והמחיר שלה.
 */

import { normalizeQuantity, type CatalogItem } from "@/lib/catalog";
import { cartLineKey, type CartItem } from "@/lib/orders";
import {
  hasVariants,
  variantAttributesOf,
  variantLabel,
  variantsOf,
  type CatalogVariant,
} from "@/lib/variants";

/** הוספה לסל מכל מקום בחנות (כרטיס, חלון מוצר, המלצות, סל) */
export type AddToCartOptions = {
  /** בלי הודעה קופצת */
  silent?: boolean;
  /** הוריאציה שנבחרה — חובה למוצר עם וריאציות */
  variant?: CatalogVariant | null;
};
export type AddToCart = (item: CatalogItem, quantity?: number, options?: AddToCartOptions) => void;

/** שורת סל חדשה ממוצר בקטלוג (ומהוריאציה שנבחרה, אם יש) */
export function cartItemFromCatalog(
  item: CatalogItem,
  quantity: number,
  variant?: CatalogVariant | null,
): CartItem {
  return {
    productId: item.id,
    name: item.name,
    category: item.category,
    imageUrl: item.image_url,
    price: (variant ? variant.price : item.price) ?? 0,
    quantity,
    hasDeposit: item.has_deposit,
    depositPrice: item.deposit_price,
    depositUnits: item.deposit_units,
    packSize: item.pack_size,
    minOrderQuantity: item.min_order_quantity ?? null,
    variantId: variant?.id ?? null,
    variantLabel: variant ? variantLabel(variant.options, variantAttributesOf(item)) : null,
    isDigital: item.is_digital === true,
  };
}

/**
 * הוספה לסל: מתחילים מהמינימום / ממארז שלם (לא מ-1). אותו מוצר ואותה
 * וריאציה שכבר בסל — הכמות מצטרפת. מחזיר את הסל החדש ואת הכמות שנוספה.
 */
export function addToCartItems(
  current: CartItem[],
  item: CatalogItem,
  requested = 1,
  variant?: CatalogVariant | null,
): { items: CartItem[]; quantity: number } {
  const quantity = normalizeQuantity(item, requested);
  const key = cartLineKey({ productId: item.id, variantId: variant?.id ?? null });
  const existing = current.find((line) => cartLineKey(line) === key);
  if (existing) {
    return {
      items: current.map((line) =>
        cartLineKey(line) === key ? { ...line, quantity: line.quantity + quantity } : line,
      ),
      quantity,
    };
  }
  return { items: [...current, cartItemFromCatalog(item, quantity, variant)], quantity };
}

export type CartSync = {
  /** הסל אחרי הסנכרון (אותו מערך אם לא השתנה דבר) */
  items: CartItem[];
  /** שורות שיצאו: המוצר / האפשרות הוסתרו, נמחקו או אזלו */
  unavailable: CartItem[];
  /** כמויות שעוגלו לפי גודל המארז / המינימום להזמנה */
  adjusted: boolean;
};

/** הוריאציה של שורה בסל, אם היא עדיין זמינה (undefined = לא זמינה) */
function lineVariant(line: CartItem, product: CatalogItem): CatalogVariant | null | undefined {
  const variants = variantsOf(product);
  if (!line.variantId) {
    // מוצר שבינתיים קיבל וריאציות — השורה הישנה (בלי בחירה) כבר לא תקפה
    return hasVariants(product) ? undefined : null;
  }
  const variant = variants.find((candidate) => candidate.id === line.variantId);
  return variant && variant.available ? variant : undefined;
}

/**
 * סנכרון הסל מול הקטלוג העדכני: מוצר / אפשרות שאינם זמינים יוצאים; גודל
 * מארז, מינימום, מחיר (למשל אחרי התחברות — המחירון האישי), שם ותמונה
 * מתעדכנים.
 */
export function syncCartWithCatalog(
  items: CartItem[],
  catalogById: Map<string, CatalogItem>,
): CartSync {
  const unavailable = items.filter((line) => {
    const product = catalogById.get(line.productId);
    return !product || product.is_out_of_stock || lineVariant(line, product) === undefined;
  });
  let adjusted = false;
  let changed = unavailable.length > 0;
  const next = items
    .filter((line) => !unavailable.includes(line))
    .map((line) => {
      const product = catalogById.get(line.productId)!;
      const variant = lineVariant(line, product) ?? null;
      const packSize = product.pack_size ?? null;
      const minOrderQuantity = product.min_order_quantity ?? null;
      const quantity = normalizeQuantity(product, line.quantity);
      const price = (variant ? variant.price : product.price) ?? 0;
      const label = variant ? variantLabel(variant.options, variantAttributesOf(product)) : null;
      const isDigital = product.is_digital === true;
      if (
        packSize === (line.packSize ?? null) &&
        minOrderQuantity === (line.minOrderQuantity ?? null) &&
        quantity === line.quantity &&
        price === line.price &&
        product.name === line.name &&
        product.image_url === line.imageUrl &&
        product.has_deposit === (line.hasDeposit ?? false) &&
        product.deposit_price === (line.depositPrice ?? null) &&
        product.deposit_units === (line.depositUnits ?? null) &&
        label === (line.variantLabel ?? null) &&
        isDigital === (line.isDigital ?? false)
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
        variantLabel: label,
        isDigital,
      };
    });
  return { items: changed ? next : items, unavailable, adjusted };
}
