// בדיקת הקלט של פונקציות השרת של Hospitality — לפני הפנייה למסד.
// משקף את הבדיקות של המסד (המסד נשאר הסמכות הסופית); הודעות בעברית למשתמש.
import type { ManualBookingSource, StayStatus } from "../types/domain";

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,100}$/;
const MANAGE_TOKEN = /^[0-9a-f]{64}$/;
const MAX_NIGHTS = 60;

type Raw = Record<string, unknown> | null | undefined;
const field = (input: Raw, key: string): unknown => (input ?? {})[key];

export function uuid(value: unknown, what = "המזהה"): string {
  const s = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!UUID.test(s)) throw new InputError(`${what} לא תקין`);
  return s;
}

export function isoDate(value: unknown, what = "התאריך"): string {
  const s = String(value ?? "").trim();
  if (!ISO_DATE.test(s)) throw new InputError(`${what} לא תקין`);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s)
    throw new InputError(`${what} לא תקין`);
  return s;
}

export function stay(checkIn: unknown, checkOut: unknown): { checkIn: string; checkOut: string } {
  const a = isoDate(checkIn, "תאריך ההגעה");
  const b = isoDate(checkOut, "תאריך העזיבה");
  const nights = (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000;
  if (nights < 1) throw new InputError("תאריכי השהייה לא תקינים");
  if (nights > MAX_NIGHTS) throw new InputError(`אפשר להזמין עד ${MAX_NIGHTS} לילות`);
  return { checkIn: a, checkOut: b };
}

export function intInRange(
  value: unknown,
  min: number,
  max: number,
  what: string,
  fallback?: number,
): number {
  if ((value === undefined || value === null || value === "") && fallback !== undefined)
    return fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new InputError(`${what} לא תקין`);
  return n;
}

export function email(value: unknown): string {
  const s = String(value ?? "")
    .trim()
    .toLowerCase();
  if (s.length > 254 || !EMAIL.test(s)) throw new InputError("כתובת האימייל לא תקינה");
  return s;
}

/** ספרות בלבד, 972… → 0… (כמו hospitality.normalize_phone) */
export function normalizePhone(value: unknown): string | null {
  const digits = String(value ?? "").replace(/[^0-9]/g, "");
  const local = digits.startsWith("972") ? `0${digits.slice(3)}` : digits;
  return /^[0-9]{9,15}$/.test(local) ? local : null;
}

export function phone(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (raw.length > 30 || !normalizePhone(raw)) throw new InputError("מספר הטלפון לא תקין");
  return raw;
}

export function text(
  value: unknown,
  max: number,
  what: string,
  opts: { min?: number } = {},
): string {
  const s = String(value ?? "").trim();
  if (s.length < (opts.min ?? 0) || s.length > max) throw new InputError(`${what} לא תקין`);
  return s;
}

export function optionalText(value: unknown, max: number, what: string): string | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  return text(value, max, what);
}

export function money(value: unknown, what = "הסכום"): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000 || Math.round(n * 100) !== n * 100) {
    throw new InputError(`${what} לא תקין`);
  }
  return n;
}

export function optionalMoney(value: unknown, what?: string): number | null {
  return value === undefined || value === null || value === "" ? null : money(value, what);
}

export function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  what: string,
  fallback?: T,
): T {
  if ((value === undefined || value === null || value === "") && fallback !== undefined)
    return fallback;
  const s = String(value ?? "");
  if (!(allowed as readonly string[]).includes(s)) throw new InputError(`${what} לא תקין`);
  return s as T;
}

// ---------- the inputs of each server function ----------

export function parseQuote(input: Raw) {
  const dates = stay(field(input, "checkIn"), field(input, "checkOut"));
  return {
    unitId: uuid(field(input, "unitId"), "היחידה"),
    ...dates,
    adults: intInRange(field(input, "adults"), 1, 100, "מספר המבוגרים", 2),
    children: intInRange(field(input, "children"), 0, 100, "מספר הילדים", 0),
    promoCode: optionalText(field(input, "promoCode"), 32, "קוד הקופון"),
  };
}

export function parseRequestBooking(input: Raw) {
  const key = String(field(input, "idempotencyKey") ?? "");
  if (!IDEMPOTENCY_KEY.test(key)) throw new InputError("חסר מזהה בקשה");
  const hash = String(field(input, "policyHash") ?? "");
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new InputError("יש לאשר את תנאי הביטול לפני שליחת הבקשה");
  if (field(input, "policyAccepted") !== true)
    throw new InputError("יש לאשר את תנאי הביטול לפני שליחת הבקשה");
  return {
    ...parseQuote(input),
    fullName: text(field(input, "fullName"), 120, "השם", { min: 2 }),
    email: email(field(input, "email")),
    phone: phone(field(input, "phone")),
    idempotencyKey: key,
    policyHash: hash,
    specialRequests: optionalText(field(input, "specialRequests"), 2000, "הבקשות המיוחדות"),
    marketingConsent: field(input, "marketingConsent") === true,
    language: oneOf(field(input, "language"), ["he", "en", "ar", "ru"] as const, "השפה", "he"),
  };
}

/** קישור "ניהול ההזמנה" (טוקן) או הזמנה של אורח מחובר (מזהה) — אחד מהשניים */
export function parseGuestBookingRef(input: Raw) {
  const token = field(input, "token");
  const bookingId = field(input, "bookingId");
  if (token !== undefined && token !== null && token !== "") {
    const t = String(token).trim().toLowerCase();
    if (!MANAGE_TOKEN.test(t)) throw new InputError("ההזמנה לא נמצאה");
    return { token: t, bookingId: null };
  }
  return { token: null, bookingId: uuid(bookingId, "ההזמנה") };
}

export function parseRequestCancellation(input: Raw) {
  return {
    ...parseGuestBookingRef(input),
    reason: optionalText(field(input, "reason"), 1000, "הסיבה"),
  };
}

export function parseBookingAction(input: Raw) {
  const revision = field(input, "expectedRevision");
  return {
    bookingId: uuid(field(input, "bookingId"), "ההזמנה"),
    expectedRevision:
      revision === undefined || revision === null
        ? null
        : intInRange(revision, 1, 1_000_000, "גרסת ההזמנה"),
    reason: optionalText(field(input, "reason"), 1000, "הסיבה"),
  };
}

export function parseManualBooking(input: Raw) {
  const dates = stay(field(input, "checkIn"), field(input, "checkOut"));
  const mail = field(input, "email");
  return {
    unitId: uuid(field(input, "unitId"), "היחידה"),
    ...dates,
    fullName: text(field(input, "fullName"), 120, "שם האורח", { min: 2 }),
    phone: phone(field(input, "phone")),
    email: mail === undefined || mail === null || mail === "" ? null : email(mail),
    adults: intInRange(field(input, "adults"), 1, 100, "מספר המבוגרים", 2),
    children: intInRange(field(input, "children"), 0, 100, "מספר הילדים", 0),
    totalOverride: optionalMoney(field(input, "totalOverride"), "המחיר"),
    policyId: field(input, "policyId") ? uuid(field(input, "policyId"), "מדיניות הביטול") : null,
    status: oneOf(
      field(input, "status"),
      ["confirmed", "pending_approval"] as const,
      "הסטטוס",
      "confirmed",
    ),
    source: oneOf<ManualBookingSource>(
      field(input, "source"),
      ["phone", "walk_in", "owner", "external"],
      "המקור",
      "phone",
    ),
    channel: optionalText(field(input, "channel"), 60, "הערוץ"),
    notes: optionalText(field(input, "notes"), 4000, "ההערות"),
    sendGuestEmail: field(input, "sendGuestEmail") === true,
    termsExplained: field(input, "termsExplained") === true,
  };
}

export function parseModifyBooking(input: Raw) {
  const dates = stay(field(input, "checkIn"), field(input, "checkOut"));
  const unit = field(input, "unitId");
  return {
    bookingId: uuid(field(input, "bookingId"), "ההזמנה"),
    expectedRevision: intInRange(field(input, "expectedRevision"), 1, 1_000_000, "גרסת ההזמנה"),
    ...dates,
    unitId: unit ? uuid(unit, "היחידה") : null,
    adults:
      field(input, "adults") == null
        ? null
        : intInRange(field(input, "adults"), 1, 100, "מספר המבוגרים"),
    children:
      field(input, "children") == null
        ? null
        : intInRange(field(input, "children"), 0, 100, "מספר הילדים"),
    totalOverride: optionalMoney(field(input, "totalOverride"), "המחיר"),
    note: optionalText(field(input, "note"), 1000, "ההערה"),
  };
}

export function parseCancellationDecision(input: Raw) {
  return {
    ...parseBookingAction(input),
    feeOverride: optionalMoney(field(input, "feeOverride"), "דמי הביטול"),
    overrideReason: optionalText(field(input, "overrideReason"), 500, "הסיבה"),
  };
}

export function parseStayStatus(input: Raw) {
  return {
    ...parseBookingAction(input),
    status: oneOf<StayStatus>(
      field(input, "status"),
      ["checked_in", "checked_out", "no_show"],
      "הסטטוס",
    ),
  };
}

export function parseGuestId(input: Raw) {
  return { guestId: uuid(field(input, "guestId"), "האורח") };
}
