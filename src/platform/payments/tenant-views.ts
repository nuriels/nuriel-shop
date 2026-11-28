/**
 * Online payments (MAX/Hyp DEMO) — what the store side shows (tenant scope): the shapes the server functions return
 * and their fixed, gender-neutral Hebrew labels. Pure and browser-safe (U17-B1): no imports, no data, no protocol
 * or credential names (contract §7 X-7). No view carries a credential, a ciphertext, a raw return, a signature or a
 * full terminal number (the terminal hint is its last 2 digits).
 */

export type AttemptState =
  | "created"
  | "redirected"
  | "returned"
  | "paid"
  | "test_paid"
  | "needs_review"
  | "failed"
  | "expired"
  | "cancelled";

const ATTEMPT_STATES: readonly string[] = [
  "created",
  "redirected",
  "returned",
  "paid",
  "test_paid",
  "needs_review",
  "failed",
  "expired",
  "cancelled",
];

export function attemptStateOf(value: unknown): AttemptState | null {
  return typeof value === "string" && ATTEMPT_STATES.includes(value)
    ? (value as AttemptState)
    : null;
}

/** checkout: may the store offer an online card payment right now (and is this the DEMO environment) */
export interface OnlinePaymentOptions {
  available: boolean;
  demo: boolean;
}

export interface OnlinePaymentAttemptView {
  /** staff of the store and platform admins only (null for a customer) */
  id: string | null;
  state: AttemptState | null;
  /** a test-terminal attempt (DEMO) */
  test: boolean;
  amountMinor: number | null;
  paidAt: string | null;
  installments: number | null;
  cardBrand: string | null;
  cardLast4: string | null;
  approvalCode: string | null;
  /** staff of the store and platform admins only */
  reviewReason: string | null;
}

/** one order's online payment (max_order_payment_status): null when the viewer may not see the order */
export interface OnlinePaymentView {
  /** the server runs the DEMO payments environment (paymentsEnv): the screen shows the DEMO notice */
  demo: boolean;
  orderNumber: string | null;
  orderStatus: string | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  paymentDueAt: string | null;
  attempt: OnlinePaymentAttemptView | null;
}

/** the pay page's stage, from the order and its latest attempt */
export type OnlinePaymentStage = "ready" | "checking" | "paid" | "review" | "failed" | "expired";

export function onlinePaymentStage(view: OnlinePaymentView): OnlinePaymentStage {
  const state = view.attempt?.state ?? null;
  if (view.paymentStatus === "paid") return "paid";
  if (state === "needs_review") return "review";
  if (state === "returned" || state === "paid" || state === "test_paid") return "checking";
  if (
    view.paymentStatus === "expired" ||
    view.paymentStatus === "rejected" ||
    view.orderStatus === "cancelled"
  )
    return "expired";
  if (state === "failed") return "failed";
  return "ready";
}

export const ATTEMPT_STATE_LABELS: Readonly<Record<AttemptState, string>> = Object.freeze({
  created: "ממתין לתשלום",
  redirected: "ממתין לתשלום",
  returned: "בבדיקה מול ספק התשלומים",
  paid: "שולם",
  test_paid: "שולם (בדיקה)",
  needs_review: "לבדיקה",
  failed: "לא הושלם",
  expired: "פג",
  cancelled: "בוטל",
});

/** why a payment waits for a person (the DB's review reasons, both settle functions) */
const REVIEW_REASON_LABELS: Readonly<Record<string, string>> = Object.freeze({
  document_issued: "ייתכן שהופק מסמך אצל ספק התשלומים",
  unexpected_hold: "עסקה מושהית, חלקית או בתשלומים — לא צפוי",
  amount_mismatch: "הסכום לא תואם",
  currency_mismatch: "המטבע לא תואם",
  duplicate_txn: "מזהה עסקה כפול",
  duplicate_charge: "תשלום כפול",
  late: "התשלום הגיע אחרי שהניסיון פג",
  order_not_awaiting: "ההזמנה כבר לא ממתינה לתשלום",
  terminal_mismatch: "המסוף לא תואם",
  installments_exceeded: "מספר התשלומים לא מותר",
  verify_exhausted: "האימות מול ספק התשלומים נכשל שוב ושוב",
  credentials_changed: "פרטי המסוף שונו בזמן האימות",
  mode_not_allowed: "מצב המסוף לא מותר בסביבה הזו",
  payments_off: "התשלום חזר כשהתשלום המקוון היה כבוי, ולכן לא אומת",
});

export function reviewReasonLabel(reason: string | null): string {
  if (!reason) return "לבדיקה";
  return Object.prototype.hasOwnProperty.call(REVIEW_REASON_LABELS, reason)
    ? (REVIEW_REASON_LABELS[reason] ?? "לבדיקה")
    : "לבדיקה";
}

/** a store's terminal as the store owner and the platform admin see it (max_account_status) — never secrets */
export interface StoreTerminalView {
  /** the server runs the DEMO payments environment (paymentsEnv): the screen shows the DEMO notice */
  demo: boolean;
  configured: boolean;
  active: boolean;
  environment: "demo" | "production" | null;
  enabled: boolean;
  mode: "test" | "live" | null;
  status: "unverified" | "verified" | "failed" | null;
  lastVerifiedAt: string | null;
  /** the last 2 digits of the terminal number only */
  terminalHint: string | null;
  hasApiKey: boolean;
  hasApiPassword: boolean;
  credentialsUpdatedAt: string | null;
}

export const TERMINAL_STATUS_LABELS: Readonly<
  Record<"unverified" | "verified" | "failed", string>
> = Object.freeze({
  unverified: "לא נבדק",
  verified: "מחובר",
  failed: "החיבור נכשל",
});

/** one attempt that went to Hyp's page and never came back (reconciliation list) */
export interface UnreturnedAttemptView {
  orderNumber: string | null;
  amountMinor: number | null;
  createdAt: string | null;
  expiresAt: string | null;
  state: AttemptState | null;
  test: boolean;
}

/** the platform admin's MAX tab for one store */
export interface StoreOnlinePaymentsView {
  status: StoreTerminalView;
  unreturned: UnreturnedAttemptView[];
  /** the address to paste as the success URL in Hyp's portal (no trailing slash) */
  successUrl: string | null;
  /** NURIEL's own shop: its terminal is a store terminal, never the platform one */
  defaultStore: boolean;
}

/**
 * The store terminal save was refused because a payment of the store is in progress (a payer on Hyp's page, or a
 * return being verified): saving anyway ("force") parks those payments for a manual review ('credentials_changed').
 * The MAX tab recognises this exact text and asks for a confirmation.
 */
export const TERMINAL_SAVE_NEEDS_FORCE =
  "תשלום של החנות נמצא עכשיו בתהליך (בדף התשלום או באימות). שמירה בכל זאת תעביר אותו לבדיקה ידנית.";

/** "••12" — only the last 2 digits are ever shown */
export function terminalHintText(hint: string | null): string {
  const digits = (hint ?? "").replace(/[^0-9]/g, "").slice(-2);
  return digits.length === 2 ? `••${digits}` : "—";
}

/** integer agorot → "₪10.50" */
export function agorotText(minor: number | null): string {
  if (typeof minor !== "number" || !Number.isFinite(minor)) return "—";
  return new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS" }).format(minor / 100);
}
