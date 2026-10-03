import { Package, Sparkles } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { VatNote } from "@/components/VatNote";
import { formatIls, minimumQuantity } from "@/lib/catalog";
import type { OrderBumpOffer as Offer } from "@/lib/cart-promotions";

/**
 * מוצר קופה (Order Bump): בלוק בולט ממש לפני שליחת ההזמנה, עם תיבת סימון —
 * סימון מוסיף את המוצר לסל (והסכום מתעדכן מיד), ביטול הסימון מסיר אותו.
 */
export function OrderBumpOffer({
  offer,
  checked,
  onToggle,
}: {
  offer: Offer;
  checked: boolean;
  onToggle: (next: boolean) => void;
}) {
  const { product, pitch } = offer;
  const quantity = minimumQuantity(product);
  const id = `order-bump-${product.id}`;

  return (
    <div className="relative mt-2 rounded-xl border-2 border-dashed border-amber-400 bg-amber-50 p-3 pt-4 text-amber-950 shadow-sm">
      <span className="absolute -top-2.5 right-3 inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber-400 px-2 py-0.5 text-[11px] font-bold text-amber-950">
        <Sparkles className="size-3" aria-hidden="true" />
        הצעה מיוחדת
      </span>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
        <Checkbox
          id={id}
          checked={checked}
          onCheckedChange={(next) => onToggle(next === true)}
          className="mt-1 size-5 border-amber-600 bg-white data-[state=checked]:border-amber-600 data-[state=checked]:bg-amber-600 data-[state=checked]:text-white"
        />
        <span className="hidden size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white p-1 sm:flex">
          {product.image_url ? (
            <img
              src={product.image_url}
              alt=""
              className="size-full object-contain mix-blend-multiply"
            />
          ) : (
            <Package className="size-5 text-amber-700/60" aria-hidden="true" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold leading-snug">
            כן! הוסיפו גם את "{product.name}"
          </span>
          <span className="mt-0.5 line-clamp-2 text-xs leading-5 text-amber-900/80">
            {pitch ?? "מוצר משלים שלקוחות רבים מוסיפים להזמנה."}
          </span>
          {product.price !== null && (
            <span className="mt-1 flex flex-wrap items-baseline gap-x-1.5 text-sm">
              <span className="numeric font-bold">+ {formatIls(product.price * quantity)}</span>
              {quantity > 1 && (
                <span className="numeric text-xs text-amber-900/70">({quantity} יח׳)</span>
              )}
              <VatNote className="text-amber-900/70" />
            </span>
          )}
        </span>
      </label>
    </div>
  );
}
