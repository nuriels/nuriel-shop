// תשלומים להזמנה (תשתית Stage 8) — לצוות עם הרשאת bookings: יומן התשלומים, רישום תשלום / החזר
// ידני (מזומן, העברה, Bit, כרטיס, צ'ק), וביטול רישום (עם סיבה). בלי ספק סליקה עדיין.
import { createServerFn } from "@tanstack/react-start";
import type { BookingPayments, PaymentKind, PaymentMethod } from "../types/payments";
import { InputError, isoDate, optionalText, uuid } from "../validation/input";
import { CARD_IN_PAYMENT_NOTE, looksLikeCardNumber } from "../payments/phone";

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
