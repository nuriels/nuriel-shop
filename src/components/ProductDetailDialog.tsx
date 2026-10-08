import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { VatNote } from "@/components/VatNote";
import { ProductRecommendations } from "@/components/sales/ProductRecommendations";
import { useStorefrontSales } from "@/components/sales/StorefrontSalesContext";
import { recommendForProduct } from "@/lib/cart-promotions";
import { Flame, KeyRound, Link2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useCategoryTree } from "@/hooks/useCategories";
import {
  discountPercent,
  formatIls,
  minimumQuantity,
  packStep,
  type CatalogItem,
} from "@/lib/catalog";
import { MinOrderNote, PackNote, QuantityPicker } from "@/components/QuantityDialog";
import { VariantPicker, useVariantSelection } from "@/components/VariantPicker";
import { RichContent } from "@/components/legal/RichContent";
import { richTextIsEmpty, richTextToPlain, toRichHtml } from "@/lib/rich-text";
import type { AddToCart } from "@/lib/cart";
import { hasVariants, variantPriceRange } from "@/lib/variants";
import { cn } from "@/lib/utils";
import { useBackToClose } from "@/hooks/useBackToClose";
import { ProductImageCarousel } from "@/components/products/ProductImageCarousel";
import { ProductSticker } from "@/components/products/ProductSticker";
import { RatingInline } from "@/components/reviews/RatingInline";
import { useRatingSummaries } from "@/hooks/useRatingSummaries";

/** הכתובת הקבועה של עמוד המוצר (SEO, שיתוף, זאפ) */
function productPath(productId: string): string {
  return `/product/${productId}`;
}

/** שיתוף / העתקת הקישור לעמוד המוצר */
async function shareProduct(product: CatalogItem): Promise<void> {
  const url = `${window.location.origin}${productPath(product.id)}`;
  const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
  if (typeof nav.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
    try {
      await nav.share({ title: product.name, url });
      return;
    } catch {
      // המשתמש ביטל את השיתוף — מעתיקים כרגיל
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast.success("הקישור למוצר הועתק");
  } catch {
    toast.info(url);
  }
}

/**
 * חלון פרטי מוצר: תמונה גדולה (וגלריה אם יש כמה), השם המלא, התיאור המלא,
 * מחיר/מבצע/פיקדון, וריאציות, מק"ט וברקוד, והוספה לסל עם כמות.
 * נפתח בלחיצה על התמונה או על שם המוצר בכרטיס.
 */
export function ProductDetailDialog({
  product,
  onOpenChange,
  canAdd,
  addLabel = "הוספה לסל",
  onAddToCart,
  onShowProduct,
}: {
  product: CatalogItem | null;
  onOpenChange: (open: boolean) => void;
  canAdd: boolean;
  addLabel?: string;
  onAddToCart?: AddToCart | undefined;
  /** מעבר למוצר אחר מתוך ההמלצות — החלון נשאר פתוח ומציג אותו */
  onShowProduct?: ((item: CatalogItem) => void) | undefined;
}) {
  const contentRef = useRef<HTMLDivElement>(null);

  // מוצר חדש נפתח — מתחילים מראש החלון
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [product?.id]);

  useBackToClose(product !== null, () => onOpenChange(false));

  if (!product) return null;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        dir="rtl"
        // חלק 22: העמודה של החלון מתכווצת לרוחב המסך (minmax(0,1fr)) — שם מוצר / מק"ט
        // ארוכים בלי רווחים לא מרחיבים את החלון מעבר למסך (חיתוך + "זום" בנייד)
        className="max-h-[92vh] max-w-full grid-cols-[minmax(0,1fr)] gap-0 overflow-y-auto overflow-x-hidden p-0 text-right sm:max-w-3xl"
      >
        <ProductDetailView
          product={product}
          mode="dialog"
          canAdd={canAdd}
          addLabel={addLabel}
          onAddToCart={onAddToCart}
          onShowProduct={onShowProduct}
          onAdded={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

/**
 * תוכן פרטי המוצר — בחלון (בקטלוג) או כעמוד מלא (/product/<id>, חלק 14).
 * בחלון הכותרת והתיאור הם של ה-Dialog (נגישות); בעמוד — h1 רגיל.
 */
export function ProductDetailView({
  product,
  mode,
  canAdd,
  addLabel = "הוספה לסל",
  onAddToCart,
  onShowProduct,
  onAdded,
  showRecommendations = true,
}: {
  product: CatalogItem;
  mode: "dialog" | "page";
  canAdd: boolean;
  addLabel?: string;
  onAddToCart?: AddToCart | undefined;
  onShowProduct?: ((item: CatalogItem) => void) | undefined;
  /** אחרי הוספה לסל (בחלון — נסגר) */
  onAdded?: (() => void) | undefined;
  /** השורה "מוצרים נוספים שאולי תאהבו" (בעמוד המוצר — רשת מלאה מתחת לפרטים) */
  showRecommendations?: boolean;
}) {
  const tree = useCategoryTree();
  const sales = useStorefrontSales();
  // חלק 34: דירוג הלקוחות (ממוצע + מספר ביקורות מאושרות)
  const ratings = useRatingSummaries();
  const rating = ratings.get(product.id);
  // "מוצרים נוספים שאולי תאהבו": מה שהמנהל קישר, ואם לא — מאותה קטגוריה
  const recommendations = useMemo(
    () => (sales ? recommendForProduct(product, sales) : []),
    [sales, product],
  );
  const [quantity, setQuantity] = useState(1);
  // חלק 23: התמונה שמוצגת בקרוסלה (מתחלפת לבד; גם התמונות הקטנות בוחרות)
  const [activeImage, setActiveImage] = useState(0);
  const showImage = useCallback((next: number) => setActiveImage(next), []);
  // וריאציות (צבע / מידה): חובה לבחור לפני ההוספה לסל
  const choice = useVariantSelection(product);

  const gallery = useMemo(() => {
    const all = [product.image_url, ...(product.images ?? [])].filter(
      (url): url is string => typeof url === "string" && url !== "",
    );
    return [...new Set(all)];
  }, [product]);

  // מוצר חדש נפתח — מתחילים ממארז/יחידה אחת ומהתמונה הראשית
  useEffect(() => {
    setQuantity(minimumQuantity(product));
    setActiveImage(0);
    // מאפסים רק כשנפתח מוצר אחר — לא כשאותו מוצר נטען מחדש מהקטלוג
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  const categoryPath = tree.byName.get(product.category)?.path ?? [product.category];
  // וריאציה עם מחיר משלה — בלי מחיר מבצע מחוק (המבצע הוא על מחיר המוצר)
  const variantOwnPrice = choice.variant?.own_price === true;
  const onSale = product.original_price !== null && !variantOwnPrice;
  const range = choice.hasVariants ? variantPriceRange(choice.variants) : null;
  const fromPrice = !choice.variant && range !== null && range.min !== range.max ? range.min : null;
  const shownPrice = fromPrice ?? choice.price;
  const saleUntil =
    onSale && product.sale_ends_at
      ? new Date(product.sale_ends_at).toLocaleDateString("he-IL", {
          day: "numeric",
          month: "long",
        })
      : null;
  const depositPerCase =
    product.has_deposit && product.deposit_price !== null && product.deposit_units !== null
      ? product.deposit_price * product.deposit_units
      : null;
  // תגיות "צבעים" ישנות — רק למוצר בלי וריאציות אמיתיות (אחרת הבחירה למטה)
  const variations = choice.hasVariants
    ? []
    : (product.colors ?? []).filter((v) => v.trim() !== "");
  const addNow = () => {
    if (!onAddToCart || product.is_out_of_stock) return;
    if (!choice.canAdd) {
      toast.info(
        choice.complete ? "האפשרות הזו אזלה מהמלאי — בחרו אחרת" : `בחרו ${choice.missing}`,
      );
      return;
    }
    onAddToCart(product, quantity, { variant: choice.variant });
    onAdded?.();
  };

  const isPage = mode === "page";
  // חלק 19: השם המלא — כהה ובולט, יורד שורה כמה שצריך (בלי truncate / line-clamp)
  const titleClass =
    "font-display whitespace-normal break-words [overflow-wrap:anywhere] text-2xl font-black leading-snug tracking-normal text-foreground sm:text-3xl";
  const title = isPage ? (
    <h1 className={titleClass} data-product-title>
      {product.name}
    </h1>
  ) : (
    <DialogTitle className={titleClass} data-product-title>
      {product.name}
    </DialogTitle>
  );
  // תיאור המוצר: HTML מעורך הטקסט העשיר (או טקסט ישן) — תמיד מנוקה לפני הצגה.
  // יורד שורה בתוך רוחב העמודה (בלי גלילה לצדדים), וקוראים אותו בגלילה למטה.
  const hasDescription = !richTextIsEmpty(toRichHtml(product.description));
  const descriptionBody: ReactNode = (
    <div
      className="min-w-0 max-w-full overflow-hidden whitespace-normal break-words [overflow-wrap:anywhere]"
      data-product-description
    >
      {hasDescription ? (
        <RichContent
          content={product.description}
          className="text-sm leading-7 text-foreground sm:text-[0.95rem]"
        />
      ) : (
        <p className="text-sm text-muted-foreground">אין תיאור למוצר הזה.</p>
      )}
    </div>
  );
  // לקוראי מסך — תקציר קצר (התיאור המלא מוצג בעמוד עצמו)
  const plainSummary = richTextToPlain(product.description).slice(0, 200);

  return (
    <>
      <div
        className={cn(
          // minmax(0, 1fr): תוכן ארוך (קישור / מילה בלי רווחים) לא מרחיב את העמודה
          "grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]",
          isPage && "overflow-hidden rounded-2xl border bg-card shadow-sm",
        )}
      >
        {/* ---------- תמונה + גלריה ---------- */}
        <div className="min-w-0 bg-secondary/60 p-4 md:rounded-s-lg">
          {/* חלק 23: כמה תמונות — קרוסלה שמתחלפת כל 3 שניות (חצים, נקודות, החלקה) */}
          <ProductImageCarousel
            images={gallery}
            alt={product.name}
            index={activeImage}
            onIndexChange={showImage}
            className={isPage ? "h-72 sm:h-96" : "h-64 sm:h-80"}
          >
            <ProductSticker sticker={product.sticker} />
            {product.is_out_of_stock && (
              <span className="absolute right-2 top-2 z-[1] w-fit rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground">
                אזל מהמלאי
              </span>
            )}
          </ProductImageCarousel>
          {gallery.length > 1 && (
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {gallery.map((url, imageIndex) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => setActiveImage(imageIndex)}
                  aria-label={`הצגת תמונה ${imageIndex + 1}`}
                  aria-current={imageIndex === activeImage ? "true" : undefined}
                  className={cn(
                    "size-14 shrink-0 overflow-hidden rounded-md border-2 bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    imageIndex === activeImage ? "border-accent" : "border-transparent",
                  )}
                >
                  <img src={url} alt="" className="h-full w-full object-contain" />
                </button>
              ))}
            </div>
          )}
          <p className="mt-2 text-center text-xs text-muted-foreground">התמונה להמחשה בלבד</p>
        </div>

        {/* ---------- פרטים ---------- */}
        <div className="flex min-w-0 max-w-full flex-col gap-4 overflow-hidden whitespace-normal break-words p-5 sm:p-6">
          <div className="space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs text-muted-foreground">{categoryPath.join(" › ")}</p>
              <button
                type="button"
                onClick={() => void shareProduct(product)}
                className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Link2 className="size-3.5" aria-hidden="true" />
                שיתוף
              </button>
            </div>
            {title}
            <RatingInline
              rating={rating}
              size="md"
              long
              {...(isPage ? { href: "#reviews" } : { href: `${productPath(product.id)}#reviews` })}
            />
            {(product.is_promo || onSale) && (
              <Badge className="gap-1 border-0 bg-accent text-accent-foreground">
                <Flame className="size-3" />
                {onSale && product.original_price !== null
                  ? `מבצע -${discountPercent(product.price ?? 0, product.original_price)}%`
                  : "מבצע"}
              </Badge>
            )}
          </div>

          <div className="space-y-1">
            {shownPrice !== null ? (
              <div className="flex flex-wrap items-baseline gap-2">
                {fromPrice !== null && (
                  <span className="text-sm font-medium text-muted-foreground">החל מ-</span>
                )}
                <span className="numeric text-3xl font-bold text-accent">
                  {formatIls(shownPrice)}
                </span>
                <VatNote className="text-sm sm:text-sm" />
                {onSale && product.original_price !== null && (
                  <span className="numeric text-base text-muted-foreground line-through">
                    {formatIls(product.original_price)}
                  </span>
                )}
                {product.is_custom_price && !variantOwnPrice && (
                  <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                    מחיר אישי עבורך
                  </span>
                )}
              </div>
            ) : (
              <p className="text-base font-medium text-muted-foreground">מחיר לפי הצעה</p>
            )}
            {saleUntil && (
              <p className="text-sm text-muted-foreground">המבצע בתוקף עד {saleUntil}</p>
            )}
            {depositPerCase !== null && (
              <p className="text-sm text-muted-foreground">
                + פיקדון {formatIls(depositPerCase)}
                {packStep(product) > 1 ? " ליחידה" : " למארז"}
              </p>
            )}
            <PackNote
              item={product}
              className="mt-1 rounded-md bg-secondary px-3 py-2 text-sm font-medium text-foreground"
            />
            <MinOrderNote item={product} />
            {product.is_digital && (
              <p className="mt-1 flex items-center gap-2 rounded-md bg-sky-50 px-3 py-2 text-sm font-medium text-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
                <KeyRound className="size-4 shrink-0" aria-hidden="true" />
                מוצר דיגיטלי — הרישיון נשלח אליך במייל, בלי משלוח
              </p>
            )}
          </div>

          {choice.hasVariants && !product.is_out_of_stock && <VariantPicker state={choice} />}

          {descriptionBody}
          {!isPage && (
            <DialogDescription className="sr-only">
              {plainSummary || `פרטי המוצר ${product.name}`}
            </DialogDescription>
          )}

          {variations.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">וריאציות</p>
              <div className="flex flex-wrap gap-1.5">
                {variations.map((variation) => (
                  <Badge key={variation} variant="outline">
                    {variation}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <dt>מק"ט</dt>
            <dd dir="ltr" className="numeric min-w-0 break-all text-right">
              {choice.variant?.sku ?? product.sku}
            </dd>
            {product.barcode && (
              <>
                <dt>ברקוד</dt>
                <dd dir="ltr" className="numeric min-w-0 break-all text-right">
                  {product.barcode}
                </dd>
              </>
            )}
          </dl>

          {canAdd && onAddToCart && (
            <div
              className={cn(
                "mt-auto space-y-3 border-t border-border pt-4",
                !isPage &&
                  "sticky bottom-0 -mx-5 bg-background px-5 py-3 sm:-mx-6 sm:px-6 md:static md:mx-0 md:bg-transparent md:px-0 md:pb-0 md:pt-4",
              )}
            >
              <QuantityPicker
                item={product}
                units={quantity}
                onChange={setQuantity}
                disabled={product.is_out_of_stock}
                onSubmit={addNow}
                price={choice.price}
              />
              <Button
                type="button"
                size="lg"
                className="w-full"
                disabled={product.is_out_of_stock || (choice.complete && !choice.canAdd)}
                onClick={addNow}
              >
                <Plus className="size-4" />
                {product.is_out_of_stock
                  ? "אזל מהמלאי"
                  : choice.hasVariants && !choice.complete
                    ? `בחרו ${choice.missing}`
                    : choice.complete && !choice.canAdd
                      ? "האפשרות אזלה"
                      : addLabel}
              </Button>
            </div>
          )}
        </div>
      </div>

      {showRecommendations && recommendations.length > 0 && (
        <div
          className={cn(
            "border-t border-border bg-secondary/30 px-5 py-4 sm:px-6",
            isPage && "mt-6 rounded-2xl border",
          )}
        >
          <ProductRecommendations
            items={recommendations}
            addLabel={addLabel}
            onOpen={onShowProduct}
            onAdd={
              canAdd && onAddToCart
                ? (item) => (hasVariants(item) ? onShowProduct?.(item) : onAddToCart(item))
                : undefined
            }
          />
        </div>
      )}
    </>
  );
}
