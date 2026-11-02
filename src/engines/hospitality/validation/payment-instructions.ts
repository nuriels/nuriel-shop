// הוראות תשלום — בדיקת הקלט לפני המסד (המסד בודק שוב: שדות, סוגים, פרטים מלאים, בעלים בלבד)
import type { PaymentSettingsValues } from "../types/payment-instructions";
import { InputError } from "./input";

const BOOLEAN_KEYS = ["bank_enabled", "bit_enabled", "phone_enabled"] as const;
const TEXT_KEYS = [
  "bank_name",
  "bank_branch",
  "bank_account",
  "bank_holder",
  "bit_phone",
  "phone_number",
  "note",
] as const;
type Key = keyof PaymentSettingsValues;

export const PAYMENT_LIMITS = { bankName: 60, holder: 80, note: 1000 } as const;
export const BRANCH = /^[0-9]{1,4}$/;
export const ACCOUNT = /^[0-9]([0-9-]{2,18})[0-9]$/;
export const MOBILE = /^05[0-9]-?[0-9]{7}$/;
export const PHONE = /^\+?[0-9 ()-]{7,20}$/;

export function parsePaymentSettingsSave(input: unknown): {
  changes: Partial<PaymentSettingsValues>;
  revision: number;
} {
  const o = (input ?? {}) as Record<string, unknown>;
  const rev = o["revision"];
  if (typeof rev !== "number" || !Number.isInteger(rev) || rev < 0)
    throw new InputError("גרסה לא תקינה — טענו מחדש");
  const raw = o["changes"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new InputError("אין שינויים לשמירה");
  const changes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if ((BOOLEAN_KEYS as readonly string[]).includes(k)) {
      if (typeof v !== "boolean") throw new InputError("ערך לא תקין");
      changes[k] = v;
    } else if ((TEXT_KEYS as readonly string[]).includes(k)) {
      if (v !== null && typeof v !== "string") throw new InputError("ערך לא תקין");
      const s =
        typeof v === "string" ? v.slice(0, k === "note" ? PAYMENT_LIMITS.note + 50 : 120) : "";
      changes[k] = s;
    } else throw new InputError("שדה לא מוכר");
  }
  if (!Object.keys(changes).length) throw new InputError("אין שינויים לשמירה");
  return { changes: changes as Partial<PaymentSettingsValues>, revision: rev };
}

/** שגיאות בטופס (אותם כללים כמו במסד) — מפתח השדה → הודעה */
export function paymentFormErrors(v: PaymentSettingsValues): Partial<Record<Key, string>> {
  const e: Partial<Record<Key, string>> = {};
  const t = (s: string | null) => (s ?? "").trim();
  if (v.bank_enabled) {
    if (t(v.bank_name).length < 2) e.bank_name = "שם הבנק";
    if (!BRANCH.test(t(v.bank_branch).replace(/\s/g, ""))) e.bank_branch = "מספר סניף: עד 4 ספרות";
    if (!ACCOUNT.test(t(v.bank_account).replace(/[\s/]/g, "")))
      e.bank_account = "מספר חשבון: ספרות (ומקפים), 4 עד 20 תווים";
    if (t(v.bank_holder).length < 2) e.bank_holder = "על שם מי החשבון";
  }
  if (v.bit_enabled && !MOBILE.test(t(v.bit_phone).replace(/[\s()]/g, "")))
    e.bit_phone = "טלפון נייד ישראלי (05X-XXXXXXX)";
  if (t(v.phone_number) && !PHONE.test(t(v.phone_number))) e.phone_number = "מספר טלפון לא תקין";
  if (t(v.note).length > PAYMENT_LIMITS.note) e.note = "עד 1,000 תווים";
  return e;
}
