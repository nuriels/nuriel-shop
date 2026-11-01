// הזמנות לצוות (2h / 2i): בדיקת הקלט — אותן הודעות כמו המסד
import type { BookingTab, StayStatus } from "../types/bookings";
import { InputError, uuid } from "./input";

type Raw = Record<string, unknown> | null | undefined;
const TABS: BookingTab[] = ["pending", "upcoming", "staying", "past", "cancelled", "all"];
const STAY: StayStatus[] = ["checked_in", "checked_out", "no_show"];

const revision = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) throw new InputError("גרסה לא תקינה");
  return v;
};
const reason = (v: unknown, max: number, what: string): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new InputError(`${what} — ערך לא תקין`);
  const t = v.trim();
  if (t.length > max) throw new InputError(`${what} ארוכה מדי (עד ${max} תווים)`);
  return t || null;
};

export function parseBookingsQuery(input: Raw): {
  tab: BookingTab;
  q: string | null;
  limit: number;
  offset: number;
} {
  const i = input ?? {};
  const tab = (i["tab"] ?? "pending") as BookingTab;
  if (!TABS.includes(tab)) throw new InputError("לשונית לא מוכרת");
  const q = typeof i["q"] === "string" && i["q"].trim() ? i["q"].trim().slice(0, 100) : null;
  const limit = typeof i["limit"] === "number" ? i["limit"] : 50;
  const offset = typeof i["offset"] === "number" ? i["offset"] : 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new InputError("עמוד לא תקין");
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000)
    throw new InputError("עמוד לא תקין");
  return { tab, q, limit, offset };
}

export const parseBookingId = (input: Raw): { id: string } => ({
  id: uuid((input ?? {})["id"], "ההזמנה"),
});

export function parseDecision(input: Raw): {
  id: string;
  revision: number | null;
  reason: string | null;
} {
  const i = input ?? {};
  return {
    id: uuid(i["id"], "ההזמנה"),
    revision: revision(i["revision"]),
    reason: reason(i["reason"], 1000, "הסיבה"),
  };
}

export function parseStay(input: Raw): { id: string; revision: number | null; status: StayStatus } {
  const i = input ?? {};
  const status = i["status"] as StayStatus;
  if (!STAY.includes(status)) throw new InputError("סטטוס לא מוכר");
  return { id: uuid(i["id"], "ההזמנה"), revision: revision(i["revision"]), status };
}

// ---------- 2i: הזמנה ידנית, שינוי, ביטול, בקשות ביטול ----------
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = (v: unknown, what: string): string => {
  if (typeof v !== "string" || !DATE.test(v) || Number.isNaN(Date.parse(v)))
    throw new InputError(`${what} — תאריך לא תקין`);
  return v;
};
const money = (v: unknown, what: string): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  if (
    typeof n !== "number" ||
    !Number.isFinite(n) ||
    n < 0 ||
    n > 10_000_000 ||
    Math.round(n * 100) !== n * 100
  )
    throw new InputError(`${what} — סכום לא תקין`);
  return n;
};
const count = (v: unknown, what: string, min: number): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > 100)
    throw new InputError(`${what} — מספר לא תקין`);
  return v;
};
const optText = (v: unknown, max: number, what: string): string | null => reason(v, max, what);

export interface CreateBookingInput {
  unitId: string;
  checkIn: string;
  checkOut: string;
  fullName: string;
  phone: string;
  email: string | null;
  adults: number;
  children: number;
  totalOverride: number | null;
  policyId: string | null;
  status: "confirmed" | "pending_approval";
  source: "phone" | "walk_in" | "owner" | "external";
  channel: string | null;
  notes: string | null;
  termsExplained: boolean;
  sendGuestEmail: boolean;
}

export function createBookingError(i: {
  unitId: string;
  checkIn: string;
  checkOut: string;
  fullName: string;
  phone: string;
  email: string;
  termsExplained: boolean;
}): string | null {
  if (!i.unitId) return "יש לבחור יחידה";
  if (!DATE.test(i.checkIn) || !DATE.test(i.checkOut)) return "יש לבחור תאריך הגעה ותאריך עזיבה";
  if (i.checkOut <= i.checkIn) return "תאריך העזיבה חייב להיות אחרי תאריך ההגעה";
  if (!i.fullName.trim()) return "יש להזין את שם האורח";
  if (i.phone.replace(/\D/g, "").length < 9) return "יש להזין מספר טלפון של האורח";
  if (i.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(i.email.trim()))
    return "האימייל לא תקין";
  if (!i.termsExplained) return "יש לאשר שתנאי הביטול הוסברו לאורח";
  return null;
}

export function parseCreateBooking(input: Raw): CreateBookingInput {
  const i = input ?? {};
  const checkIn = date(i["checkIn"], "הגעה");
  const checkOut = date(i["checkOut"], "עזיבה");
  if (checkOut <= checkIn) throw new InputError("תאריך העזיבה חייב להיות אחרי תאריך ההגעה");
  const fullName = typeof i["fullName"] === "string" ? i["fullName"].trim() : "";
  if (fullName.length < 1 || fullName.length > 120)
    throw new InputError("שם האורח: 1 עד 120 תווים");
  const phone = typeof i["phone"] === "string" ? i["phone"].trim() : "";
  if (phone.replace(/\D/g, "").length < 9 || phone.length > 30)
    throw new InputError("מספר הטלפון לא תקין");
  const email = optText(i["email"], 254, "האימייל");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError("האימייל לא תקין");
  const status = i["status"] === "pending_approval" ? "pending_approval" : "confirmed";
  const sources = ["phone", "walk_in", "owner", "external"] as const;
  const source = sources.includes(i["source"] as (typeof sources)[number])
    ? (i["source"] as (typeof sources)[number])
    : "phone";
  if (i["termsExplained"] !== true) throw new InputError("יש לאשר שתנאי הביטול הוסברו לאורח");
  return {
    unitId: uuid(i["unitId"], "היחידה"),
    checkIn,
    checkOut,
    fullName,
    phone,
    email,
    adults: count(i["adults"], "מבוגרים", 1),
    children: count(i["children"] ?? 0, "ילדים", 0),
    totalOverride: money(i["totalOverride"], "מחיר ידני"),
    policyId: i["policyId"] ? uuid(i["policyId"], "המדיניות") : null,
    status,
    source,
    channel: optText(i["channel"], 60, "הערוץ"),
    notes: optText(i["notes"], 4000, "ההערה"),
    termsExplained: true,
    sendGuestEmail: i["sendGuestEmail"] === true,
  };
}

export function parseModify(input: Raw): {
  id: string;
  revision: number;
  checkIn: string;
  checkOut: string;
  unitId: string | null;
  adults: number;
  children: number;
  totalOverride: number | null;
  note: string | null;
} {
  const i = input ?? {};
  const rev = revision(i["revision"]);
  if (rev === null) throw new InputError("גרסה לא תקינה");
  const checkIn = date(i["checkIn"], "הגעה");
  const checkOut = date(i["checkOut"], "עזיבה");
  if (checkOut <= checkIn) throw new InputError("תאריך העזיבה חייב להיות אחרי תאריך ההגעה");
  return {
    id: uuid(i["id"], "ההזמנה"),
    revision: rev,
    checkIn,
    checkOut,
    unitId: i["unitId"] ? uuid(i["unitId"], "היחידה") : null,
    adults: count(i["adults"], "מבוגרים", 1),
    children: count(i["children"] ?? 0, "ילדים", 0),
    totalOverride: money(i["totalOverride"], "מחיר ידני"),
    note: optText(i["note"], 1000, "ההערה"),
  };
}

export function parseCancel(input: Raw): {
  id: string;
  revision: number | null;
  reason: string | null;
  feeOverride: number | null;
  overrideReason: string | null;
} {
  const i = input ?? {};
  const feeOverride = money(i["feeOverride"], "דמי הביטול");
  const overrideReason = optText(i["overrideReason"], 1000, "סיבת השינוי");
  if (feeOverride !== null && !overrideReason)
    throw new InputError("כשמשנים את דמי הביטול צריך לכתוב סיבה");
  return {
    id: uuid(i["id"], "ההזמנה"),
    revision: revision(i["revision"]),
    reason: optText(i["reason"], 1000, "הסיבה"),
    feeOverride,
    overrideReason,
  };
}
