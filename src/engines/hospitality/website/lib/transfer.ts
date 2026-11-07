// שלב א' 5: העברה בנקאית בעמודי האורח — עזרים טהורים (נבדקים ביחידה)
import type { GuestPaymentInfo } from "../../types/payment-instructions";
import type { useCopy } from "../copy";

/** הגישה של האורח להזמנה: הקישור המאובטח מהמייל, או החשבון המחובר שההזמנה שלו */
export type GuestRef = { token: string } | { bookingId: string };

/** מה להציג בשורת "תשלום": ממתין לאישור העברה / האישור התקבל — null: הנוסח הרגיל */
export function transferPaymentLabel(
  payment: GuestPaymentInfo | null | undefined,
  t: ReturnType<typeof useCopy>,
): string | null {
  const tr = payment?.transfer;
  if (!tr?.allowed || payment?.reason === "paid" || payment?.reason === "closed") return null;
  if (tr.waiting_review) return t.my.transfer.received;
  if (tr.chosen) return t.my.transfer.waiting;
  return null;
}
