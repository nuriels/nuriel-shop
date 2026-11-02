// "תשלום מאורחים" (מיגרציה 37) — הטופס: מהתצוגה, השינויים לשמירה, ותצוגה מקדימה. טהור (נבדק ביחידה).
import type { PaymentSettingsValues, PaymentSettingsView } from "../../types/payment-instructions";
import { manageKeys } from "../lib/query-keys";

export const paymentSettingsKey = [...manageKeys.all, "payment-settings"] as const;

export interface PaymentForm {
  bank_enabled: boolean;
  bank_name: string;
  bank_branch: string;
  bank_account: string;
  bank_holder: string;
  bit_enabled: boolean;
  bit_phone: string;
  phone_enabled: boolean;
  phone_number: string;
  note: string;
}

const TEXT = [
  "bank_name",
  "bank_branch",
  "bank_account",
  "bank_holder",
  "bit_phone",
  "phone_number",
  "note",
] as const;
const FLAGS = ["bank_enabled", "bit_enabled", "phone_enabled"] as const;

export function formFromView(v: PaymentSettingsView): PaymentForm {
  return {
    bank_enabled: v.bank_enabled,
    bank_name: v.bank_name ?? "",
    bank_branch: v.bank_branch ?? "",
    bank_account: v.bank_account ?? "",
    bank_holder: v.bank_holder ?? "",
    bit_enabled: v.bit_enabled,
    bit_phone: v.bit_phone ?? "",
    phone_enabled: v.phone_enabled,
    phone_number: v.phone_number ?? "",
    note: v.note ?? "",
  };
}

/** הערכים לבדיקה (null לטקסט ריק) */
export function valuesOf(f: PaymentForm): PaymentSettingsValues {
  const t = (s: string) => (s.trim() ? s : null);
  return {
    bank_enabled: f.bank_enabled,
    bank_name: t(f.bank_name),
    bank_branch: t(f.bank_branch),
    bank_account: t(f.bank_account),
    bank_holder: t(f.bank_holder),
    bit_enabled: f.bit_enabled,
    bit_phone: t(f.bit_phone),
    phone_enabled: f.phone_enabled,
    phone_number: t(f.phone_number),
    note: t(f.note),
  };
}

/** רק מה שהשתנה מול השמור; טקסט שנמחק נשלח כ-"" (המסד מנקה ומאפס) */
export function changesFrom(
  saved: PaymentSettingsView,
  form: PaymentForm,
): Partial<Record<keyof PaymentForm, string | boolean>> {
  const base = formFromView(saved);
  const out: Partial<Record<keyof PaymentForm, string | boolean>> = {};
  for (const k of FLAGS) if (form[k] !== base[k]) out[k] = form[k];
  for (const k of TEXT) if (form[k].trim() !== base[k].trim()) out[k] = form[k].trim();
  return out;
}

/** מה האורח יראה, בשורות (לתצוגה המקדימה) */
export function guestPreview(f: PaymentForm, businessPhone: string | null): string[] {
  const lines: string[] = [];
  if (f.bank_enabled)
    lines.push(
      `העברה בנקאית: ${f.bank_name.trim() || "—"}, סניף ${f.bank_branch.trim() || "—"}, חשבון ${
        f.bank_account.trim() || "—"
      }, על שם ${f.bank_holder.trim() || "—"}`,
    );
  if (f.bit_enabled) lines.push(`Bit: ${f.bit_phone.trim() || "—"}`);
  if (f.phone_enabled) {
    const phone = f.phone_number.trim() || businessPhone;
    lines.push(
      `תשלום בטלפון: נציג העסק יתקשר להשלמת התשלום${phone ? ` (אפשר גם להתקשר: ${phone})` : ""}`,
    );
  }
  if (f.note.trim()) lines.push(`הוראות: ${f.note.trim()}`);
  return lines;
}
