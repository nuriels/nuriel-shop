import { useState } from "react";
import { VatNote } from "@/components/VatNote";
import { Flame, Package, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProductDetailDialog } from "@/components/ProductDetailDialog";
import { QuantityDialog } from "@/components/QuantityDialog";
import {
  discountPercent,
  formatIls,
  formatSaleCountdown,
  packStep,
  type CatalogItem,
} from "@/lib/catalog";

/** רצועת "מבצעים חמים" — נגללת לרוחב, בראש הקטלוג */
export function HotDealsStrip({
  items,
  canAdd,
  addLabel = "הוספה לסל",
  onAddToCart,
}: {
  items: CatalogItem[];
  canAdd: boolean;
  addLabel?: string;
  onAddToCart?: (item: CatalogItem, quantity?: number) => void;
}) {
  const [details, setDetails] = useState<CatalogItem | null>(null);
  const [picking, setPicking] = useState<CatalogItem | null>(null);
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="hot-deals-title" className="space-y-3">
      <div className="flex items-center gap-2">
        <Flame className="size-5 text-accent" />
        <h2 id="hot-deals-title" className="font-display text-lg text-foreground">
          מבצעים חמים
        </h2>
      </div>

      <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
        {items.map((item) => (
          <article
            key={item.id}
            className="flex w-44 shrink-0 snap-start flex-col overflow-hidden rounded-lg border border-border bg-card shadow-card"
          >
            <button
              type="button"
              onClick={() => setDetails(item)}
              aria-label={`פרטים על ${item.name}`}
              className="flex h-28 cursor-pointer items-center justify-center bg-secondary/60 p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {item.image_url ? (
                <img
                  src={item.image_url}
                  alt={item.name}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-contain mix-blend-multiply"
                />
              ) : (
                <Package className="size-8 text-muted-foreground" />
              )}
            </button>
            <div className="flex flex-1 flex-col gap-1.5 p-3">
              <button
                type="button"
                onClick={() => setDetails(item)}
                title={item.name}
                className="line-clamp-2 min-h-10 break-words rounded text-start text-sm font-bold leading-snug text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {item.name}
              </button>
              {item.price !== null ? (
                <p className="flex flex-wrap items-baseline gap-1.5">
                  <span className="numeric font-bold text-accent">{formatIls(item.price)}</span>
                  <VatNote />
                  {item.original_price !== null && (
                    <span className="numeric text-xs text-muted-foreground line-through">
                      {formatIls(item.original_price)}
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">מחיר לפי הצעה</p>
              )}
              {item.original_price !== null && (
                <p className="text-[11px] font-semibold text-accent-foreground/80">
                  {discountPercent(item.price ?? 0, item.original_price)}% הנחה
                  {item.sale_ends_at ? ` · ${formatSaleCountdown(item.sale_ends_at)}` : ""}
                </p>
              )}
              {packStep(item) > 1 && (
                <p className="text-[11px] font-semibold text-muted-foreground">
                  מינימום {packStep(item)}
                </p>
              )}
              {canAdd && onAddToCart && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-auto w-full"
                  disabled={item.is_out_of_stock}
                  onClick={() => setPicking(item)}
                >
                  <Plus className="size-4" />
                  {addLabel}
                </Button>
              )}
            </div>
          </article>
        ))}
      </div>

      {onAddToCart && (
        <QuantityDialog
          item={picking}
          onOpenChange={(open) => {
            if (!open) setPicking(null);
          }}
          addLabel={addLabel}
          onAdd={(it, units) => onAddToCart(it, units)}
        />
      )}

      <ProductDetailDialog
        product={details}
        onOpenChange={(open) => {
          if (!open) setDetails(null);
        }}
        canAdd={canAdd}
        addLabel={addLabel}
        onAddToCart={onAddToCart}
        onShowProduct={setDetails}
      />
    </section>
  );
}
