import { KeyRound, MapPin, Phone, Store, Truck, UserRound } from "lucide-react";
import { billingOf, deliveryOf, type OrderContactFields } from "@/lib/order-details";
import type { OrderShippingKind } from "@/lib/shipping";

/**
 * פרטי המזמין והמשלוח בכרטיס הזמנה בניהול / אצל הסוכן — כפי שנקלטו בקופה.
 * "שלח לכתובת אחרת" מודגש בצבע, כדי שהמשלוח לא ייצא בטעות לכתובת החיוב.
 * הזמנה ישנה (מלפני הקופה) בלי פרטים — לא מוצג כלום (הפרטים בתיק הלקוח).
 */
export function OrderContactBlock({
  order,
}: {
  order: OrderContactFields & { shipping_kind?: OrderShippingKind | null };
}) {
  const guest = order.customer_id === null;
  const hasDetails =
    guest || Boolean(order.customer_phone || order.billing_address) || order.ship_to_different;
  if (!hasDetails) return null;
  const billing = billingOf(order);
  const delivery = deliveryOf(order);

  return (
    <div className="space-y-2 text-xs leading-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        {guest && (
          <span
            className="rounded-full border border-violet-400 px-2 py-0.5 text-[11px] font-bold text-violet-700"
            title="הזמנה בלי חשבון לקוח — הפרטים מהקופה"
          >
            אורח
          </span>
        )}
        {billing.name && (
          <span className="inline-flex items-center gap-1 font-medium text-foreground">
            <UserRound className="size-3.5" aria-hidden="true" />
            {billing.name}
            {billing.taxId && <span className="numeric font-normal">· {billing.taxId}</span>}
          </span>
        )}
        {billing.phone && (
          <a
            href={`tel:${order.customer_phone ?? ""}`}
            dir="ltr"
            className="numeric inline-flex items-center gap-1 hover:text-foreground"
          >
            <Phone className="size-3.5" aria-hidden="true" />
            {billing.phone}
          </a>
        )}
      </div>
      {order.shipping_kind === "pickup" ? (
        <>
          <p className="flex items-center gap-1 font-semibold text-violet-800 dark:text-violet-300">
            <Store className="size-3.5 shrink-0" aria-hidden="true" />
            איסוף עצמי — הלקוח אוסף מהעסק
          </p>
          {billing.address && (
            <p className="flex items-start gap-1 text-muted-foreground">
              <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              כתובת הלקוח: {billing.address}
            </p>
          )}
        </>
      ) : order.shipping_kind === "digital" ? (
        <p className="flex items-center gap-1 font-semibold text-sky-800 dark:text-sky-300">
          <KeyRound className="size-3.5 shrink-0" aria-hidden="true" />
          דיגיטלי בלבד — נשלח במייל
        </p>
      ) : delivery.isAlternate ? (
        <div className="rounded-lg border-2 border-amber-400 bg-amber-50 px-2.5 py-2 text-amber-950">
          <p className="flex items-center gap-1 font-bold">
            <Truck className="size-3.5" aria-hidden="true" />
            משלוח לכתובת אחרת
          </p>
          <p className="font-medium">{delivery.name}</p>
          {delivery.phone && (
            <p dir="ltr" className="numeric text-right">
              {delivery.phone}
            </p>
          )}
          <p>{delivery.address}</p>
        </div>
      ) : (
        delivery.address && (
          <p className="flex items-start gap-1 text-muted-foreground">
            <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {delivery.address}
          </p>
        )
      )}
    </div>
  );
}
