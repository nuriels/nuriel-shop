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

/** שלב א' 5: אמצעי התשלום שהאורח בחר (bookings.payment_method) */
export const GUEST_PAYMENT_METHODS = ["bank", "bit", "phone", "other"] as const;
export type GuestPaymentMethod = (typeof GUEST_PAYMENT_METHODS)[number];

export type ProofStatus = "submitted" | "approved" | "rejected";

/** אישור העברה שהאורח העלה (בלי נתיב הקובץ) */
export interface PaymentProofView {
  id: string;
  status: ProofStatus;
  file_name: string;
  mime: string;
  size: number;
  submitted_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}

/** שלב א' 5: העברה בנקאית בהזמנה של האורח — הכול מהשרת (רענון / חזרה מאוחרת לא מאבדים כלום) */
export interface GuestTransferState {
  /** העסק מקבל העברות וההגעה לפחות min_days ימים אחרי מועד ההזמנה */
  allowed: boolean;
  min_days: number;
  /** האורח בחר בהעברה בנקאית */
  chosen: boolean;
  proofs: PaymentProofView[];
  waiting_review: boolean;
  can_upload: boolean;
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
  /** שלב א' 5 (מיגרציה 55) */
  transfer?: GuestTransferState;
  payment_method?: GuestPaymentMethod | null;
}

/** שלב א' 5: האישורים של הזמנה — לצוות */
export interface StaffBookingProofs {
  payment_method: GuestPaymentMethod | null;
  bank_allowed: boolean;
  amount_due: number;
  currency: string;
  proofs: PaymentProofView[];
}

/** שלב א' 5: אישורים שממתינים לבדיקה (לוח הבקרה) — הוותיק שבהם לקישור ישיר */
export interface ProofsWaiting {
  count: number;
  booking_id: string | null;
  booking_number: number | null;
}
