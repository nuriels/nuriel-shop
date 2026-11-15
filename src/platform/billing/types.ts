// Billing & Agreements (מיגרציה 189) — הצורה של מה שהמסד מחזיר (billing.summary). כל הסכומים מחושבים
// במסד; כאן רק טיפוסים. אותה צורה לבעל העסק ולמנהל הפלטפורמה, ולמנהל הפלטפורמה יש בנוסף שדות פנימיים.

export type Engine = "ecommerce" | "hospitality";
export type BillingCycle = "monthly" | "yearly";
/** exempt: Nuriel כעוסק פטור — אין מע"מ (השיעור 0) */
export type VatMode = "included" | "excluded" | "exempt";
export type SellerBusinessType = "exempt" | "authorized";
export type EntryKind = "charge" | "payment" | "credit" | "reversal";
export type EntryCategory = "subscription" | "setup" | "other";
export type PaymentMethod = "bank_transfer" | "bit" | "credit_card" | "cash" | "check" | "other";
export type RequestStatus = "pending" | "approved" | "rejected" | "canceled";

/** פירוק מחיר: לפני מע"מ, מע"מ, סה"כ (mode = list: מחיר מחירון בלי פירוק) */
export type PriceParts = {
  net?: number;
  vat?: number;
  gross: number;
  rate?: number;
  mode: VatMode | "list";
};

export type EngineState = {
  engine: Engine;
  plan: string;
  plan_name: string;
  status: string;
  active: boolean;
  renewal_kind: "trial" | "period" | "none";
  renewal_at: string | null;
  renewal_on: string | null;
  days_left: number | null;
  system: boolean;
};

export type Agreement = {
  id: string;
  version: number;
  plan: string;
  plan_name: string;
  billing_cycle: BillingCycle;
  list_price_monthly: number | null;
  agreed_monthly: number | null;
  agreed_yearly: number | null;
  monthly: PriceParts | null;
  yearly: PriceParts | null;
  cycle_price: PriceParts | null;
  special_price: boolean;
  setup_fee: PriceParts | null;
  commitment_months: number | null;
  start_date: string | null;
  commitment_ends_on: string | null;
  /** צילום ברגע ההסכם: סוג העוסק של Nuriel כמוכרת */
  vat_business_type: SellerBusinessType;
  vat_mode: VatMode;
  vat_rate: number;
  terms: string | null;
  effective_on: string;
  reason: "initial" | "change" | "upgrade";
  created_at: string;
  // מנהל הפלטפורמה בלבד
  internal_note?: string | null;
  created_by_email?: string | null;
  superseded_at?: string | null;
  upgrade_request_id?: string | null;
};

export type LedgerEntry = {
  id: string;
  no: number;
  kind: EntryKind;
  category: EntryCategory;
  amount: number;
  net: number;
  vat: number;
  vat_rate: number;
  occurred_on: string;
  period_start: string | null;
  period_end: string | null;
  method: PaymentMethod | null;
  description: string | null;
  confirmation: "manual" | "provider";
  source: string;
  reverses_id: string | null;
  reversed: boolean;
  // מנהל הפלטפורמה בלבד
  reference?: string | null;
  internal_note?: string | null;
  recorded_by_email?: string | null;
  created_at?: string;
};

export type UpgradeRequest = {
  id: string;
  current_plan: string;
  current_plan_name: string;
  requested_plan: string;
  requested_plan_name: string;
  requested_cycle: BillingCycle;
  list_price_monthly: number | null;
  customer_note: string | null;
  status: RequestStatus;
  created_at: string;
  decided_at: string | null;
  decision_message: string | null;
  // מנהל הפלטפורמה בלבד
  tenant_id?: string;
  tenant_label?: string;
  engine?: Engine;
  requested_by_email?: string | null;
  decided_by_email?: string | null;
  agreement_id?: string | null;
  subscription?: EngineState;
  agreement?: Agreement | null;
};

export type CatalogPlan = {
  code: string;
  name: string;
  list_monthly: number | null;
  setup_fee: number | null;
  published: boolean;
};

export type MoneyLine = { due: number; paid: number; balance: number };

export type BillingSummary = {
  tenant_id: string;
  business_name: string;
  slug: string;
  engine: Engine;
  today: string;
  subscription: EngineState;
  list_price_monthly: number | null;
  list_setup_fee: number | null;
  agreement: Agreement | null;
  plan_mismatch: boolean;
  setup: MoneyLine;
  subscription_money: MoneyLine;
  other: MoneyLine;
  /** תשלומים שהועתקו מההיסטוריה הישנה (אם יועתקו, באישור) — בתוך total.paid, לא מול חיובים */
  legacy_paid: number;
  total: MoneyLine;
  renewal: {
    kind: "trial" | "period" | "none";
    on: string | null;
    days_left: number | null;
    basis: "agreement" | "list" | "none";
    cycle: BillingCycle;
    expected: PriceParts | null;
  };
  entries: LedgerEntry[];
  requests: UpgradeRequest[];
  plans: CatalogPlan[];
  /** מצב המע"מ של Nuriel כמוכרת היום (המע"מ בחיוב נקבע לפי המוכר, לא לפי הלקוח) */
  vat: SellerVatProfile;
};

/** המע"מ של Nuriel כמוכרת (billing.vat_profile): פטור — 0 נעול; מורשה — השיעור המרכזי */
export type SellerVatProfile = {
  business_type: SellerBusinessType;
  prices_include_vat: boolean;
  default_mode: VatMode;
  rate: number;
  // מנהל הפלטפורמה בלבד
  central_rate?: number;
  allow_vat_rate_override?: boolean;
};

/** "תעד תשלום" הישן (billing_history): שורות כסף שלא מופיעות ביומן החדש — קריאה בלבד */
export type LegacyGap = {
  paid_count: number;
  paid_amount: number;
  due_count: number;
  due_amount: number;
  last_on: string | null;
  rows: {
    id: string;
    kind: "payment" | "addon";
    addon_name: string | null;
    amount: number;
    status: "paid" | "due";
    on: string;
    method: string | null;
    plan: string | null;
  }[];
};

/** כל העסקים עם שורות ישנות שלא ביומן החדש (platform_billing_legacy_overview) */
export type LegacyOverview = {
  businesses: number;
  paid_count: number;
  paid_amount: number;
  due_count: number;
  due_amount: number;
  items: (Omit<LegacyGap, "rows"> & { tenant_id: string; label: string; deleted: boolean })[];
};

/** כרטיס הלקוח של מנהל הפלטפורמה: הסיכום + היסטוריית ההסכמים, ומה שעוד רשום רק במנגנון הישן */
export type BillingCard = BillingSummary & {
  history: Agreement[];
  vat: Required<SellerVatProfile>;
  legacy_unmatched: LegacyGap;
};

/** השיעור המרכזי (platform_vat_rates, מיגרציה 191) */
export type VatRatesView = {
  today: string;
  /** סוג העוסק של Nuriel כמוכרת (null אם שכבת החיוב לא קיימת) */
  seller: Required<SellerVatProfile> | null;
  current: number;
  rates: {
    id: number;
    rate: number;
    effective_from: string;
    note: string;
    created_by_email: string | null;
    created_at: string;
    scheduled: boolean;
  }[];
};

export type ChangeQuote = {
  kind: "charge" | "credit" | "none";
  reason: string | null;
  renewal_on: string | null;
  days_left?: number;
  old_basis?: "list" | "agreement";
  old_cycle_price?: number;
  old_cycle_days?: number;
  new_cycle_price?: number;
  new_cycle_days?: number;
  difference: number;
  vat_rate?: number;
};

export type SaveAgreementResult = {
  card: BillingCard;
  plan: { applied: boolean; reason?: string; previous_plan?: string; plan?: string };
  quote: ChangeQuote;
  entry_id: string | null;
};

/** הקלט של הסכם — כמו שהמסד מקבל (billing.build_agreement) */
export type AgreementInput = {
  plan: string;
  billing_cycle: BillingCycle;
  agreed_monthly: number | null;
  agreed_yearly: number | null;
  setup_fee: number;
  commitment_months: number | null;
  start_date: string | null;
  /** null = לפי המוכר (פטור → ללא מע"מ; מורשה → ברירת המחדל). השרת מכריע */
  vat_mode: VatMode | null;
  /** null = השיעור המרכזי. שיעור אחר — רק כשההגדרות מתירות (המסד בודק) */
  vat_rate: number | null;
  terms: string | null;
  internal_note: string | null;
};

export type EntryInput = {
  kind: "charge" | "payment" | "credit";
  category: EntryCategory;
  amount: number;
  method: PaymentMethod | null;
  occurred_on: string;
  description: string | null;
  reference: string | null;
  internal_note: string | null;
  vat_rate: number | null;
};
