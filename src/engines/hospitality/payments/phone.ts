// תשלום טלפוני (D4) — ההחלטה: אין סליקה באתר בשלב הזה.
//   1. האורח שולח בקשת הזמנה באתר (בלי תשלום ובלי פרטי כרטיס);
//   2. נציג העסק מתקשר, גובה במסוף האשראי של העסק (מחוץ למערכת);
//   3. העסק רושם את התשלום ביומן התשלומים (מיגרציה 23 — payment_record): סכום, אמצעי, תאריך, הערה;
//   4. "שולם" מופיע רק אחרי הרישום הזה (payment_status מחושב מהיומן — מיגרציה 28).
// בקשה / הזמנה מאושרת / תשלום — שלושה דברים נפרדים, כל אחד מוצג בנפרד.
//
// מוכן לסליקה בעתיד: אופן התשלום מוגדר כאן במקום אחד; ספק סליקה ירשום תשלומים דרך
// payment_provider_record (אידמפוטנטי לפי מזהה אצל הספק — כבר קיים במסד), לאותו יומן, בלי
// מערכת נוספת. עד אז — אין חיוב, אין ספק ואין פרטי כרטיס במערכת. טהור (דפדפן ושרת).

/** "phone" — היחיד שפעיל. ("online" יתווסף עם ספק סליקה) */
export type PaymentMode = "phone";
export const PAYMENT_MODE: PaymentMode = "phone";

export type PaymentState = "unpaid" | "deposit_paid" | "paid";

/** מצב התשלום מהסכום שנרשם (כמו במסד) */
export function paymentState(total: number, paid: number): PaymentState {
  if (!(paid > 0)) return "unpaid";
  return paid >= total ? "paid" : "deposit_paid";
}

/**
 * נראה כמו מספר כרטיס אשראי: רצף של 13–19 ספרות (אפשר עם רווחים / מקפים). אותו כלל כמו במסד
 * (payments_note_no_card) — כדי שהמשתמש יקבל הסבר לפני שהמסד מסרב.
 */
export function looksLikeCardNumber(text: string | null | undefined): boolean {
  return /([0-9][ -]?){12,18}[0-9]/.test(String(text ?? "").normalize("NFKC"));
}

export const CARD_IN_GUEST_TEXT =
  "אין לכתוב פרטי כרטיס אשראי באתר — נציג העסק יתקשר אליכם להשלמת התשלום";
export const CARD_IN_PAYMENT_NOTE = "אסור לרשום מספר כרטיס אשראי — רק אסמכתא או 4 הספרות האחרונות";

/** שלבי הזמנה בתשלום טלפוני — לתצוגה (בקשה → אושרה → שולם) */
export function phoneFlow(b: { status: string; payment_status: PaymentState }): {
  requested: true;
  approved: boolean;
  paid: boolean;
  active: boolean;
} {
  const approved = ["confirmed", "cancel_requested", "checked_in", "checked_out"].includes(
    b.status,
  );
  const active = [
    "pending_approval",
    "pending_payment",
    "confirmed",
    "cancel_requested",
    "checked_in",
  ].includes(b.status);
  return { requested: true, approved, paid: b.payment_status === "paid", active };
}
