// תשלומים להזמנה (מיגרציה 23) — יומן, סכומים ויתרות
export type PaymentKind = "deposit" | "balance" | "full" | "refund" | "other";
export type PaymentMethod = "cash" | "transfer" | "bit" | "card" | "check" | "provider" | "other";

export interface PaymentRow {
  id: string;
  kind: PaymentKind;
  method: PaymentMethod;
  amount: number;
  currency: string;
  paid_at: string;
  note: string | null;
  provider: string | null;
  status: "recorded" | "voided";
  void_reason: string | null;
  voided_at: string | null;
  created_at: string;
}

export interface BookingPayments {
  booking_id: string;
  number: number;
  status: string;
  currency: string;
  total: number;
  deposit_amount: number;
  amount_paid: number;
  /** יתרה לתשלום (בהזמנה פעילה) */
  balance_due: number;
  /** החזר שמגיע לאורח (בהזמנה שבוטלה / נדחתה / פגה) */
  refund_due: number;
  payments: PaymentRow[];
}
