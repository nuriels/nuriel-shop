// שלב א' 2: הקלט של "ההזמנות שלי" — כתובת, קוד, הזמנה, אמצעי תשלום, העלאת אישור. ההרשאות במסד
// (מיגרציה 56): רק הזמנות של הכתובת שהוכחה בקוד, באתר הזה בלבד.
import { GUEST_PAYMENT_METHODS } from "../types/payment-instructions";
import { InputError, oneOf, uuid } from "./input";

type Raw = Record<string, unknown> | null | undefined;

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export function guestAreaEmail(value: unknown): string {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) throw new InputError("כתובת אימייל לא תקינה");
  return email;
}

export function parseGuestAreaEmail(input: Raw) {
  return { email: guestAreaEmail((input ?? {})["email"]) };
}

export function parseGuestAreaCode(input: Raw) {
  const i = input ?? {};
  const code = String(i["code"] ?? "").replace(/\D/g, "");
  if (code.length !== 6) throw new InputError("הקוד מכיל 6 ספרות");
  return { email: guestAreaEmail(i["email"]), code };
}

export function parseGuestAreaBooking(input: Raw) {
  return { bookingId: uuid((input ?? {})["bookingId"], "ההזמנה") };
}

export function parseGuestAreaMethod(input: Raw) {
  return {
    ...parseGuestAreaBooking(input),
    method: oneOf((input ?? {})["method"], GUEST_PAYMENT_METHODS, "אמצעי התשלום"),
  };
}

/** העלאת אישור מהאזור האישי: FormData עם bookingId וקובץ אחד בשם "file" */
export function parseGuestAreaUpload(data: unknown) {
  if (!(data instanceof FormData)) throw new InputError("בקשה לא תקינה");
  const id = data.get("bookingId");
  const file = data.get("file");
  if (!(file instanceof File) || file.size <= 0)
    throw new InputError("בחרו קובץ — צילום של אישור ההעברה או PDF");
  return { bookingId: uuid(typeof id === "string" ? id : undefined, "ההזמנה"), file };
}

/** "da***@example.com" — לתצוגה אחרי בקשת קוד */
export function maskGuestEmail(email: string): string {
  const [name = "", domain = ""] = email.split("@");
  if (name.length <= 2) return `${name[0] ?? ""}***@${domain}`;
  return `${name.slice(0, 2)}${"*".repeat(Math.min(5, name.length - 2))}@${domain}`;
}
