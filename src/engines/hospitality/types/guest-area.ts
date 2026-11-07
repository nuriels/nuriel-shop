// שלב א' 2 (מיגרציה 56): "ההזמנות שלי" — מה שהאזור האישי של האורח מקבל מהשרת
import type { GuestBookingView } from "./domain";
import type {
  GuestPaymentInfo,
  GuestPaymentMethod,
  GuestTransferState,
} from "./payment-instructions";

export type GuestPaymentStatus = "unpaid" | "deposit_paid" | "paid";

/** הזמנה ברשימה: הפרטים של הקישור האישי + מצב התשלום (לפי יומן התשלומים) ומצב ההעברה */
export interface GuestAreaBooking extends GuestBookingView {
  payment_status: GuestPaymentStatus;
  payment_method: GuestPaymentMethod | null;
  transfer: GuestTransferState;
}

export type GuestAreaList =
  { state: "signed_out" } | { state: "signed_in"; email: string; bookings: GuestAreaBooking[] };

export type GuestAreaDetail =
  | { state: "signed_out" }
  | {
      state: "signed_in";
      booking: GuestBookingView & {
        payment_status: GuestPaymentStatus;
        payment_method: GuestPaymentMethod | null;
      };
      payment: GuestPaymentInfo;
    };
