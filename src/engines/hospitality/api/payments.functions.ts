// תשלומים להזמנה (תשתית Stage 8) — לצוות עם הרשאת bookings: יומן התשלומים, רישום תשלום / החזר
// ידני (מזומן, העברה, Bit, כרטיס, צ'ק), וביטול רישום (עם סיבה). בלי ספק סליקה עדיין.
import { createServerFn } from "@tanstack/react-start";
import type { ProofsWaiting, StaffBookingProofs } from "../types/payment-instructions";
import type { BookingPayments, PaymentKind, PaymentMethod } from "../types/payments";
import { InputError, isoDate, optionalText, uuid } from "../validation/input";
import { CARD_IN_PAYMENT_NOTE, looksLikeCardNumber } from "../payments/phone";
import { parseBookingProofs, parseProofId, parseProofReview } from "../validation/proofs";

const KINDS: PaymentKind[] = ["deposit", "balance", "full", "refund", "other"];
const METHODS: PaymentMethod[] = ["cash", "transfer", "bit", "card", "check", "other"];

export const hospitalityBookingPayments = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => ({
    bookingId: uuid(input?.["bookingId"], "ההזמנה"),
  }))
  .handler(async ({ data }): Promise<BookingPayments> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<BookingPayments>("booking_payments", { _booking_id: data.bookingId });
  });

export const hospitalityPaymentRecord = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => {
    const kind = input?.["kind"] as PaymentKind;
    const method = input?.["method"] as PaymentMethod;
    if (!KINDS.includes(kind)) throw new InputError("סוג התשלום לא תקין");
    if (!METHODS.includes(method)) throw new InputError("אמצעי התשלום לא תקין");
    const amount = Number(input?.["amount"]);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000)
      throw new InputError("הסכום לא תקין");
    return {
      bookingId: uuid(input?.["bookingId"], "ההזמנה"),
      kind,
      method,
      amount: Math.round(amount * 100) / 100,
      paidAt: isoDate(input?.["paidAt"], "תאריך התשלום"),
      note: (() => {
        const note = optionalText(input?.["note"], 300, "ההערה");
        // D4: בלי מספרי כרטיס במערכת (גם המסד מסרב — payments_note_no_card)
        if (looksLikeCardNumber(note)) throw new InputError(CARD_IN_PAYMENT_NOTE);
        return note;
      })(),
    };
  })
  .handler(async ({ data }): Promise<BookingPayments> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<BookingPayments>("payment_record", {
      _booking_id: data.bookingId,
      _kind: data.kind,
      _method: data.method,
      _amount: data.amount,
      _paid_at: data.paidAt,
      _note: data.note,
    });
  });

export const hospitalityPaymentVoid = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => {
    const reason = String(input?.["reason"] ?? "").trim();
    if (reason.length < 2 || reason.length > 300)
      throw new InputError("יש לכתוב למה מבטלים את הרישום");
    return { paymentId: uuid(input?.["paymentId"], "התשלום"), reason };
  })
  .handler(async ({ data }): Promise<BookingPayments> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<BookingPayments>("payment_void", {
      _payment_id: data.paymentId,
      _reason: data.reason,
    });
  });

// ---------- שלב א' 5: אישורי העברה שהאורח העלה ----------
// ההרשאה (bookings), השייכות לעסק והמעברים (נבדק פעם אחת) — במסד (מיגרציה 55). אישור = תשלום ביומן.

export const hospitalityBookingProofs = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseBookingProofs(input))
  .handler(async ({ data }): Promise<StaffBookingProofs> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<StaffBookingProofs>("booking_payment_proofs", { _booking_id: data.bookingId });
  });

/** קישור צפייה חתום (2 דקות) — רק אחרי שהמסד אישר שהאישור שייך לעסק והמשתמש רשאי */
export const hospitalityProofUrl = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseProofId(input))
  .handler(async ({ data }): Promise<{ url: string }> => {
    const [{ manageRpc }, { signedProofUrl }] = await Promise.all([
      import("../server/manage.server"),
      import("../server/proofs.server"),
    ]);
    const file = await manageRpc<{ path: string; name: string; mime: string }>(
      "payment_proof_file",
      { _proof_id: data.proofId },
    );
    return { url: await signedProofUrl(file) };
  });

export const hospitalityReviewProof = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => {
    const parsed = parseProofReview(input);
    // D4: בלי מספרי כרטיס במערכת
    if (looksLikeCardNumber(parsed.note)) throw new InputError(CARD_IN_PAYMENT_NOTE);
    return parsed;
  })
  .handler(async ({ data }): Promise<StaffBookingProofs> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<StaffBookingProofs>("payment_proof_review", {
      _proof_id: data.proofId,
      _decision: data.decision,
      _amount: data.amount,
      _note: data.note,
    });
  });

/** כמה אישורי העברה ממתינים לבדיקה, והוותיק שבהם — ל"דורש טיפול" בלוח הבקרה */
export const hospitalityProofsWaiting = createServerFn({ method: "GET" }).handler(
  async (): Promise<ProofsWaiting> => {
    const { manageRpc } = await import("../server/manage.server");
    const r = await manageRpc<ProofsWaiting | null>("payment_proofs_waiting", {});
    return r ?? { count: 0, booking_id: null, booking_number: null };
  },
);
