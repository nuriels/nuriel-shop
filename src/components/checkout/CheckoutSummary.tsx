import { useState } from "react";
import { ChevronDown, Loader2, Minus, Package, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatIls } from "@/lib/catalog";
import {
  cartCount,
  cartDepositTotal,
  cartMinUnits,
  cartStep,
  cartTotal,
  type CartItem,
} from "@/lib/orders";
import type { VatBreakdown } from "@/lib/vat";
import type { FreeShippingProgress, GiftLine } from "@/lib/cart-promotions";
import { FreeShippingBar } from "@/components/sales/FreeShippingBar";
import { CartGiftLines } from "@/components/sales/CartGifts";
import { cn } from "@/lib/utils";

/**
 * סיכום ההזמנה בקופה: הפריטים (עם שינוי כמות / הסרה), מתנות, משלוח חינם
 * והסכומים. בטלפון — שורה מקופלת בראש העמוד ("סיכום ההזמנה · ₪..."), שנפתחת
 * בלחיצה; במחשב — עמודה צדדית שנשארת בתצוגה בזמן הגלילה.
 */
export function CheckoutSummary({
  items,
  priced,
  vat,
  gifts,
  shipping,
  loading,
  onChangeQuantity,
  onRemove,
}: {
  items: CartItem[];
  priced: boolean;
  vat: VatBreakdown;
  gifts: GiftLine[];
  shipping: FreeShippingProgress | null;
  /** הקטלוג עוד נטען — המחירים עשויים להתעדכן */
  loading: boolean;
  onChangeQuantity: (productId: string, delta: number) => void;
  onRemove: (productId: string) => void;
}) {
  const [openOnMobile, setOpenOnMobile] = useState(false);
  const count = cartCount(items);
  const depositTotal = cartDepositTotal(items);
  const grandTotal = vat.gross + depositTotal;

  return (
    <Card className="overflow-hidden shadow-card lg:sticky lg:top-[calc(var(--site-header-h,0px)+1rem)]">
      <CardContent className="space-y-4 p-0">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-4 pt-4 text-right lg:pointer-events-none"
          aria-expanded={openOnMobile}
          aria-controls="checkout-summary-body"
          onClick={() => setOpenOnMobile((value) => !value)}
        >
          <span className="flex items-center gap-2 font-bold text-foreground">
            <ShoppingBag className="size-4 text-accent" aria-hidden="true" />
            סיכום ההזמנה
            <span className="numeric text-sm font-normal text-muted-foreground">
              ({count} פריטים)
            </span>
          </span>
          <span className="flex items-center gap-2">
            {priced && (
              <span className="numeric font-bold text-accent lg:hidden">
                {formatIls(grandTotal)}
              </span>
            )}
            <ChevronDown
              className={cn(
                "size-4 text-muted-foreground transition-transform lg:hidden",
                openOnMobile && "rotate-180",
              )}
              aria-hidden="true"
            />
          </span>
        </button>

        <div
          id="checkout-summary-body"
          className={cn("space-y-4 px-4 pb-4", !openOnMobile && "hidden lg:block")}
        >
          {shipping && items.length > 0 && <FreeShippingBar progress={shipping} />}

          <ul className="max-h-[22rem] space-y-3 overflow-y-auto pe-1" aria-label="הפריטים בהזמנה">
            {items.map((item) => (
              <li key={item.productId} className="flex items-start gap-3">
                <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-secondary/50 p-1">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="size-full object-contain mix-blend-multiply"
                    />
                  ) : (
                    <Package className="size-5 text-muted-foreground" aria-hidden="true" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    title={item.name}
                    className="line-clamp-2 text-sm font-semibold leading-snug text-foreground"
                  >
                    {item.name}
                  </p>
                  {priced && (
                    <p className="numeric text-xs text-muted-foreground">
                      {formatIls(item.price)} ליחידה
                    </p>
                  )}
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <Button
                      type="button"
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
                      type="button"
                      size="icon"
                      variant="outline"
                      className="size-7"
                      aria-label={`הפחתת כמות של ${item.name}`}
                      disabled={item.quantity <= cartStep(item) && cartMinUnits(item) <= 1}
                      onClick={() => onChangeQuantity(item.productId, -1)}
                    >
                      <Minus className="size-3.5" />
                    </Button>
                    {cartStep(item) > 1 && (
                      <span className="numeric text-xs text-muted-foreground">
                        מארזים ({item.quantity} יח׳)
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {priced && (
                    <span className="numeric text-sm font-bold text-foreground">
                      {formatIls(item.price * item.quantity)}
                    </span>
                  )}
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7 text-destructive hover:text-destructive"
                    aria-label={`הסרת ${item.name} מההזמנה`}
                    onClick={() => onRemove(item.productId)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          <CartGiftLines gifts={gifts} />

          {priced ? (
            <dl className="space-y-1.5 border-t border-border pt-3 text-sm">
              {vat.showBreakdown ? (
                <>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <dt>סה״כ לפני מע״מ</dt>
                    <dd className="numeric">{formatIls(vat.net)}</dd>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <dt>מע״מ {vat.vatRate}%</dt>
                    <dd className="numeric">{formatIls(vat.vat)}</dd>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between text-muted-foreground">
                  <dt>סה״כ מוצרים</dt>
                  <dd className="numeric">{formatIls(cartTotal(items))}</dd>
                </div>
              )}
              {depositTotal > 0 && (
                <div className="flex items-center justify-between text-muted-foreground">
                  <dt>פיקדון</dt>
                  <dd className="numeric">{formatIls(depositTotal)}</dd>
                </div>
              )}
              {shipping?.reached && (
                <div className="flex items-center justify-between text-green-700">
                  <dt>משלוח</dt>
                  <dd className="font-semibold">חינם</dd>
                </div>
              )}
              <div className="flex items-center justify-between border-t border-border pt-2 text-base">
                <dt className="font-bold">סה״כ לתשלום</dt>
                <dd className="numeric flex items-center gap-2 text-xl font-bold text-accent">
                  {loading && (
                    <Loader2
                      className="size-4 animate-spin text-muted-foreground"
                      aria-label="מעדכן מחירים"
                    />
                  )}
                  {formatIls(grandTotal)}
                </dd>
              </div>
              {!vat.showBreakdown && <p className="text-xs text-muted-foreground">כולל מע״מ</p>}
            </dl>
          ) : (
            <p className="rounded-lg bg-secondary/60 p-3 text-xs leading-5 text-muted-foreground">
              בקשה להצעת מחיר — בלי מחירים. נציג יחזור אליכם עם הצעה מותאמת.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
