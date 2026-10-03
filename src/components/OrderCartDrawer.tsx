import { useMemo } from "react";
import { useRouter } from "@tanstack/react-router";
import {
  ArrowLeft,
  Clock,
  FileText,
  KeyRound,
  Minus,
  Package,
  Plus,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatIls, minOrderMessage } from "@/lib/catalog";
import type { AddToCart } from "@/lib/cart";
import { hasVariants } from "@/lib/variants";
import {
  cartLineKey,
  cartNeedsShipping,
  cartMinimum,
  cartMinUnits,
  cartStep,
  cartCount,
  cartDepositTotal,
  cartTotal,
  depositPerUnit,
  type CartItem,
} from "@/lib/orders";
import { calculateVat, DEFAULT_VAT_RATE } from "@/lib/vat";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { useBackToClose } from "@/hooks/useBackToClose";
import { ORDER_HOURS } from "@/lib/order-hours";
import {
  cartSubtotal,
  freeShippingProgress,
  recommendForCart,
  type PromotionEvaluation,
} from "@/lib/cart-promotions";
import { useStorefrontSales } from "@/components/sales/StorefrontSalesContext";
import { ProductRecommendations } from "@/components/sales/ProductRecommendations";
import { FreeShippingBar } from "@/components/sales/FreeShippingBar";
import { CartGiftLines, PromotionHintLine } from "@/components/sales/CartGifts";

/** מצב הסל: הזמנה עם מחירים, או בקשת הצעת מחיר (כשלמוצרים אין מחיר) */
export type CartMode = "order" | "quote";

const NO_PROMOTIONS: PromotionEvaluation = { gifts: [], hints: [] };

/**
 * מגירת הסל.
 * בודקים את הסל וממשיכים לקופה (/checkout) — שם ממלאים פרטי חיוב ומשלוח
 * ושולחים, גם בלי חשבון. הסל "חכם": מד משלוח חינם, מתנות שנוספות ויורדות
 * לבד לפי הטבות החנות, והמלצות על מוצרים משלימים. מוצר הקופה (Order Bump)
 * מוצע בעמוד הקופה, ממש לפני אישור ההזמנה.
 */
export function OrderCartDrawer({
  open,
  onOpenChange,
  mode,
  signedIn,
  items,
  onChangeQuantity,
  onRemove,
  onAdd,
  promotions = NO_PROMOTIONS,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: CartMode;
  /** false = אורח (מוצג "אפשר להזמין בלי הרשמה") */
  signedIn: boolean;
  items: CartItem[];
  /** lineKey = מוצר + וריאציה (cartLineKey) */
  onChangeQuantity: (lineKey: string, delta: number) => void;
  onRemove: (lineKey: string) => void;
  /** הוספה מתוך הסל (המלצות); silent = בלי הודעה קופצת */
  onAdd?: AddToCart;
  /** מתנות שמגיעות לסל עכשיו + ההטבה הקרובה להשגה (מחושב בעמוד) */
  promotions?: PromotionEvaluation;
}) {
  const router = useRouter();
  const { settings } = useSiteSettings();
  const sales = useStorefrontSales();

  useBackToClose(open, () => onOpenChange(false));

  const priced = mode === "order";
  const isQuote = !priced;
  const shipping = priced
    ? freeShippingProgress(cartSubtotal(items), settings?.free_shipping_threshold)
    : null;
  const recommendations = useMemo(
    () =>
      sales && items.length > 0
        ? recommendForCart(items, {
            catalog: sales.catalog,
            catalogById: sales.catalogById,
            related: sales.related,
            // מוצר עם וריאציות צריך בחירה בחלון המוצר — לא "+" מהסל
          }).filter((item) => !hasVariants(item))
        : [],
    [sales, items],
  );
  const gifts = priced ? promotions.gifts : [];
  const nextHint = priced && items.length > 0 ? promotions.hints[0] : undefined;

  const count = cartCount(items);
  const vat = calculateVat(cartTotal(items), {
    pricesIncludeVat: settings?.prices_include_vat ?? true,
    vatRate: Number(settings?.vat_rate ?? DEFAULT_VAT_RATE),
  });
  const depositTotal = cartDepositTotal(items);
  const grandTotal = vat.gross + depositTotal;

  const goToCheckout = () => {
    // בדיקה לפני הקופה (נאכף גם במסד): אף שורה מתחת למינימום להזמנה
    const tooFew = items.find((item) => item.quantity < cartMinimum(item));
    if (tooFew) {
      toast.error(`${tooFew.name}: ${minOrderMessage(cartMinimum(tooFew))}`, { duration: 8000 });
      return;
    }
    if (items.length === 0) return;
    // replace: רשומת ההיסטוריה של המגירה הפתוחה מוחלפת בקופה — "חזור" מהקופה
    // מחזיר לקטלוג (ולא פותח שוב את המגירה)
    void router.navigate({ to: "/checkout", replace: true });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" dir="rtl" className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader className="text-right">
          <SheetTitle className="font-display flex items-center gap-2 text-lg">
            {isQuote ? <FileText className="size-5" /> : <ShoppingBag className="size-5" />}
            {isQuote ? "בקשת הצעת מחיר" : "הסל שלך"} ({count})
          </SheetTitle>
          <SheetDescription>
            {priced
              ? "בודקים את הסל וממשיכים לקופה — שם ממלאים פרטים למשלוח ושולחים את ההזמנה."
              : "בחרו את המוצרים שמעניינים אתכם ונחזור אליכם עם הצעת מחיר."}
          </SheetDescription>
        </SheetHeader>

        {shipping && items.length > 0 && (
          <div className="px-4 pt-3">
            <FreeShippingBar progress={shipping} />
          </div>
        )}

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {items.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              הסל ריק — הוסיפו מוצרים מהקטלוג
            </p>
          ) : (
            items.map((item) => (
              <div
                key={cartLineKey(item)}
                className="flex items-center gap-3 rounded-lg border border-border p-3"
              >
                <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary/60 p-1">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="size-full object-contain mix-blend-multiply"
                    />
                  ) : (
                    <Package className="size-6 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    title={item.name}
                    className="line-clamp-2 break-words text-sm font-bold leading-snug text-foreground"
                  >
                    {item.name}
                  </p>
                  {item.variantLabel && (
                    <p className="text-xs font-semibold text-foreground/80">{item.variantLabel}</p>
                  )}
                  {item.isDigital && (
                    <p className="flex items-center gap-1 text-[11px] font-medium text-sky-800 dark:text-sky-300">
                      <KeyRound className="size-3" aria-hidden="true" />
                      דיגיטלי — נשלח במייל
                    </p>
                  )}
                  {!isQuote && (
                    <p className="numeric text-xs text-muted-foreground">
                      {formatIls(item.price)} ליחידה
                    </p>
                  )}
                  {item.hasDeposit && (
                    <p className="numeric text-xs text-muted-foreground">
                      + פיקדון {formatIls(depositPerUnit(item))}
                      {cartStep(item) > 1 ? " ליחידה" : " למארז"}
                    </p>
                  )}
                  <div className="mt-1 flex items-center gap-2">
                    <Button
                      size="icon"
                      variant="outline"
                      className="size-7"
                      aria-label={`הוספת כמות של ${item.name}`}
                      onClick={() => onChangeQuantity(cartLineKey(item), 1)}
                    >
                      <Plus className="size-3.5" />
                    </Button>
                    <span className="numeric min-w-6 text-center text-sm font-bold">
                      {cartStep(item) > 1 ? item.quantity / cartStep(item) : item.quantity}
                    </span>
                    <Button
                      size="icon"
                      variant="outline"
                      className="size-7"
                      aria-label={`הפחתת כמות של ${item.name}`}
                      disabled={item.quantity <= cartStep(item) && cartMinUnits(item) <= 1}
                      onClick={() => onChangeQuantity(cartLineKey(item), -1)}
                    >
                      <Minus className="size-3.5" />
                    </Button>
                  </div>
                  {cartMinUnits(item) > 1 && (
                    <p className="mt-1 text-xs font-medium text-foreground/80">
                      מינימום להזמנה: <span className="numeric">{cartMinUnits(item)}</span> יח׳
                    </p>
                  )}
                  {cartStep(item) > 1 && (
                    <p className="numeric mt-1 text-xs text-muted-foreground">
                      {item.quantity / cartStep(item) === 1
                        ? `מארז אחד = ${item.quantity} יחידות`
                        : `${item.quantity / cartStep(item)} מארזים = ${item.quantity} יחידות`}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  {!isQuote && (
                    <span className="numeric text-sm font-bold text-accent">
                      {formatIls(item.price * item.quantity)}
                    </span>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 text-destructive hover:text-destructive"
                    aria-label={`הסרת ${item.name} מהסל`}
                    onClick={() => onRemove(cartLineKey(item))}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))
          )}

          <CartGiftLines gifts={gifts} />
          {nextHint && <PromotionHintLine hint={nextHint} />}

          {items.length > 0 && (
            <p className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/10 p-3 text-xs leading-5 text-foreground">
              <Clock className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
              <span>{ORDER_HOURS.cart}</span>
            </p>
          )}

          {recommendations.length > 0 && (
            <div className="pt-2">
              <ProductRecommendations
                compact
                title="כדאי להוסיף"
                items={recommendations}
                addLabel={isQuote ? "הוספה לבקשה" : "הוספה לסל"}
                onAdd={onAdd ? (item) => onAdd(item) : undefined}
              />
            </div>
          )}
        </div>

        <div className="space-y-3 border-t border-border p-4">
          {priced && items.length > 0 && (
            <div className="space-y-1.5 text-sm">
              {vat.showBreakdown && (
                <>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>סה״כ לפני מע״מ</span>
                    <span className="numeric">{formatIls(vat.net)}</span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>מע״מ {vat.vatRate}%</span>
                    <span className="numeric">{formatIls(vat.vat)}</span>
                  </div>
                </>
              )}
              {depositTotal > 0 && (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>פיקדון</span>
                  <span className="numeric">{formatIls(depositTotal)}</span>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-border pt-2 text-base">
                <span className="font-medium">סה״כ לתשלום</span>
                <span className="numeric text-xl font-bold text-accent">
                  {formatIls(grandTotal)}
                </span>
              </div>
              {!vat.showBreakdown && (
                <p className="text-xs text-muted-foreground">המחירים כוללים מע״מ</p>
              )}
              {cartNeedsShipping(items) && (
                <p className="text-xs text-muted-foreground">
                  דמי משלוח (אם יש) — לפי השיטה שתבחרו בקופה
                </p>
              )}
            </div>
          )}

          <Button size="lg" className="w-full" disabled={items.length === 0} onClick={goToCheckout}>
            {isQuote ? "המשך לשליחת הבקשה" : "המשך לקופה"}
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Button>
          {!signedIn && items.length > 0 && (
            <p className="text-center text-xs text-muted-foreground">
              אין צורך בהרשמה — אפשר להזמין כאורח
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
