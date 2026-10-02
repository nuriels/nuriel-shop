import { useEffect, useMemo, useState } from "react";
import { Flame, Package, Plus } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { useBackToClose } from "@/hooks/useBackToClose";

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
}: {
  product: CatalogItem | null;
  onOpenChange: (open: boolean) => void;
  canAdd: boolean;
  addLabel?: string;
  onAddToCart?: ((item: CatalogItem, quantity?: number) => void) | undefined;
}) {
  const tree = useCategoryTree();
  const [quantity, setQuantity] = useState(1);
  const [activeImage, setActiveImage] = useState<string | null>(null);

  const gallery = useMemo(() => {
    if (!product) return [];
    const all = [product.image_url, ...(product.images ?? [])].filter(
      (url): url is string => typeof url === "string" && url !== "",
    );
    return [...new Set(all)];
  }, [product]);

  // מוצר חדש נפתח — מתחילים ממארז/יחידה אחת ומהתמונה הראשית
  useEffect(() => {
    setQuantity(product ? minimumQuantity(product) : 1);
    setActiveImage(null);
    // מאפסים רק כשנפתח מוצר אחר — לא כשאותו מוצר נטען מחדש מהקטלוג
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id]);

  useBackToClose(product !== null, () => onOpenChange(false));

  if (!product) return null;

  const categoryPath = tree.byName.get(product.category)?.path ?? [product.category];
  const shownImage = activeImage ?? gallery[0] ?? null;
  const onSale = product.original_price !== null;
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
  const variations = (product.colors ?? []).filter((v) => v.trim() !== "");
  const addNow = () => {
    if (!onAddToCart || product.is_out_of_stock) return;
    onAddToCart(product, quantity);
    onOpenChange(false);
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        className="max-h-[92vh] gap-0 overflow-y-auto p-0 text-right sm:max-w-3xl"
      >
        <div className="grid md:grid-cols-2">
          {/* ---------- תמונה + גלריה ---------- */}
          <div className="bg-secondary/60 p-4 md:rounded-s-lg">
            <div className="relative flex h-64 items-center justify-center sm:h-80">
              {shownImage ? (
                <img
                  src={shownImage}
                  alt={product.name}
                  className="h-full w-full object-contain mix-blend-multiply"
                />
              ) : (
                <Package className="size-16 text-muted-foreground" />
              )}
              {product.is_out_of_stock && (
                <span className="absolute inset-x-0 bottom-2 mx-auto w-fit rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold text-muted-foreground">
                  אזל מהמלאי
                </span>
              )}
            </div>
            {gallery.length > 1 && (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {gallery.map((url) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setActiveImage(url)}
                    aria-label="הצגת תמונה"
                    className={cn(
                      "size-14 shrink-0 overflow-hidden rounded-md border-2 bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      url === shownImage ? "border-accent" : "border-transparent",
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
          <div className="flex flex-col gap-4 p-5 sm:p-6">
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{categoryPath.join(" › ")}</p>
              <DialogTitle className="font-display break-words text-2xl font-bold leading-tight text-foreground">
                {product.name}
              </DialogTitle>
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
              {product.price !== null ? (
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="numeric text-3xl font-bold text-accent">
                    {formatIls(product.price)}
                  </span>
                  {onSale && product.original_price !== null && (
                    <span className="numeric text-base text-muted-foreground line-through">
                      {formatIls(product.original_price)}
                    </span>
                  )}
                  {product.is_custom_price && (
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
            </div>

            <DialogDescription asChild>
              <div className="text-sm leading-7 text-foreground/90">
                {product.description?.trim() ? (
                  <p className="whitespace-pre-line break-words">{product.description}</p>
                ) : (
                  <p className="text-muted-foreground">אין תיאור למוצר הזה.</p>
                )}
              </div>
            </DialogDescription>

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

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <dt>מק"ט</dt>
              <dd dir="ltr" className="numeric text-right">
                {product.sku}
              </dd>
              {product.barcode && (
                <>
                  <dt>ברקוד</dt>
                  <dd dir="ltr" className="numeric text-right">
                    {product.barcode}
                  </dd>
                </>
              )}
            </dl>

            {canAdd && onAddToCart && (
              <div className="sticky bottom-0 -mx-5 mt-auto space-y-3 border-t border-border bg-background px-5 py-3 sm:-mx-6 sm:px-6 md:static md:mx-0 md:bg-transparent md:px-0 md:pb-0 md:pt-4">
                <QuantityPicker
                  item={product}
                  units={quantity}
                  onChange={setQuantity}
                  disabled={product.is_out_of_stock}
                  onSubmit={addNow}
                />
                <Button
                  type="button"
                  size="lg"
                  className="w-full"
                  disabled={product.is_out_of_stock}
                  onClick={addNow}
                >
                  <Plus className="size-4" />
                  {product.is_out_of_stock ? "אזל מהמלאי" : addLabel}
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
