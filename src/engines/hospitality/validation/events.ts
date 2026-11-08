// אירועים במתחם (מיגרציה 63): בדיקת הקלט לפני המסד — אותן הודעות; המסד הוא הסמכות הסופית
// (עד 50 משתתפים, אין חפיפה, אישור כשיש אורחים בצימרים — הכל נבדק שוב שם).
import { validSignaturePaths } from "../contracts/signature";
import {
  EVENT_TYPES,
  type DepositStatus,
  type EventInput,
  type EventTab,
  type EventType,
  type StoredEventStatus,
} from "../types/events";
import { InputError, isoDate, uuid } from "./input";

type Raw = Record<string, unknown> | null | undefined;

/** החוזה: "כמות המשתתפים באירוע מוגבלת לעד 50 אורחים לכל היותר" */
export const EVENT_MAX_PARTICIPANTS = 50;
const TABS: EventTab[] = ["upcoming", "pending", "past", "cancelled", "all"];
const DEPOSIT: DepositStatus[] = ["pending", "held", "returned", "charged"];
const STATUS: StoredEventStatus[] = ["pending", "confirmed", "cancelled", "completed"];
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const KEYS = new Set([
  "property_id",
  "guest_id",
  "customer",
  "event_type",
  "event_type_other",
  "event_date",
  "start_time",
  "end_time",
  "participants",
  "price",
  "advance_amount",
  "amount_paid",
  "deposit_amount",
  "deposit_status",
  "internal_notes",
  "status",
  "lodging_ack",
]);

const revision = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new InputError("גרסה לא תקינה");
  return v;
};
const text = (v: unknown, what: string, max: number): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new InputError(`${what} — ערך לא תקין`);
  const t = v.trim();
  if (t.length > max) throw new InputError(`${what} ארוך מדי (עד ${max} תווים)`);
  return t || null;
};
const money = (v: unknown, what: string, max: number, nullable: boolean): number | null => {
  if (v === null || v === undefined || v === "") {
    if (nullable) return null;
    throw new InputError(`יש למלא את ${what}`);
  }
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max || Math.round(n * 100) !== n * 100)
    throw new InputError(`${what} — סכום בין 0 ל-${max} (עד שתי ספרות אחרי הנקודה)`);
  return n;
};
const time = (v: unknown, what: string): string => {
  if (typeof v !== "string" || !TIME.test(v))
    throw new InputError(`${what} — יש לכתוב שעה בצורה 22:00`);
  return v;
};

/** אירוע: רק השדות שנשלחו (עדכון חלקי); כל שדה נבדק כמו במסד */
export function parseEventInput(raw: unknown): EventInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new InputError("פרטי האירוע לא תקינים");
  const i = raw as Record<string, unknown>;
  for (const k of Object.keys(i)) if (!KEYS.has(k)) throw new InputError(`שדה לא מוכר: ${k}`);
  const out: EventInput = {};
  if ("property_id" in i) out.property_id = uuid(i["property_id"], "המתחם");
  if ("guest_id" in i && i["guest_id"] !== null && i["guest_id"] !== undefined)
    out.guest_id = uuid(i["guest_id"], "הלקוח");
  if ("customer" in i && i["customer"] !== null && i["customer"] !== undefined) {
    const c = i["customer"];
    if (!c || typeof c !== "object" || Array.isArray(c))
      throw new InputError("פרטי הלקוח לא תקינים");
    const r = c as Record<string, unknown>;
    const fullName = text(r["full_name"], "שם הלקוח", 120);
    if (!fullName || fullName.length < 2) throw new InputError("נא למלא את שם הלקוח");
    const phone = text(r["phone"], "טלפון", 30);
    if (!phone || phone.replace(/\D/g, "").length < 9) throw new InputError("מספר הטלפון לא תקין");
    const email = text(r["email"], "אימייל", 254);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new InputError("כתובת האימייל לא תקינה");
    out.customer = { full_name: fullName, phone, email };
  }
  if ("event_type" in i) {
    if (!EVENT_TYPES.includes(i["event_type"] as EventType))
      throw new InputError("סוג האירוע — יש לבחור מהרשימה");
    out.event_type = i["event_type"] as EventType;
  }
  if ("event_type_other" in i)
    out.event_type_other = text(i["event_type_other"], "סוג האירוע (אחר)", 80);
  if (out.event_type === "other" && !out.event_type_other)
    throw new InputError("יש למלא את סוג האירוע (אחר)");
  if ("event_date" in i) out.event_date = isoDate(i["event_date"], "תאריך האירוע");
  if ("start_time" in i) out.start_time = time(i["start_time"], "שעת ההתחלה");
  if ("end_time" in i) out.end_time = time(i["end_time"], "שעת הסיום");
  if (out.start_time && out.end_time && out.start_time === out.end_time)
    throw new InputError("שעת הסיום צריכה להיות אחרי שעת ההתחלה");
  if ("participants" in i) {
    const n = Number(i["participants"]);
    if (!Number.isInteger(n) || n < 1) throw new InputError("מספר המשתתפים חייב להיות מספר שלם");
    if (n > EVENT_MAX_PARTICIPANTS)
      throw new InputError(
        `עד ${EVENT_MAX_PARTICIPANTS} משתתפים באירוע (לפי החוזה) — אי אפשר יותר`,
      );
    out.participants = n;
  }
  if ("price" in i) out.price = money(i["price"], "המחיר", 1_000_000, false) ?? 0;
  if ("advance_amount" in i)
    out.advance_amount = money(i["advance_amount"], "המקדמה", 1_000_000, true);
  if ("amount_paid" in i) out.amount_paid = money(i["amount_paid"], "הסכום ששולם", 1_000_000, true);
  if ("deposit_amount" in i)
    out.deposit_amount = money(i["deposit_amount"], "הפיקדון", 100_000, false) ?? 0;
  if (
    out.price !== undefined &&
    out.advance_amount !== undefined &&
    out.advance_amount !== null &&
    out.advance_amount > out.price
  )
    throw new InputError("המקדמה לא יכולה להיות גדולה מהמחיר");
  if ("deposit_status" in i) {
    if (!DEPOSIT.includes(i["deposit_status"] as DepositStatus))
      throw new InputError("מצב הפיקדון — יש לבחור מהרשימה");
    out.deposit_status = i["deposit_status"] as DepositStatus;
  }
  if ("internal_notes" in i) out.internal_notes = text(i["internal_notes"], "הערות פנימיות", 2000);
  if ("status" in i) {
    if (i["status"] !== "pending" && i["status"] !== "confirmed")
      throw new InputError("אירוע חדש — ממתין או מאושר");
    out.status = i["status"];
  }
  if ("lodging_ack" in i) out.lodging_ack = i["lodging_ack"] === true;
  return out;
}

export function parseEventsQuery(input: Raw): {
  tab: EventTab;
  q: string | null;
  type: EventType | null;
  from: string | null;
  to: string | null;
  limit: number;
  offset: number;
} {
  const i = input ?? {};
  const tab = (i["tab"] ?? "upcoming") as EventTab;
  if (!TABS.includes(tab)) throw new InputError("לשונית לא מוכרת");
  const q = typeof i["q"] === "string" && i["q"].trim() ? i["q"].trim().slice(0, 100) : null;
  const type = i["type"] ? (i["type"] as EventType) : null;
  if (type && !EVENT_TYPES.includes(type)) throw new InputError("סוג האירוע לא מוכר");
  const from = i["from"] ? isoDate(i["from"], "מתאריך") : null;
  const to = i["to"] ? isoDate(i["to"], "עד תאריך") : null;
  const limit = typeof i["limit"] === "number" ? i["limit"] : 50;
  const offset = typeof i["offset"] === "number" ? i["offset"] : 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new InputError("עמוד לא תקין");
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000)
    throw new InputError("עמוד לא תקין");
  return { tab, q, type, from, to, limit, offset };
}

export const parseEventId = (input: Raw): { id: string } => ({
  id: uuid((input ?? {})["id"], "האירוע"),
});

export function parseEventCreate(input: Raw): { data: EventInput } {
  const data = parseEventInput((input ?? {})["data"]);
  if (!data.property_id) throw new InputError("יש לבחור את המתחם של האירוע");
  if (!data.guest_id && !data.customer) throw new InputError("יש לבחור לקוח או למלא את פרטי הלקוח");
  return { data };
}

export function parseEventUpdate(input: Raw): { id: string; revision: number; data: EventInput } {
  const i = input ?? {};
  const data = parseEventInput(i["data"]);
  if ("status" in data || "guest_id" in data || "customer" in data || "lodging_ack" in data)
    throw new InputError("מצב האירוע והלקוח משתנים בפעולות נפרדות");
  return { id: uuid(i["id"], "האירוע"), revision: revision(i["revision"]), data };
}

export function parseEventCheck(input: Raw): { data: EventInput; exclude: string | null } {
  const i = input ?? {};
  const data = parseEventInput(i["data"]);
  return { data, exclude: i["exclude"] ? uuid(i["exclude"], "האירוע") : null };
}

export function parseEventStatus(input: Raw): {
  id: string;
  revision: number;
  status: StoredEventStatus;
  reason: string | null;
  lodgingAck: boolean;
} {
  const i = input ?? {};
  const status = i["status"] as StoredEventStatus;
  if (!STATUS.includes(status)) throw new InputError("מצב לא מוכר");
  return {
    id: uuid(i["id"], "האירוע"),
    revision: revision(i["revision"]),
    status,
    reason: text(i["reason"], "הסיבה", 300),
    lodgingAck: i["lodgingAck"] === true,
  };
}

const TERMS_KEYS = new Set([
  "representative_name",
  "business_tax_id",
  "representative_signature",
  "facilities",
  "facilities_definite",
  "unit_lines",
  "max_lodging_guests",
  "max_event_guests",
  "pool_open_time",
  "pool_close_time",
  "deposit_amount",
  "event_late_fee_per_hour",
  "lodging_late_fee_per_hour",
  "free_cancellation_days",
]);

export function parseTermsSave(input: Raw): { data: Record<string, unknown>; revision: number } {
  const i = input ?? {};
  const d = i["data"];
  if (!d || typeof d !== "object" || Array.isArray(d))
    throw new InputError("פרטי התנאים לא תקינים");
  const data = d as Record<string, unknown>;
  for (const k of Object.keys(data))
    if (!TERMS_KEYS.has(k)) throw new InputError(`שדה לא מוכר: ${k}`);
  if (data["max_event_guests"] !== undefined) {
    const n = Number(data["max_event_guests"]);
    if (!Number.isInteger(n) || n < 1 || n > EVENT_MAX_PARTICIPANTS)
      throw new InputError(`מכסת משתתפים באירוע — בין 1 ל-${EVENT_MAX_PARTICIPANTS}`);
  }
  if (data["representative_signature"] !== undefined && data["representative_signature"] !== null) {
    if (!validSignaturePaths(data["representative_signature"]))
      throw new InputError("החתימה של הנציג לא תקינה — חתמו שוב");
  }
  if (data["unit_lines"] !== undefined) {
    const lines = data["unit_lines"];
    if (!Array.isArray(lines) || lines.length > 30) throw new InputError("רשימת היחידות לא תקינה");
    for (const l of lines) {
      if (!l || typeof l !== "object") throw new InputError("רשימת היחידות לא תקינה");
      const r = l as Record<string, unknown>;
      if (!text(r["name"], "שם היחידה", 60) || !text(r["description"], "למי מיועדת היחידה", 120))
        throw new InputError("לכל יחידה — שם ולמי היא מיועדת");
      if (r["unit_id"] !== undefined && r["unit_id"] !== null) uuid(r["unit_id"], "היחידה");
    }
  }
  return { data, revision: revision(i["revision"]) };
}

export const parseTermsConfirm = (input: Raw): { revision: number } => ({
  revision: revision((input ?? {})["revision"]),
});
