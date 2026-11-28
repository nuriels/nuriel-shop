/**
 * Online payments — fixed Hebrew texts per outcome class (plan §6.2: "הודעות שגיאה קבועות בעברית לכל CCode.
 * תשובה של Hyp לא מועברת ללקוח"). Gender-neutral wording only (impersonal or plural forms).
 * Hyp's own texts (`errMsg`, status descriptions) are never shown or forwarded: every function here returns one
 * of the strings below, whatever the input.
 * Safe for browser code: this module imports nothing and holds no protocol or credential names.
 */

export type PaymentMessageKey =
  "approved" | "declined" | "needs_review" | "verification_pending" | "unavailable" | "credentials";

export const PAYMENT_MESSAGES: Readonly<Record<PaymentMessageKey, string>> = Object.freeze({
  approved: "התשלום התקבל בהצלחה.",
  declined: "התשלום לא אושר. אפשר לנסות שוב או לבחור אמצעי תשלום אחר.",
  needs_review: "התשלום ממתין לבדיקה ידנית. אין צורך לשלם שוב; הסטטוס יתעדכן אחרי הבדיקה.",
  verification_pending: "התשלום בתהליך אימות. אין צורך לשלם שוב; הסטטוס יתעדכן בעוד כמה דקות.",
  unavailable: "התשלום המקוון אינו זמין כרגע. אפשר לנסות שוב בעוד כמה דקות.",
  credentials:
    "ספק הסליקה דחה את פרטי המסוף. יש לבדוק את מספר המסוף, המפתח והסיסמה, ואת הגדרות המסוף בפורטל של הספק.",
});

export function paymentMessage(key: PaymentMessageKey): string {
  return Object.prototype.hasOwnProperty.call(PAYMENT_MESSAGES, key)
    ? PAYMENT_MESSAGES[key]
    : PAYMENT_MESSAGES.unavailable;
}

/** The return's `CCode` class (classifyReturnCcode): `hold` (600/700/800) reads as "for review", never as paid or failed. */
export function messageKeyForReturnOutcome(
  outcome: "approved" | "hold" | "declined",
): PaymentMessageKey {
  if (outcome === "approved") return "approved";
  if (outcome === "hold") return "needs_review";
  return "declined";
}

/**
 * A SIGN/VERIFY service code (not a card decline): 902 "Authentication error" and 901 "Terminal is not permitted
 * to use this method" are terminal-configuration problems for the account's admin; anything else is a temporary
 * "unavailable".
 */
export function messageKeyForServiceCcode(ccode: string | null): PaymentMessageKey {
  return ccode === "902" || ccode === "901" ? "credentials" : "unavailable";
}

/** What a payer (shopper, or a store owner paying NURIEL) may see: a terminal-credentials problem shows as "unavailable". */
export function payerMessageKey(key: PaymentMessageKey): PaymentMessageKey {
  return key === "credentials" ? "unavailable" : key;
}
