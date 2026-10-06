import {
  Gift,
  KeyRound,
  Loader2,
  MapPin,
  Package,
  Receipt,
  RotateCcw,
  StickyNote,
  Store,
  TicketPercent,
  Truck,
  UserRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PaymentBadge } from "@/components/orders/PaymentBadge";
import { BitPayNowLink } from "@/components/orders/BitPayNowLink";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OrderDocumentButton } from "@/components/OrderDocumentButton";
import { OrderStatusSteps } from "@/components/account/OrderStatusSteps";
import { PickupNotice } from "@/components/checkout/PickupNotice";
import { formatIls, formatUnitIls } from "@/lib/catalog";
import {
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABEL,
  formatOrderDate,
  type OrderRow,
} from "@/lib/orders";
import { billingOf, deliveryOf, type ProfileContact } from "@/lib/order-details";
import { calculateVat } from "@/lib/vat";
import { useBackToClose } from "@/hooks/useBackToClose";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { DigitalBadge, ItemStatusBadge, LicenseKeyDisplay } from "@/components/OrderItemExtras";
import { hasShippingLine, orderShippingLabel, shippingWasFree } from "@/lib/shipping";
import { orderDiscount, orderDiscountLabel } from "@/lib/coupons";
import { OrderTrackingInfo } from "@/components/account/OrderTrackingInfo";

/**
 * פירוט הזמנה / קבלה ללקוח: מצב ההזמנה, הפריטים, הסכומים (כולל מע"מ),
 * פרטי החיוב והמשלוח כפי שנקלטו בקופה, הערות — ומסמך PDF + הזמנה חוזרת.
 */
export function OrderDetailsDialog({
  order,
  onClose,
  agentName,
  profile,
  accountEmail,
  onReorder,
  reordering,
}: {
  order: OrderRow | null;
  onClose: () => void;
  agentName: string | null;
  profile: ProfileContact | null;
  accountEmail: string | null;
  onReorder: (orderId: string) => void;
  reordering: boolean;
}) {
  useBackToClose(order !== null, onClose);
  return (
    <Dialog open={order !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        {order && (
          <OrderDetails
            order={order}
            agentName={agentName}
            profile={profile}
            accountEmail={accountEmail}
            onReorder={onReorder}
            reordering={reordering}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function OrderDetails({
  order,
  agentName,
  profile,
  accountEmail,
  onReorder,
  reordering,
}: {
  order: OrderRow;
  agentName: string | null;
  profile: ProfileContact | null;
  accountEmail: string | null;
  onReorder: (orderId: string) => void;
  reordering: boolean;
}) {
  const { settings } = useSiteSettings();
  const isQuote = order.kind === "quote";
  const shippingAmount = hasShippingLine(order) ? Number(order.shipping_price ?? 0) : 0;
  // הנחת קופון (חלק 14) — מופחתת, כמו ב-total במסד
  const discount = isQuote ? 0 : orderDiscount(order);
  // הסכום כולל את דמי המשלוח (כמו total במסד) — גם לחישוב המע"מ
  const itemsTotal =
    order.order_items.reduce((sum, item) => sum + Number(item.unit_price) * item.quantity, 0) +
    shippingAmount -
    discount;
  const shippingLabel = orderShippingLabel(order);
  const pickupAddress = settings?.business_address?.trim() ?? "";
  const vat = calculateVat(itemsTotal, {
    pricesIncludeVat: order.prices_include_vat ?? true,
    vatRate: Number(order.vat_rate ?? 18),
  });
  const billing = billingOf(order, profile, accountEmail);
  const delivery = deliveryOf(order, profile);
  const products = order.order_items.filter((item) => !item.is_deposit);
  const deposits = order.order_items.filter((item) => item.is_deposit);
  const depositTotal = deposits.reduce(
    (sum, item) => sum + Number(item.unit_price) * item.quantity,
    0,
  );

  return (
    <div className="space-y-5">
      <DialogHeader className="space-y-2 text-right">
        <div className="flex flex-wrap items-center gap-2">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Receipt className="size-5 text-accent" aria-hidden="true" />
            {isQuote ? "בקשה להצעת מחיר" : "הזמנה"}{" "}
            <span dir="ltr" className="numeric">
              {order.order_number}
            </span>
          </DialogTitle>
          <Badge variant={ORDER_STATUS_BADGE[order.status]}>
            {ORDER_STATUS_LABEL[order.status]}
          </Badge>
          <PaymentBadge status={order.payment_status} method={order.payment_method} />
        </div>
        <DialogDescription className="text-right">
          {formatOrderDate(order.created_at)}
          {agentName ? ` · סוכן מטפל: ${agentName}` : ""}
        </DialogDescription>
        <BitPayNowLink order={order} className="w-fit" />
      </DialogHeader>

      <OrderStatusSteps status={order.status} attempts={order.delivery_attempts ?? 0} />
      {/* חלק 24: מספר מעקב וקישור למעקב — כשהחנות הזינה */}
      <OrderTrackingInfo order={order} />

      {/* ---------- פריטים ---------- */}
      <section aria-label="פריטים" className="rounded-xl border border-border">
        <ul className="divide-y divide-border">
          {products.map((item) => (
            <li key={item.id} className="flex items-center gap-3 p-3">
              <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary/60 p-1">
                {item.product_image_url ? (
                  <img
                    src={item.product_image_url}
                    alt=""
                    loading="lazy"
                    className="size-full object-contain mix-blend-multiply"
                  />
                ) : (
                  <Package className="size-5 text-muted-foreground" aria-hidden="true" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-semibold text-foreground">
                  {item.product_name ?? "מוצר"}
                </p>
                <p className="numeric text-xs text-muted-foreground">
                  {item.quantity} יח׳
                  {!isQuote && !item.is_gift && ` × ${formatUnitIls(Number(item.unit_price))}`}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {item.is_gift && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-600 px-2 py-0.5 text-[11px] font-bold text-white">
                      <Gift className="size-3" aria-hidden="true" />
                      מתנה
                    </span>
                  )}
                  {item.is_digital && <DigitalBadge />}
                  {!isQuote && (
                    <ItemStatusBadge status={item.item_status} shippingKind={order.shipping_kind} />
                  )}
                </div>
                {item.is_digital &&
                  !isQuote &&
                  (item.digital_license_key ? (
                    <LicenseKeyDisplay licenseKey={item.digital_license_key} />
                  ) : order.status !== "cancelled" ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      מפתח הרישיון יישלח אליך במייל ויופיע כאן.
                    </p>
                  ) : null)}
              </div>
              {!isQuote && (
                <span className="numeric shrink-0 text-sm font-bold">
                  {item.is_gift ? formatIls(0) : formatIls(Number(item.unit_price) * item.quantity)}
                </span>
              )}
            </li>
          ))}
          {hasShippingLine(order) && (
            <li className="flex items-center gap-3 p-3">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-secondary/60">
                {order.shipping_kind === "pickup" ? (
                  <Store className="size-5 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <Truck className="size-5 text-muted-foreground" aria-hidden="true" />
                )}
              </span>
              <p className="min-w-0 flex-1 text-sm font-semibold text-foreground">
                משלוח: {shippingLabel ?? "דמי משלוח"}
              </p>
              {!isQuote && (
                <span className="numeric shrink-0 text-sm font-bold">
                  {shippingWasFree(order) || shippingAmount === 0
                    ? "חינם"
                    : formatIls(shippingAmount)}
                </span>
              )}
            </li>
          )}
          {discount > 0 && (
            <li className="flex items-center gap-3 p-3 text-green-700 dark:text-green-400">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-green-50 dark:bg-green-950/40">
                <TicketPercent className="size-5" aria-hidden="true" />
              </span>
              <p className="min-w-0 flex-1 text-sm font-semibold">{orderDiscountLabel(order)}</p>
              <span className="numeric shrink-0 text-sm font-bold">-{formatIls(discount)}</span>
            </li>
          )}
        </ul>

        {!isQuote && (
          <dl className="space-y-1.5 border-t border-border bg-secondary/30 p-3 text-sm">
            {vat.showBreakdown && (
              <>
                <div className="flex justify-between text-muted-foreground">
                  <dt>סה״כ לפני מע״מ</dt>
                  <dd className="numeric">{formatIls(vat.net)}</dd>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <dt>מע״מ {vat.vatRate}%</dt>
                  <dd className="numeric">{formatIls(vat.vat)}</dd>
                </div>
              </>
            )}
            {depositTotal > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <dt>מתוכם פיקדון</dt>
                <dd className="numeric">{formatIls(depositTotal)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-1.5 text-base font-bold">
              <dt>סה״כ לתשלום</dt>
              <dd className="numeric text-accent">{formatIls(vat.gross)}</dd>
            </div>
          </dl>
        )}
      </section>

      {/* ---------- פרטים ומשלוח ---------- */}
      <div className="grid gap-3 sm:grid-cols-2">
        <section className="space-y-1 rounded-xl border border-border p-3 text-sm">
          <h3 className="mb-1 flex items-center gap-1.5 font-bold text-foreground">
            <UserRound className="size-4 text-accent" aria-hidden="true" />
            פרטי המזמין
          </h3>
          {billing.name && <p className="font-medium">{billing.name}</p>}
          {billing.taxId && (
            <p className="text-muted-foreground">
              ת.ז / ח.פ: <span className="numeric">{billing.taxId}</span>
            </p>
          )}
          {billing.phone && (
            <p dir="ltr" className="numeric text-right text-muted-foreground">
              {billing.phone}
            </p>
          )}
          {billing.email && (
            <p dir="ltr" className="truncate text-right text-muted-foreground">
              {billing.email}
            </p>
          )}
          {billing.address && <p className="text-muted-foreground">{billing.address}</p>}
        </section>
        {order.shipping_kind === "pickup" ? (
          // חלק 22: בלוק בולט — כתובת החנות ושעות הפעילות מהגדרות האתר
          <PickupNotice address={pickupAddress} hours={settings?.business_hours} />
        ) : order.shipping_kind === "digital" ? (
          <section className="space-y-1 rounded-xl border border-sky-300 bg-sky-50 p-3 text-sm text-sky-950 dark:bg-sky-950/30 dark:text-sky-100">
            <h3 className="mb-1 flex items-center gap-1.5 font-bold">
              <KeyRound className="size-4" aria-hidden="true" />
              משלוח דיגיטלי
            </h3>
            <p className="opacity-90">הרישיונות נשלחים במייל ומופיעים כאן, ליד כל מוצר.</p>
          </section>
        ) : (
          <section
            className={
              delivery.isAlternate
                ? "space-y-1 rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-sm text-amber-950"
                : "space-y-1 rounded-xl border border-border p-3 text-sm"
            }
          >
            <h3 className="mb-1 flex items-center gap-1.5 font-bold">
              <MapPin className="size-4 text-accent" aria-hidden="true" />
              {delivery.isAlternate ? "משלוח לכתובת אחרת" : "כתובת למשלוח"}
            </h3>
            {delivery.name && <p className="font-medium">{delivery.name}</p>}
            {delivery.phone && (
              <p dir="ltr" className="numeric text-right opacity-80">
                {delivery.phone}
              </p>
            )}
            <p className="opacity-80">{delivery.address || "—"}</p>
            {shippingLabel && <p className="text-xs opacity-70">{shippingLabel}</p>}
          </section>
        )}
      </div>

      {order.note && (
        <p className="flex items-start gap-2 rounded-xl bg-secondary/60 p-3 text-sm">
          <StickyNote className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
          <span>
            <strong>הערות: </strong>
            {order.note}
          </span>
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <OrderDocumentButton
          orderId={order.id}
          label={isQuote ? "מסמך הבקשה (PDF)" : "קבלה / אישור הזמנה (PDF)"}
        />
        <Button variant="secondary" disabled={reordering} onClick={() => onReorder(order.id)}>
          {reordering ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RotateCcw className="size-4" />
          )}
          הזמנה חוזרת
        </Button>
      </div>
    </div>
  );
}
