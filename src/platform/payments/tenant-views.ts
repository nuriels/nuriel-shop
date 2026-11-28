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
  /** the highest order total (agorot) that can be paid online here; null = no cap on the app side */
  maxAmountMinor: number | null;
}

/** DEMO: test payments are capped at ₪50 by the DB (migration 208: max_attempt_open and the CHECKs) */
export const DEMO_MAX_AMOUNT_MINOR = 5000;

/** the fixed reason shown instead of the online option (and for a refused start) above the DEMO cap (L9) */
export const ONLINE_OVER_DEMO_CAP =
  "בסביבת DEMO אפשר לשלם באופן מקוון רק על הזמנה של עד ₪50. אפשר לבחור אמצעי תשלום אחר.";

/** true when an order of `totalIls` (shekels, as the checkout shows it) is above the online cap */
export function onlineAmountOverCap(
  options: Pick<OnlinePaymentOptions, "maxAmountMinor">,
  totalIls: number,
): boolean {
  return (
    options.maxAmountMinor !== null &&
    Number.isFinite(totalIls) &&
    Math.round(totalIls * 100) > options.maxAmountMinor
  );
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
  /** staff only: the person's decision once the review was resolved (X-16), null while open */
  reviewOutcome: ReviewOutcome | null;
  /** staff only: when the review was resolved; null while open (and again after a reopen, X-22) */
  reviewResolvedAt: string | null;
  /** staff only: the review was reopened by a new return or charge after a decision (X-22) */
  reviewReopened: boolean;
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
  /**
   * the order cannot be paid online right now (X-14/X-15): held by the DB since a return came back, being verified,
   * or in review — the pay page shows "verification pending / in review" and no Pay button
   */
  held: boolean;
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
  // held / busy (X-14, X-15): a return of this order is unverified or in review — no new payment page
  if (view.held) return "review";
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
  held_unexplained: "ההזמנה מוחזקת בלי בדיקה פתוחה — לא ידוע אם בוצע חיוב",
  charge_after_resolution: "התקבל חיוב אחרי ההחלטה הקודמת",
});

/** a reason the map does not know (or none) still says something: never an empty text */
export const REVIEW_REASON_FALLBACK = "נדרשת בדיקה";

export function reviewReasonLabel(reason: string | null): string {
  if (!reason) return REVIEW_REASON_FALLBACK;
  return Object.prototype.hasOwnProperty.call(REVIEW_REASON_LABELS, reason)
    ? (REVIEW_REASON_LABELS[reason] ?? REVIEW_REASON_FALLBACK)
    : REVIEW_REASON_FALLBACK;
}

/** a store's terminal as the store owner and the platform admin see it (max_account_status) — never secrets */
export interface StoreTerminalView {
  /** the server runs the DEMO payments environment (paymentsEnv): the screen shows the DEMO notice */
  demo: boolean;
  configured: boolean;
  active: boolean;
  environment: "demo" | "pilot" | "production" | null;
  enabled: boolean;
  mode: "test" | "live" | null;
  status: "unverified" | "verified" | "failed" | null;
  lastVerifiedAt: string | null;
  /** the last 2 digits of the terminal number only */
  terminalHint: string | null;
  hasApiKey: boolean;
  hasApiPassword: boolean;
  /** P-6a (4): the fixed mask when the secret is set, null when not — never the value, never its token */
  apiKeyMask: string | null;
  apiPasswordMask: string | null;
  credentialsUpdatedAt: string | null;
}

/** P-6a (4): what a screen shows for a stored secret (a constant: it says "set", nothing about the value) */
export const SECRET_MASK = "••••••••";

/**
 * The store owner's card in the pilot (contract §7.2 P-6, P-8): only whether MAX card payment is on. No terminal
 * number, no hint digits, no key — the platform admin sets the terminal up in platform management.
 */
export interface StorePilotStatus {
  kind: "pilot";
  active: boolean;
  /** test payments are on for this store: the card shows the DEMO notice */
  demo: boolean;
}
export const PILOT_ACTIVE_TEXT = "סליקת MAX פעילה";
export const PILOT_SOON_TEXT = "הסליקה בקרוב";
/** a store outside the pilot list (or an unmarked DB): the DB refuses, the screens say so */
export const PILOT_NOT_LISTED = "החנות עוד לא בפיילוט — הסליקה בקרוב";

const PILOT_KIND: StorePilotStatus["kind"] = "pilot";

export function isStorePilotStatus(
  view: StoreTerminalView | StorePilotStatus | null,
): view is StorePilotStatus {
  return view !== null && "kind" in view && view.kind === PILOT_KIND;
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

/** a person's review decision (X-16): was the card charged? */
export type ReviewOutcome = "not_charged" | "charged";
export const REVIEW_OUTCOMES: readonly ReviewOutcome[] = ["not_charged", "charged"];

/** the two explicit choices in the order panel: each says what happens to the order */
export const REVIEW_OUTCOME_LABELS: Readonly<Record<ReviewOutcome, string>> = Object.freeze({
  not_charged: "לא בוצע חיוב — ההזמנה חוזרת להמתין לתשלום",
  charged: "בוצע חיוב — ההזמנה נשארת בהמתנה לטיפול ידני: ביטול וזיכוי בפורטל Hyp",
});

/** X-25: the decision as the order panel shows it once a review is resolved */
export const REVIEW_DECISION_LABELS: Readonly<Record<ReviewOutcome, string>> = Object.freeze({
  not_charged: "לא בוצע חיוב — ההזמנה חזרה להמתין לתשלום",
  charged: "בוצע חיוב — ההזמנה מוחזקת לטיפול ידני",
});
const DECISION_WITHOUT_OUTCOME = "הבדיקה סומנה כטופלה";

/**
 * The order panel's state, derived from the DB's answer on every render (never cached): an open review shows the
 * reason and the resolve choices; a resolved one shows the decision and no buttons; a reopened one (X-22: the DB
 * cleared review_resolved_at / review_outcome) is open again.
 */
export function onlinePaymentPanelState(view: OnlinePaymentView | null): {
  paid: boolean;
  live: boolean;
  held: boolean;
  charged: boolean;
  /** an open review: the reason and the resolve choices are shown */
  openReview: boolean;
  /** the decision text of a resolved review, null otherwise */
  decision: string | null;
  /** reopened after a decision by a new return / charge (X-22): the decision buttons are back */
  reopened: boolean;
  /** what the store does next — never null while the order is held (round 4: every held order has a route) */
  guidance: string | null;
} {
  const attempt = view?.attempt ?? null;
  const state = attempt?.state ?? null;
  const paid = view?.paymentStatus === "paid";
  const outcome = attempt?.reviewOutcome ?? null;
  const resolved = attempt !== null && (attempt.reviewResolvedAt !== null || outcome !== null);
  const held = view?.held === true && !paid;
  const openReview = state === "needs_review" && !resolved;
  const reopened = openReview && attempt?.reviewReopened === true;
  const charged = resolved && outcome === "charged";
  const guidance = !held
    ? null
    : reopened
      ? HELD_GUIDANCE.reopened
      : openReview
        ? HELD_GUIDANCE.review
        : charged
          ? HELD_GUIDANCE.charged
          : state === "returned"
            ? HELD_GUIDANCE.verifying
            : HELD_GUIDANCE.other;
  return {
    paid,
    live: state === "created" || state === "redirected",
    held,
    charged,
    openReview,
    decision: resolved
      ? outcome === null
        ? DECISION_WITHOUT_OUTCOME
        : REVIEW_DECISION_LABELS[outcome]
      : null,
    reopened,
    guidance,
  };
}

/** the next step for a held order, by its situation (fixed, gender-neutral) */
export const HELD_GUIDANCE = Object.freeze({
  review:
    "ההזמנה מוחזקת עד להחלטה: יש לבדוק בפורטל Hyp ולבחור אם בוצע חיוב או לא. היא לא תבוטל אוטומטית ואי אפשר לשלם עליה שוב עד אז.",
  reopened: "התקבלה חזרה חדשה אחרי ההחלטה — נדרשת בדיקה מחדש",
  charged: "בוצע חיוב — יש לבטל ולזכות בפורטל Hyp, או לטפל בהזמנה ידנית. ההזמנה נשארת מוחזקת.",
  verifying:
    "התשלום באימות מול ספק התשלומים. אין צורך לעשות דבר כרגע; אם האימות לא יוכרע, תתקבל התראה לבדיקה.",
  other: "ההזמנה מוחזקת — נדרשת בדיקה.",
});

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
