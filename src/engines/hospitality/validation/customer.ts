// מיגרציה 65: בדיקת הקלט לתיקון פרטי הלקוח — אותן הודעות כמו המסד (הוא הסמכות הסופית)
import type { CustomerPatch, CustomerScope } from "../types/customer";
import { InputError, uuid } from "./input";

type Raw = Record<string, unknown> | null | undefined;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function revision(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0)
    throw new InputError("גרסה לא תקינה — רעננו את העמוד");
  return v;
}

/** רק השדות שנשלחו; אימייל ריק — מחיקת האימייל */
export function parseCustomerPatch(input: unknown): CustomerPatch {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new InputError("פרטי הלקוח לא תקינים");
  const d = input as Record<string, unknown>;
  for (const k of Object.keys(d))
    if (!["full_name", "phone", "email"].includes(k)) throw new InputError(`שדה לא מוכר: ${k}`);
  const out: CustomerPatch = {};
  if (d["full_name"] !== undefined) {
    const v = typeof d["full_name"] === "string" ? d["full_name"].trim() : "";
    if (v.length < 2) throw new InputError("נא למלא את שם הלקוח");
    if (v.length > 120) throw new InputError("שם הלקוח ארוך מדי (עד 120 תווים)");
    out.full_name = v;
  }
  if (d["phone"] !== undefined) {
    const v = typeof d["phone"] === "string" ? d["phone"].trim() : "";
    if (v.replace(/\D/g, "").length < 9 || v.length > 30)
      throw new InputError("מספר הטלפון לא תקין");
    out.phone = v;
  }
  if (d["email"] !== undefined) {
    const v = typeof d["email"] === "string" ? d["email"].trim() : "";
    if (v && (!EMAIL.test(v) || v.length > 254)) throw new InputError("כתובת האימייל לא תקינה");
    out.email = v || null;
  }
  if (Object.keys(out).length === 0) throw new InputError("לא נשלח אף פרט לעדכון");
  return out;
}

function scopeOf(v: unknown): CustomerScope {
  if (v === undefined || v === null || v === "guest") return "guest";
  if (v === "booking") return "booking";
  throw new InputError("היקף השינוי לא מוכר");
}

export function parseBookingCustomerUpdate(input: Raw): {
  id: string;
  revision: number | null;
  data: CustomerPatch;
  scope: CustomerScope;
  notify: boolean;
} {
  const i = input ?? {};
  return {
    id: uuid(i["id"], "ההזמנה"),
    revision: revision(i["revision"]),
    data: parseCustomerPatch(i["data"]),
    scope: scopeOf(i["scope"]),
    notify: i["notify"] === true,
  };
}

export function parseEventCustomerUpdate(input: Raw): {
  id: string;
  revision: number | null;
  data: CustomerPatch;
  scope: CustomerScope;
} {
  const i = input ?? {};
  return {
    id: uuid(i["id"], "האירוע"),
    revision: revision(i["revision"]),
    data: parseCustomerPatch(i["data"]),
    scope: scopeOf(i["scope"]),
  };
}
