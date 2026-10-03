import { Gift, Package } from "lucide-react";
import { formatIls } from "@/lib/catalog";
import type { GiftLine, PromotionHint } from "@/lib/cart-promotions";

/**
 * המתנות שבסל: שורה לכל מתנה, במחיר 0 ועם תגית "מתנה". נוספות ויורדות לבד
 * לפי תנאי ההטבה — ובשליחה המסד מצרף אותן להזמנה (ובודק שוב את התנאי).
 */
export function CartGiftLines({ gifts }: { gifts: GiftLine[] }) {
  if (gifts.length === 0) return null;
  return (
    <ul className="space-y-3" aria-label="מתנות בסל">
      {gifts.map(({ promotion, product, quantity }) => (
        <li
          key={promotion.id}
          className="flex items-center gap-3 rounded-lg border-2 border-dashed border-green-600/40 bg-green-50/70 p-3"
        >
          <div className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white p-1">
            {product.image_url ? (
              <img
                src={product.image_url}
                alt=""
                className="size-full object-contain mix-blend-multiply"
              />
            ) : (
              <Package className="size-6 text-muted-foreground" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-green-600 px-2 py-0.5 text-[11px] font-bold text-white">
                <Gift className="size-3" aria-hidden="true" />
                מתנה
              </span>
              <span className="numeric text-xs font-semibold text-green-800">× {quantity}</span>
            </p>
            <p
              title={product.name}
              className="mt-1 line-clamp-2 break-words text-sm font-bold leading-snug text-foreground"
            >
              {product.name}
            </p>
            <p className="text-xs text-green-800/80">נוספה אוטומטית · {promotion.name}</p>
          </div>
          <div className="flex flex-col items-end">
            <span className="numeric text-sm font-bold text-green-700">{formatIls(0)}</span>
            {product.price !== null && (
              <span className="numeric text-xs text-muted-foreground line-through">
                {formatIls(product.price * quantity)}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** "עוד X ₪ וקבלו ... במתנה" — ההטבה הקרובה ביותר שעוד לא הושגה */
export function PromotionHintLine({ hint }: { hint: PromotionHint }) {
  const gift =
    hint.promotion.gift_quantity > 1
      ? `${hint.promotion.gift_quantity} × "${hint.product.name}"`
      : `"${hint.product.name}"`;
  return (
    <p className="flex items-start gap-2 rounded-lg bg-accent/10 p-2.5 text-xs leading-5 text-foreground">
      <Gift className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
      {hint.kind === "amount" ? (
        <span>
          הוסיפו עוד{" "}
          <strong className="numeric whitespace-nowrap">{formatIls(hint.missing)}</strong> וקבלו{" "}
          {gift} במתנה!
        </span>
      ) : (
        <span>
          עוד <strong className="numeric">{hint.missing}</strong> יח׳ מ"{hint.promotion.category}" ו
          {gift} במתנה!
        </span>
      )}
    </p>
  );
}
