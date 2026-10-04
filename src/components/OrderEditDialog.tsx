import { useEffect, useState } from "react";
import { OrderContactBlock } from "@/components/OrderContactBlock";
import { Loader2, Package, Store, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatIls } from "@/lib/catalog";
import { ORDER_STATUSES, ORDER_STATUS_LABEL, type OrderRow, type OrderStatus } from "@/lib/orders";
import { calculateVat } from "@/lib/vat";
import { orderCouponDiscount, orderDiscountLabel } from "@/lib/coupons";
import { orderShippingLabel } from "@/lib/shipping";

type Draft = {
  id: string;
  name: string;
  barcode: string | null;
  quantity: number;
  unitPrice: number;
  removed: boolean;
  /** שורת פיקדון / מתנה — לא נספרת לסף המשלוח החינם */
  extra: boolean;
};

/**
 * עריכת הזמנה: סטטוס, כמות/מחיר לכל פריט ומחיקת פריטים.
 * בבקשת הצעת מחיר אפשר גם לתמחר את הפריטים ולהמיר אותה להזמנה מחייבת.
 */
export function OrderEditDialog({
  order,
  onClose,
  onSaved,
}: {
  order: OrderRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<OrderStatus>("pending");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [convertToOrder, setConvertToOrder] = useState(false);
  const [shipping, setShipping] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!order) return;
    setStatus(order.status);
    setConvertToOrder(false);
    setShipping(String(Number(order.shipping_base_price ?? order.shipping_price ?? 0)));
    setDrafts(
      order.order_items.map((item) => ({
        id: item.id,
        name: item.product_name ?? "מוצר",
        barcode: item.product_barcode,
        quantity: item.quantity,
        unitPrice: Number(item.unit_price),
        removed: false,
        extra: item.is_deposit || item.is_gift === true,
      })),
    );
  }, [order]);

  if (!order) return null;

  const isQuote = order.kind === "quote";
  const itemsTotal = drafts
    .filter((d) => !d.removed)
    .reduce((sum, d) => sum + d.quantity * d.unitPrice, 0);
  // דמי המשלוח: מה שהוזן כאן. בלי שינוי — כמו במסד: חינם אם סכום המוצרים
  // עדיין מעל סף המשלוח החינם שהיה בעת ההזמנה
  const shippingInput = Math.max(0, Number(shipping) || 0);
  const shippingChanged = shippingInput !== Number(order.shipping_base_price ?? 0);
  const productsTotal = drafts
    .filter((d) => !d.removed && !d.extra)
    .reduce((sum, d) => sum + d.quantity * d.unitPrice, 0);
  const threshold = order.shipping_free_threshold ?? null;
  const shippingCharge =
    isQuote && !convertToOrder
      ? 0
      : !shippingChanged && threshold !== null && productsTotal >= Number(threshold)
        ? 0
        : shippingInput;
  const shippingName = orderShippingLabel(order);
  const showShipping =
    order.shipping_kind !== "digital" &&
    (shippingName !== null || Number(order.shipping_price ?? 0) > 0 || order.kind === "order");
  // הנחת קופון (חלק 14) — לפי התנאים שצולמו בהזמנה, על המוצרים אחרי העריכה
  const discount = isQuote && !convertToOrder ? 0 : orderCouponDiscount(order, productsTotal);
  const activeTotal = itemsTotal + shippingCharge - discount;
  const vat = calculateVat(activeTotal, {
    pricesIncludeVat: order.prices_include_vat ?? true,
    vatRate: Number(order.vat_rate ?? 18),
  });

  const save = async () => {
    setBusy(true);
    try {
      const toRemove = drafts.filter((d) => d.removed).map((d) => d.id);
      const toUpdate = drafts.filter((d) => !d.removed);

      if (toRemove.length > 0) {
        const { error } = await supabase.from("order_items").delete().in("id", toRemove);
        if (error) throw error;
      }
      for (const item of toUpdate) {
        const { error } = await supabase
          .from("order_items")
          .update({ quantity: item.quantity, unit_price: item.unitPrice })
          .eq("id", item.id);
        if (error) throw error;
      }
      const orderPatch: {
        status?: OrderStatus;
        kind?: "order" | "quote";
        shipping_price?: number;
      } = {};
      if (status !== order.status) orderPatch.status = status;
      if (isQuote && convertToOrder) orderPatch.kind = "order";
      // דמי משלוח שהשתנו ביד — זה המחיר מעכשיו (המסד מעדכן את הסכום הכולל)
      if (showShipping && shippingChanged) orderPatch.shipping_price = shippingInput;
      if (Object.keys(orderPatch).length > 0) {
        const { error } = await supabase.from("orders").update(orderPatch).eq("id", order.id);
        if (error) throw error;
      }
      toast.success(
        isQuote && convertToOrder ? "הבקשה תומחרה והומרה להזמנה" : "ההזמנה עודכנה בהצלחה",
      );
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "עדכון ההזמנה נכשל");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto text-right sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isQuote ? "בקשה להצעת מחיר" : "עריכת הזמנה"} {order.order_number}
          </DialogTitle>
          <DialogDescription>
            {isQuote
              ? "אפשר לתמחר את הפריטים ולהמיר את הבקשה להזמנה מחייבת"
              : "שינוי סטטוס, כמויות, מחירים או מחיקת פריטים"}
          </DialogDescription>
        </DialogHeader>

        {/* פרטי המזמין והמשלוח מהקופה (כתובת חלופית — מודגשת) */}
        <OrderContactBlock order={order} />
        {order.note && (
          <p className="rounded-lg bg-secondary/60 p-2.5 text-sm">
            <strong>הערות הלקוח: </strong>
            {order.note}
          </p>
        )}

        <div className="space-y-2">
          <Label>סטטוס הזמנה</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as OrderStatus)}>
            <SelectTrigger dir="rtl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent dir="rtl">
              {ORDER_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {ORDER_STATUS_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          {drafts.map((item, index) => (
            <div
              key={item.id}
              className={`grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 rounded-lg border border-border/60 p-3 ${
                item.removed ? "opacity-40" : ""
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <Package className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span
                    title={item.name}
                    className="line-clamp-2 break-words text-sm font-bold leading-snug"
                  >
                    {item.name}
                  </span>
                  {item.barcode && (
                    <span
                      dir="ltr"
                      className="numeric block text-right text-xs text-muted-foreground"
                    >
                      {item.barcode}
                    </span>
                  )}
                </span>
              </div>
              <Input
                type="number"
                min={1}
                disabled={item.removed}
                className="h-9 w-16 text-center"
                value={item.quantity}
                onChange={(e) =>
                  setDrafts((cur) =>
                    cur.map((d, i) =>
                      i === index
                        ? { ...d, quantity: Math.max(1, Number(e.target.value) || 1) }
                        : d,
                    ),
                  )
                }
              />
              <Input
                type="number"
                min={0}
                step="any"
                disabled={item.removed}
                className="h-9 w-24 text-center"
                value={item.unitPrice}
                onChange={(e) =>
                  setDrafts((cur) =>
                    cur.map((d, i) =>
                      i === index
                        ? { ...d, unitPrice: Math.max(0, Number(e.target.value) || 0) }
                        : d,
                    ),
                  )
                }
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="הסרת פריט"
                className="text-destructive hover:text-destructive"
                onClick={() =>
                  setDrafts((cur) =>
                    cur.map((d, i) => (i === index ? { ...d, removed: !d.removed } : d)),
                  )
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>

        {showShipping && (
          <div className="grid items-end gap-2 rounded-lg border border-border/60 p-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <div className="min-w-0 space-y-0.5">
              <Label htmlFor="edit-shipping" className="flex items-center gap-1.5">
                {order.shipping_kind === "pickup" ? (
                  <Store className="size-4 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <Truck className="size-4 text-muted-foreground" aria-hidden="true" />
                )}
                דמי משלוח{shippingName ? ` — ${shippingName}` : ""}
              </Label>
              <p className="text-xs text-muted-foreground">
                {!shippingChanged && threshold !== null
                  ? productsTotal >= Number(threshold)
                    ? `חינם — המוצרים מעל ${formatIls(Number(threshold))}`
                    : `חינם מעל ${formatIls(Number(threshold))} (כרגע ${formatIls(productsTotal)})`
                  : "שינוי כאן קובע את דמי המשלוח של ההזמנה הזו"}
              </p>
            </div>
            <Input
              id="edit-shipping"
              type="number"
              min={0}
              step="any"
              className="h-9 text-center"
              value={shipping}
              onChange={(event) => setShipping(event.target.value)}
            />
          </div>
        )}

        {isQuote && (
          <label className="flex items-center justify-between gap-3 rounded-lg border border-accent/40 bg-accent/5 p-3">
            <span className="space-y-1">
              <span className="block text-sm font-medium">להמיר את הבקשה להזמנה מחייבת</span>
              <span className="block text-xs text-muted-foreground">
                אחרי ההמרה הלקוח יראה מחירים במסמך ובעמוד ההזמנות שלו.
              </span>
            </span>
            <Switch checked={convertToOrder} onCheckedChange={setConvertToOrder} />
          </label>
        )}

        <div className="space-y-1.5 border-t border-border pt-4 text-sm">
          {discount > 0 && (
            <div className="flex items-center justify-between text-green-700 dark:text-green-400">
              <span>{orderDiscountLabel(order)}</span>
              <span className="numeric">-{formatIls(discount)}</span>
            </div>
          )}
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
          <div className="flex items-center justify-between text-base">
            <span className="font-medium">סה״כ מעודכן</span>
            <span className="numeric text-xl font-bold text-accent">{formatIls(vat.gross)}</span>
          </div>
        </div>

        <Button size="lg" className="w-full" disabled={busy} onClick={save}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy ? "שומר..." : "שמירת שינויים"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
