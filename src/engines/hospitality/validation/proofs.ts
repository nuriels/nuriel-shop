// שלב א' 5: הקלט של אמצעי התשלום ואישורי ההעברה — האורח (לפי הקישור המאובטח או החשבון המחובר) והצוות.
// הקובץ עצמו נבדק בשרת לפי התוכן (server/proofs.server.ts); כאן — רק המבנה.
import { GUEST_PAYMENT_METHODS } from "../types/payment-instructions";
import { InputError, money, oneOf, optionalText, parseGuestBookingRef, uuid } from "./input";

type Raw = Record<string, unknown> | null | undefined;

/** אמצעי התשלום שהאורח בוחר (בטופס ההזמנה); ריק — לא נבחר */
export function optionalPaymentMethod(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  return oneOf(value, GUEST_PAYMENT_METHODS, "אמצעי התשלום");
}

export function parseSetPaymentMethod(input: Raw) {
  return {
    ...parseGuestBookingRef(input),
    method: oneOf((input ?? {})["method"], GUEST_PAYMENT_METHODS, "אמצעי התשלום"),
  };
}

/** העלאת אישור: FormData עם token או bookingId, וקובץ אחד בשם "file" */
export function parseProofUploadForm(data: unknown) {
  if (!(data instanceof FormData)) throw new InputError("בקשה לא תקינה");
  const get = (key: string) => {
    const v = data.get(key);
    return typeof v === "string" ? v : undefined;
  };
  const ref = parseGuestBookingRef({ token: get("token"), bookingId: get("bookingId") });
  const file = data.get("file");
  if (!(file instanceof File) || file.size <= 0)
    throw new InputError("בחרו קובץ — צילום של אישור ההעברה או PDF");
  return { ...ref, file };
}

export function parseProofId(input: Raw) {
  return { proofId: uuid((input ?? {})["proofId"], "האישור") };
}

export function parseBookingProofs(input: Raw) {
  return { bookingId: uuid((input ?? {})["bookingId"], "ההזמנה") };
}

/** החלטת הצוות: אישור (עם הסכום שהתקבל) או דחייה (עם סיבה לאורח) */
export function parseProofReview(input: Raw) {
  const i = input ?? {};
  const decision = oneOf(i["decision"], ["approve", "reject"] as const, "ההחלטה");
  const note = optionalText(i["note"], 300, "ההערה");
  if (decision === "reject" && (!note || note.length < 2))
    throw new InputError("כתבו לאורח למה האישור נדחה");
  const amount = decision === "approve" ? money(i["amount"], "הסכום") : null;
  if (decision === "approve" && (amount === null || amount <= 0))
    throw new InputError("כתבו את הסכום שהתקבל");
  return { proofId: uuid(i["proofId"], "האישור"), decision, amount, note };
}
