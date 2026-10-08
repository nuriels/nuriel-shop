import { useState } from "react";
import { Flame, KeyRound, Package, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ProductDetailDialog } from "@/components/ProductDetailDialog";
import { QuantityDialog } from "@/components/QuantityDialog";
import { VariantPicker, useVariantSelection } from "@/components/VariantPicker";
import { VatNote } from "@/components/VatNote";
import type { AddToCart } from "@/lib/cart";
import {
  discountPercent,
  formatIls,
  formatSaleCountdown,
  minOrderUnits,
  packStep,
  type CatalogItem,
} from "@/lib/catalog";
import { variantPriceRange, type CatalogVariant } from "@/lib/variants";
import { richTextToPlain } from "@/lib/rich-text";
import { ProductSticker } from "@/components/products/ProductSticker";
import { RatingInline } from "@/components/reviews/RatingInline";
import { useRatingSummaries } from "@/hooks/useRatingSummaries";
import type { RatingSummary } from "@/lib/reviews";
import { cn } from "@/lib/utils";

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
      {/* חלק 23: מדבקת המוצר — תמיד בפינה העליונה השמאלית */}
      <ProductSticker sticker={item.sticker} />
      {(item.is_promo || item.original_price !== null) && (
        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-foreground sm:right-3 sm:top-3 sm:px-2.5 sm:py-1 sm:text-xs">
          <Flame className="size-3" />
          {item.original_price !== null
            ? `-${discountPercent(item.price ?? 0, item.original_price)}%`
            : "מבצע"}
        </span>
      )}
      {item.is_digital && (
        <span
          className={cn(
            "absolute left-2 inline-flex items-center gap-1 rounded-full bg-sky-600 px-2 py-0.5 text-[11px] font-semibold text-white sm:left-3",
            // הפינה העליונה השמאלית שמורה למדבקה — אז "דיגיטלי" יורד למטה
            item.sticker ? "bottom-2 sm:bottom-3" : "top-2 sm:top-3",
          )}
        >
          <KeyRound className="size-3" aria-hidden="true" />
          דיגיטלי
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

/** כרטיס מוצר בקטלוג — עם בחירת וריאציה (צבע / מידה) כשיש למוצר */
function CatalogCard({
  product,
  canAdd,
  addLabel,
  onAddToCart,
  onOpen,
  onPick,
  rating,
}: {
  product: CatalogItem;
  canAdd: boolean;
  addLabel: string;
  onAddToCart?: AddToCart | undefined;
  onOpen: () => void;
  onPick: (variant: CatalogVariant | null) => void;
  /** חלק 34: דירוג הלקוחות (ממוצע + מספר ביקורות מאושרות) */
  rating?: RatingSummary | undefined;
}) {
  const choice = useVariantSelection(product);
  const range = choice.hasVariants ? variantPriceRange(choice.variants) : null;
  // מחיר: של הוריאציה שנבחרה; לפני בחירה — "החל מ-" אם המחירים שונים
  const shownPrice = choice.variant ? choice.variant.price : product.price;
  // תקציר בכרטיס — טקסט רגיל (התיאור יכול להיות HTML מהעורך, חלק 19)
  const snippet = richTextToPlain(product.description);
  const fromPrice = !choice.variant && range !== null && range.min !== range.max ? range.min : null;
  const variantOwnPrice = choice.variant?.own_price === true;

  return (
    <Card className="group gap-0 overflow-hidden py-0 shadow-card transition-shadow duration-200 hover:shadow-lift">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`פרטים על ${product.name}`}
        className="block w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ProductImage item={product} />
      </button>
      <CardContent className="flex flex-1 flex-col gap-1.5 p-3 sm:gap-2 sm:p-4">
        <p className="truncate text-[11px] text-muted-foreground sm:text-xs">{product.category}</p>
        <button
          type="button"
          onClick={onOpen}
          className="rounded text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <h3
            title={product.name}
            className="font-display line-clamp-2 min-h-10 break-words text-sm font-bold leading-snug text-foreground hover:underline sm:min-h-11 sm:text-base"
          >
            {product.name}
          </h3>
        </button>
        <RatingInline rating={rating} />
        {snippet && (
          <p className="line-clamp-1 text-xs leading-5 text-muted-foreground sm:line-clamp-2">
            {snippet}
          </p>
        )}

        <div className="mt-auto space-y-2 pt-1 sm:space-y-3 sm:pt-2">
          {shownPrice !== null ? (
            <div className="flex flex-wrap items-baseline gap-x-2">
              {fromPrice !== null && (
                <span className="text-xs font-medium text-muted-foreground">החל מ-</span>
              )}
              <span className="numeric text-lg font-bold text-accent sm:text-xl">
                {formatIls(fromPrice ?? shownPrice)}
              </span>
              <VatNote />
              {product.original_price !== null && !variantOwnPrice && fromPrice === null && (
                <span className="numeric text-xs text-muted-foreground line-through sm:text-sm">
                  {formatIls(product.original_price)}
                </span>
              )}
              {product.is_custom_price && !variantOwnPrice && (
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                  מחיר אישי
                </span>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground sm:text-sm">מחיר לפי הצעה</p>
          )}
          {product.original_price !== null && product.sale_ends_at && !variantOwnPrice && (
            <p className="text-[11px] font-medium text-accent-foreground/80 sm:text-xs">
              {formatSaleCountdown(product.sale_ends_at)}
            </p>
          )}
          {packStep(product) > 1 && (
            <p className="text-[11px] leading-4 text-muted-foreground sm:text-xs">
              <span className="me-1 inline-block rounded bg-secondary px-1.5 py-0.5 font-semibold text-foreground">
                מינימום {packStep(product)}
              </span>
              {shownPrice !== null && (
                <span className="numeric whitespace-nowrap">
                  מארז {formatIls(shownPrice * packStep(product))}
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
          {choice.hasVariants && !product.is_out_of_stock && (
            <VariantPicker state={choice} size="sm" />
          )}
          {canAdd && onAddToCart && (
            <Button
              size="sm"
              variant="secondary"
              className="w-full px-2"
              disabled={product.is_out_of_stock || (choice.complete && !choice.canAdd)}
              onClick={() => onPick(choice.variant)}
            >
              <Plus className="size-4" />
              {choice.hasVariants && !choice.complete
                ? `בחרו ${choice.missing}`
                : choice.complete && !choice.canAdd
                  ? "אזל"
                  : addLabel}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * גריד הקטלוג הציבורי — 2 מוצרים בשורה בטלפון, עד 4 במחשב.
 * לחיצה על התמונה או על השם פותחת את חלון פרטי המוצר (תיאור מלא, גלריה,
 * כמות). מוצר עם וריאציות — בוחרים צבע / מידה בכרטיס (או בחלון הכמות).
 */
export function CatalogGrid({
  products,
  emptyText = "לא נמצאו מוצרים",
  canAdd,
  addLabel = "הוספה לסל",
  onAddToCart,
  onOpenProduct,
}: {
  products: CatalogItem[];
  emptyText?: string;
  canAdd: boolean;
  addLabel?: string;
  onAddToCart?: AddToCart | undefined;
  /** לחיצה על מוצר: ברירת מחדל — חלון פרטים; בעמוד מוצר — מעבר לעמוד שלו */
  onOpenProduct?: ((product: CatalogItem) => void) | undefined;
}) {
  const ratings = useRatingSummaries();
  const [details, setDetails] = useState<CatalogItem | null>(null);
  const [picking, setPicking] = useState<{
    item: CatalogItem;
    variant: CatalogVariant | null;
  } | null>(null);

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
          <CatalogCard
            key={product.id}
            product={product}
            canAdd={canAdd}
            addLabel={addLabel}
            onAddToCart={onAddToCart}
            onOpen={() => (onOpenProduct ? onOpenProduct(product) : setDetails(product))}
            onPick={(variant) => setPicking({ item: product, variant })}
            rating={ratings.get(product.id)}
          />
        ))}
      </div>

      {onAddToCart && (
        <QuantityDialog
          item={picking?.item ?? null}
          variant={picking?.variant ?? null}
          onOpenChange={(open) => {
            if (!open) setPicking(null);
          }}
          addLabel={addLabel}
          onAdd={(item, units, variant) => onAddToCart(item, units, { variant })}
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
    </>
  );
}
