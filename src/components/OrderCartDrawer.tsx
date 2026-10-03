import { useMemo, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  Clock,
  FileText,
  Gift,
  Minus,
  Package,
  Plus,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatIls, minimumQuantity, minOrderMessage, type CatalogItem } from "@/lib/catalog";
import {
  cartMinimum,
  cartMinUnits,
  cartStep,
  cartCount,
  cartDepositTotal,
  cartTotal,
  depositPerUnit,
  type CartItem,
} from "@/lib/orders";
import { sendOrderEmails } from "@/lib/email.functions";
import { calculateVat, DEFAULT_VAT_RATE } from "@/lib/vat";
import { clearStoredCart } from "@/hooks/useCartSync";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { useBackToClose } from "@/hooks/useBackToClose";
import { ORDER_HOURS } from "@/lib/order-hours";
import {
  cartSubtotal,
  freeShippingProgress,
  pickOrderBump,
  recommendForCart,
  type PromotionEvaluation,
} from "@/lib/cart-promotions";
import { useStorefrontSales } from "@/components/sales/StorefrontSalesContext";
import { ProductRecommendations } from "@/components/sales/ProductRecommendations";
import { FreeShippingBar } from "@/components/sales/FreeShippingBar";
import { CartGiftLines, PromotionHintLine } from "@/components/sales/CartGifts";
import { OrderBumpOffer } from "@/components/sales/OrderBumpOffer";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** מצב הסל: הזמנה עם מחירים, בקשת הצעת מחיר, או אורח שעדיין לא התחבר */
export type CartMode = "order" | "quote" | "guest";

const NO_PROMOTIONS: PromotionEvaluation = { gifts: [], hints: [] };

/**
 * סל ההזמנה.
 * לקוח עם קבוצת מחיר רואה מחירים ושולח הזמנה; לקוח בלי קבוצת מחיר רואה
 * את אותם פריטים בלי מחירים ושולח "בקשה להצעת מחיר"; אורח מתבקש להתחבר.
 *
 * בהזמנה עם מחירים הסל גם "חכם": מד משלוח חינם, מתנות שנוספות ויורדות לבד
 * לפי הטבות החנות, מוצר קופה ממש לפני השליחה, והמלצות על מוצרים משלימים.
 */
export function OrderCartDrawer({
  open,
  onOpenChange,
  mode,
  customerId,
  items,
  onChangeQuantity,
  onRemove,
  onClear,
  onAdd,
  promotions = NO_PROMOTIONS,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: CartMode;
  customerId: string | null;
  items: CartItem[];
  onChangeQuantity: (productId: string, delta: number) => void;
  onRemove: (productId: string) => void;
  onClear: () => void;
  /** הוספה מתוך הסל (מוצר קופה / המלצה); silent = בלי הודעה קופצת */
  onAdd?: (item: CatalogItem, quantity?: number, options?: { silent?: boolean }) => void;
  /** מתנות שמגיעות לסל עכשיו + ההטבה הקרובה להשגה (מחושב בעמוד) */
  promotions?: PromotionEvaluation;
}) {
  const router = useRouter();
  const { settings } = useSiteSettings();
  const sales = useStorefrontSales();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{
    orderNumber: string;
    isQuote: boolean;
    gifts: string[];
  } | null>(null);
  // מוצר שנוסף דרך הצעת הקופה בפתיחה הזו של הסל — נשאר מוצג (מסומן) כדי שאפשר להתחרט
  const [bumpKeepId, setBumpKeepId] = useState<string | null>(null);
  const sendEmails = useServerFn(sendOrderEmails);

  useBackToClose(open, () => onOpenChange(false));

  const priced = mode === "order";
  const cartIds = useMemo(() => new Set(items.map((item) => item.productId)), [items]);
  const shipping = priced
    ? freeShippingProgress(cartSubtotal(items), settings?.free_shipping_threshold)
    : null;
  const bump =
    priced && sales && onAdd && items.length > 0
      ? pickOrderBump({
          bumps: sales.bumps,
          catalogById: sales.catalogById,
          cartIds,
          keepId: bumpKeepId,
        })
      : null;
  const recommendations = useMemo(
    () =>
      sales && items.length > 0
        ? recommendForCart(items, {
            catalog: sales.catalog,
            catalogById: sales.catalogById,
            related: sales.related,
            // מוצר הקופה כבר מוצע למטה — לא כפול
            exclude: new Set(bump ? [bump.product.id] : []),
          })
        : [],
    [sales, items, bump],
  );
  const gifts = priced ? promotions.gifts : [];
  const nextHint = priced && items.length > 0 ? promotions.hints[0] : undefined;

  const toggleBump = (next: boolean) => {
    if (!bump || !onAdd) return;
    if (next) {
      onAdd(bump.product, minimumQuantity(bump.product), { silent: true });
      setBumpKeepId(bump.product.id);
    } else {
      onRemove(bump.product.id);
    }
  };

  const isQuote = mode !== "order";
  const count = cartCount(items);
  const vat = calculateVat(cartTotal(items), {
    pricesIncludeVat: settings?.prices_include_vat ?? true,
    vatRate: Number(settings?.vat_rate ?? DEFAULT_VAT_RATE),
  });
  const depositTotal = cartDepositTotal(items);
  const grandTotal = vat.gross + depositTotal;

  const submit = async () => {
    // בדיקה אחרונה לפני שליחה (נאכף גם במסד): אף שורה מתחת למינימום להזמנה
    const tooFew = items.find((item) => item.quantity < cartMinimum(item));
    if (tooFew) {
      toast.error(`${tooFew.name}: ${minOrderMessage(cartMinimum(tooFew))}`, { duration: 8000 });
      return;
    }
    if (items.length === 0 || customerId === null) return;
    setBusy(true);
    const kind = mode === "order" ? "order" : "quote";

    // כל פריט עם פיקדון מקבל שורת הזמנה נוספת על אותו product_id
    // (is_deposit=true) — המחיר נקבע בטריגר בשרת לפי deposit_price *
    // deposit_units של המוצר, ולא נשלח מהדפדפן.
    const rows = items.flatMap((item) => {
      const base = {
        product_id: item.productId,
        quantity: item.quantity,
        unit_price: kind === "quote" ? 0 : item.price,
      };
      if (!item.hasDeposit) return [base];
      return [base, { ...base, unit_price: 0, is_deposit: true }];
    });

    // הזמנה + שורות בפעולה אחת במסד: אם שורה נדחית (מלאי, מארז, מוצר שהוסתר)
    // לא נשארת הזמנה ריקה, והלקוח מקבל את הסיבה המדויקת
    const { data: created, error } = await supabase.rpc("place_order", {
      _kind: kind,
      _items: rows,
      // מצב המע"מ מצולם לתוך ההזמנה, כדי שהמסמך ישקף תמיד את מה שהוצג
      _vat_rate: Number(settings?.vat_rate ?? DEFAULT_VAT_RATE),
      _prices_include_vat: settings?.prices_include_vat ?? true,
    });
    setBusy(false);
    const order = created?.[0];
    if (error || !order) {
      toast.error(error?.message ?? "שליחת הסל נכשלה", { duration: 8000 });
      return;
    }

    // המתנות שהמסד צירף בפועל (הוא בודק שוב את תנאי ההטבה מול המחירים שלו)
    let giftNames: string[] = [];
    if (kind === "order") {
      const { data: giftRows } = await supabase
        .from("order_items")
        .select("product_name, quantity")
        .eq("order_id", order.id)
        .eq("is_gift", true);
      giftNames = (giftRows ?? []).map((row) =>
        row.quantity > 1 ? `${row.product_name} × ${row.quantity}` : (row.product_name ?? ""),
      );
    }

    // חלון אישור (לא הודעה חולפת): מספר ההזמנה + שעות הטיפול + מה קורה עכשיו
    setSent({ orderNumber: order.order_number, isQuote: kind === "quote", gifts: giftNames });
    setBumpKeepId(null);
    onClear();
    await clearStoredCart(customerId);
    onOpenChange(false);
    try {
      await sendEmails({ data: { orderId: order.id } });
    } catch {
      // כשל שליחת מייל אינו מבטל את ההזמנה — היא כבר נקלטה
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="left" dir="rtl" className="flex w-full flex-col gap-0 sm:max-w-md">
          <SheetHeader className="text-right">
            <SheetTitle className="font-display flex items-center gap-2 text-lg">
              {isQuote ? <FileText className="size-5" /> : <ShoppingBag className="size-5" />}
              {isQuote ? "בקשת הצעת מחיר" : "סל ההזמנה שלך"} ({count})
            </SheetTitle>
            <SheetDescription>
              {mode === "order"
                ? "ההזמנה תיסקר ותאושר על ידי הסוכן המטפל. הכמויות שמורות לך מרגע השליחה."
                : "בחרו את המוצרים שמעניינים אתכם ונחזור אליכם עם הצעת מחיר לעסק."}
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
                  key={item.productId}
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
                        onClick={() => onChangeQuantity(item.productId, 1)}
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
                        onClick={() => onChangeQuantity(item.productId, -1)}
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
                      onClick={() => onRemove(item.productId)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}

            <CartGiftLines gifts={gifts} />
            {nextHint && <PromotionHintLine hint={nextHint} />}

            {mode !== "guest" && items.length > 0 && (
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
            {bump && (
              <OrderBumpOffer
                offer={bump}
                checked={cartIds.has(bump.product.id)}
                onToggle={toggleBump}
              />
            )}
            {mode === "order" && (
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
              </div>
            )}

            {mode === "guest" ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  כדי לשלוח את הרשימה ולקבל הצעת מחיר יש להתחבר או לפתוח חשבון עסקי.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button size="lg" onClick={() => router.navigate({ to: "/register" })}>
                    פתיחת חשבון
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={() => router.navigate({ to: "/login" })}
                  >
                    התחברות
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <Button
                  size="lg"
                  className="w-full"
                  disabled={busy || items.length === 0}
                  onClick={submit}
                >
                  {busy ? "שולח..." : isQuote ? "שליחת בקשה להצעת מחיר" : "שליחת הזמנה"}
                </Button>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={sent !== null} onOpenChange={(next) => !next && setSent(null)}>
        <AlertDialogContent dir="rtl" className="text-right">
          <AlertDialogHeader className="text-right">
            <div className="mb-1 flex size-11 items-center justify-center rounded-full bg-accent/15 text-accent">
              <CheckCircle2 className="size-6" aria-hidden="true" />
            </div>
            <AlertDialogTitle className="text-right text-lg">
              {sent?.isQuote ? "בקשת הצעת המחיר נשלחה בהצלחה!" : ORDER_HOURS.sentTitle}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-right text-sm leading-6 text-foreground">
                <p className="text-muted-foreground">
                  {sent?.isQuote ? "מספר בקשה" : "מספר הזמנה"}:{" "}
                  <span dir="ltr" className="numeric font-semibold text-foreground">
                    {sent?.orderNumber}
                  </span>
                </p>
                {sent && sent.gifts.length > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-green-600/30 bg-green-50 p-3 text-green-900">
                    <Gift className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    <span>
                      צירפנו להזמנה במתנה: <strong>{sent.gifts.join(", ")}</strong>
                    </span>
                  </div>
                )}
                <p className="flex items-start gap-2 rounded-lg bg-secondary/70 p-3">
                  <Clock className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
                  <span>{ORDER_HOURS.sentHours}</span>
                </p>
                <p className="font-medium">
                  {sent?.isQuote ? "נציג יחזור אליך עם הצעת מחיר בהקדם." : ORDER_HOURS.sentContact}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction className="w-full sm:w-auto">הבנתי</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
