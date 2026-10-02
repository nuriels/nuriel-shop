import { useState } from "react";
import { Flame, Package, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ProductDetailDialog } from "@/components/ProductDetailDialog";
import { QuantityDialog } from "@/components/QuantityDialog";
import {
  discountPercent,
  formatIls,
  formatSaleCountdown,
  minOrderUnits,
  packStep,
  type CatalogItem,
} from "@/lib/catalog";

function ProductImage({ item }: { item: CatalogItem }) {
  return (
    <div className="relative flex h-32 items-center justify-center bg-secondary/60 p-2 sm:h-44 sm:p-3">
      {item.image_url ? (
        <img
          src={item.image_url}
          alt={item.name}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-contain mix-blend-multiply transition-transform duration-200 motion-safe:group-hover:scale-[1.03]"
        />
      ) : (
        <Package className="size-10 text-muted-foreground" />
      )}
      {(item.is_promo || item.original_price !== null) && (
        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-foreground sm:right-3 sm:top-3 sm:px-2.5 sm:py-1 sm:text-xs">
          <Flame className="size-3" />
          {item.original_price !== null
            ? `-${discountPercent(item.price ?? 0, item.original_price)}%`
            : "מבצע"}
        </span>
      )}
      {item.is_out_of_stock && (
        <div className="absolute inset-0 flex items-center justify-center bg-card/80">
          <span className="rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground">
            אזל מהמלאי
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * גריד הקטלוג הציבורי — 2 מוצרים בשורה בטלפון, עד 4 במחשב.
 * לחיצה על התמונה או על השם פותחת את חלון פרטי המוצר (תיאור מלא, גלריה,
 * כמות). מחיר מוצג רק למי שמשויך לקבוצת מחיר; לכל השאר "מחיר לפי הצעה".
 */
export function CatalogGrid({
  products,
  emptyText = "לא נמצאו מוצרים",
  canAdd,
  addLabel = "הוספה לסל",
  onAddToCart,
}: {
  products: CatalogItem[];
  emptyText?: string;
  canAdd: boolean;
  addLabel?: string;
  onAddToCart?: (item: CatalogItem, quantity?: number) => void;
}) {
  const [details, setDetails] = useState<CatalogItem | null>(null);
  const [picking, setPicking] = useState<CatalogItem | null>(null);

  if (products.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-2 py-14 text-center">
          <Package className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
        {products.map((product) => (
          <Card
            key={product.id}
            className="group gap-0 overflow-hidden py-0 shadow-card transition-shadow duration-200 hover:shadow-lift"
          >
            <button
              type="button"
              onClick={() => setDetails(product)}
              aria-label={`פרטים על ${product.name}`}
              className="block w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <ProductImage item={product} />
            </button>
            <CardContent className="flex flex-1 flex-col gap-1.5 p-3 sm:gap-2 sm:p-4">
              <p className="truncate text-[11px] text-muted-foreground sm:text-xs">
                {product.category}
              </p>
              <button
                type="button"
                onClick={() => setDetails(product)}
                className="text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              >
                <h3
                  title={product.name}
                  className="font-display line-clamp-2 min-h-10 break-words text-sm font-bold leading-snug text-foreground hover:underline sm:min-h-11 sm:text-base"
                >
                  {product.name}
                </h3>
              </button>
              {product.description && (
                <p className="hidden text-xs leading-5 text-muted-foreground sm:line-clamp-2">
                  {product.description}
                </p>
              )}

              <div className="mt-auto space-y-2 pt-1 sm:space-y-3 sm:pt-2">
                {product.price !== null ? (
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="numeric text-lg font-bold text-accent sm:text-xl">
                      {formatIls(product.price)}
                    </span>
                    {product.original_price !== null && (
                      <span className="numeric text-xs text-muted-foreground line-through sm:text-sm">
                        {formatIls(product.original_price)}
                      </span>
                    )}
                    {product.is_custom_price && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                        מחיר אישי
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground sm:text-sm">מחיר לפי הצעה</p>
                )}
                {product.original_price !== null && product.sale_ends_at && (
                  <p className="text-[11px] font-medium text-accent-foreground/80 sm:text-xs">
                    {formatSaleCountdown(product.sale_ends_at)}
                  </p>
                )}
                {packStep(product) > 1 && (
                  <p className="text-[11px] leading-4 text-muted-foreground sm:text-xs">
                    <span className="me-1 inline-block rounded bg-secondary px-1.5 py-0.5 font-semibold text-foreground">
                      מינימום {packStep(product)}
                    </span>
                    {product.price !== null && (
                      <span className="numeric whitespace-nowrap">
                        מארז {formatIls(product.price * packStep(product))}
                      </span>
                    )}
                  </p>
                )}
                {minOrderUnits(product) > 1 && (
                  <p className="text-[11px] leading-4 sm:text-xs">
                    <span className="inline-block rounded bg-accent/15 px-1.5 py-0.5 font-semibold text-foreground">
                      מינימום להזמנה: <span className="numeric">{minOrderUnits(product)}</span> יח׳
                    </span>
                  </p>
                )}
                {product.has_deposit &&
                  product.deposit_price !== null &&
                  product.deposit_units !== null && (
                    <p className="text-[11px] text-muted-foreground sm:text-xs">
                      + פיקדון {formatIls(product.deposit_price * product.deposit_units)}
                      {packStep(product) > 1 ? " ליחידה" : " למארז"}
                    </p>
                  )}
                {canAdd && onAddToCart && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full px-2"
                    disabled={product.is_out_of_stock}
                    onClick={() => setPicking(product)}
                  >
                    <Plus className="size-4" />
                    {addLabel}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {onAddToCart && (
        <QuantityDialog
          item={picking}
          onOpenChange={(open) => {
            if (!open) setPicking(null);
          }}
          addLabel={addLabel}
          onAdd={(item, units) => onAddToCart(item, units)}
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
      />
    </>
  );
}
