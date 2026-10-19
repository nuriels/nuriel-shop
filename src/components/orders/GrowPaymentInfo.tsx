import { CreditCard } from "lucide-react";
import { paymentStatusLabel, type PaymentStatus } from "@/lib/bit-payments";

/**
 * חלק 43: תשלום מקוון דרך Grow בכרטיס ההזמנה — אישור התשלום לבעל החנות: מספר אישור
 * (אסמכתא) לאימות מול חברת הסליקה, כרטיס (4 ספרות אחרונות בלבד), תשלומים ומזהה עסקה.
 * ה"שולם" נקבע רק ע"י ההתראה המאומתת של Grow לשרת.
 */
export function GrowPaymentInfo({
  order,
}: {
  order: {
    payment_method?: string | null;
    payment_status?: string | null;
    grow_asmachta?: string | null;
    grow_transaction_id?: string | null;
    grow_card?: string | null;
    grow_installments?: number | null;
  };
}) {
  if (order.payment_method !== "grow") return null;
  const status = (order.payment_status ?? "awaiting") as PaymentStatus;
  const paid = status === "paid";
  return (
    <div
      className={`space-y-1 rounded-md border px-3 py-2 text-xs ${
        paid
          ? "border-green-300 bg-green-50 text-green-900 dark:border-green-700 dark:bg-green-950/40 dark:text-green-200"
          : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
      }`}
      data-testid="grow-payment-info"
      data-status={status}
    >
      <p className="flex items-center gap-1.5 font-bold">
        <CreditCard className="size-3.5" aria-hidden="true" />
        תשלום מקוון (Grow) — {paymentStatusLabel("grow", status) ?? "ממתין"}
      </p>
      {paid && (
        <p>
          {order.grow_asmachta && (
            <>
              מספר אישור:{" "}
              <span dir="ltr" className="font-semibold">
                {order.grow_asmachta}
              </span>
            </>
          )}
          {order.grow_card && (
            <>
              {" · "}כרטיס: <span dir="ltr">{order.grow_card}</span>
            </>
          )}
          {order.grow_installments && order.grow_installments > 1 && (
            <>
              {" · "}
              {order.grow_installments} תשלומים
            </>
          )}
          {order.grow_transaction_id && (
            <>
              {" · "}עסקה: <span dir="ltr">{order.grow_transaction_id}</span>
            </>
          )}
        </p>
      )}
      {!paid && status === "awaiting" && <p>הלקוח עדיין לא סיים לשלם בדף התשלום.</p>}
      {paid && <p>הכסף נכנס למסוף שלכם. החשבונית / הקבלה נשלחת ללקוח מחברת הסליקה.</p>}
    </div>
  );
}
