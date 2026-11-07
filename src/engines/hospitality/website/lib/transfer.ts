// שלב א' 5: העברה בנקאית בעמודי האורח — עזרים טהורים (נבדקים ביחידה)
import { paymentState } from "../../payments/phone";
import type { GuestAreaBooking } from "../../types/guest-area";
import type { GuestPaymentInfo } from "../../types/payment-instructions";
import type { useCopy } from "../copy";
import { hasInstructions } from "./payment";

type Copy = ReturnType<typeof useCopy>;

/** מה להציג בשורת "תשלום": ממתין לאישור העברה / האישור התקבל — null: הנוסח הרגיל */
export function transferPaymentLabel(
  payment: GuestPaymentInfo | null | undefined,
  t: Copy,
): string | null {
  const tr = payment?.transfer;
  if (!tr?.allowed || payment?.reason === "paid" || payment?.reason === "closed") return null;
  if (tr.waiting_review) return t.my.transfer.received;
  if (tr.chosen) return t.my.transfer.waiting;
  return null;
}

/**
 * שורת "תשלום" בעמוד ההזמנה: העברה בנקאית (שלב א' 5) → הוראות התשלום של העסק (מיגרציה 37) → התשלום
 * הטלפוני (D4). "שולם" — רק לפי מה שהעסק רשם.
 */
export function paymentRowText(
  b: { total: number; amount_paid: number },
  payment: GuestPaymentInfo | null | undefined,
  t: Copy,
): string {
  const transfer = transferPaymentLabel(payment, t);
  if (transfer) return transfer;
  const state = paymentState(Number(b.total), Number(b.amount_paid));
  if (hasInstructions(payment?.methods) && state === "unpaid")
    return payment?.available ? t.my.unpaidInstructions : t.my.unpaidLater;
  return t.my.paymentStates[state];
}

const CLOSED = new Set(["declined", "cancelled", "expired", "no_show"]);

/** מצב התשלום בשורה ברשימת "ההזמנות שלי" (קצר) */
export function areaPaymentText(b: GuestAreaBooking, t: Copy): string {
  const tr = b.transfer;
  if (b.payment_status !== "paid" && tr?.allowed && !CLOSED.has(b.status)) {
    if (tr.waiting_review) return t.my.transfer.received;
    if (tr.chosen) return t.my.transfer.waiting;
  }
  return t.account.paymentShort[b.payment_status] ?? b.payment_status;
}
