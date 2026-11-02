// הוראות תשלום לאורחים (מיגרציה 37) — מה שהמסד מחזיר לאזור הניהול, לאתר ולאורח

export const PAYMENT_METHOD_KEYS = ["bank", "bit", "phone", "note"] as const;
export type PaymentMethodKey = (typeof PAYMENT_METHOD_KEYS)[number];

export interface PaymentSettingsValues {
  bank_enabled: boolean;
  bank_name: string | null;
  bank_branch: string | null;
  bank_account: string | null;
  bank_holder: string | null;
  bit_enabled: boolean;
  bit_phone: string | null;
  phone_enabled: boolean;
  phone_number: string | null;
  note: string | null;
}

export interface PaymentSettingsView extends PaymentSettingsValues {
  revision: number;
  methods: PaymentMethodKey[];
  /** טלפון העסק (מההגדרות) — לתשלום בטלפון כשלא הוגדר מספר אחר */
  business_phone: string | null;
  updated_at: string | null;
  /** בעלי העסק בלבד משנים (המסד אוכף) */
  editable: boolean;
}

/** לאורח, להזמנה שלו בלבד */
export interface GuestPaymentInfo {
  available: boolean;
  reason?: "not_confirmed" | "closed" | "paid";
  methods: PaymentMethodKey[];
  currency?: string;
  amount_due?: number;
  deposit_due?: number;
  reference?: string;
  bank?: { name: string; branch: string; account: string; holder: string } | null;
  bit?: { phone: string } | null;
  phone?: { number: string | null } | null;
  note?: string | null;
}
