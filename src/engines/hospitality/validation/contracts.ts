// מסמכי לקוחות (מיגרציה 64) ומסמכים עצמאיים (20261111140000): בדיקת הקלט — אותן הודעות כמו המסד (הוא
// הסמכות הסופית: הוא יודע איזה מסמך ואיזו דרך מילוי, ובודק מה חובה)
import { validSignaturePaths, type ContractSignature } from "../contracts/signature";
import type {
  ContractFillMode,
  ContractKind,
  ContractOrigin,
  ContractStatus,
  ContractTarget,
  DepositMethod,
  PolicyDocKind,
  StandaloneInput,
  StandaloneTarget,
} from "../types/contracts";
import { InputError, isoDate, uuid } from "./input";

type Raw = Record<string, unknown> | null | undefined;
/** חוזה של הזמנה / אירוע */
const KINDS: ContractKind[] = ["hosting", "pool_event"];
/** כל סוגי המסמכים (בארכיון, ב"מסמכים חתומים" ובמסמך עצמאי) */
const ALL_KINDS: ContractKind[] = ["hosting", "pool_event", "policy"];
const FILL_MODES: ContractFillMode[] = ["business", "customer"];
const ORIGINS: ContractOrigin[] = ["linked", "standalone"];
export const POLICY_DOC_KINDS: PolicyDocKind[] = [
  "booking_terms",
  "cancellation",
  "house_rules",
  "payments",
  "event_terms",
  "site_terms",
  "privacy",
];
const EVENT_TYPES = [
  "bridal_shower",
  "bar_mitzvah",
  "birthday",
  "private_party",
  "family_event",
  "other",
];
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const STATUSES: ContractStatus[] = [
  "draft",
  "sent",
  "viewed",
  "signed",
  "superseded",
  "cancelled",
  "expired",
];
const METHODS: DepositMethod[] = ["cash", "check", "card"];
/** הקישור לחתימה: 32 בתים אקראיים ב-base64url */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const text = (v: unknown, what: string, max: number): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw new InputError(`${what} — ערך לא תקין`);
  const t = v.trim();
  if (t.length > max) throw new InputError(`${what} ארוך מדי (עד ${max} תווים)`);
  return t || null;
};
const optionalId = (v: unknown, what: string) => (v ? uuid(v, what) : null);

export function parseContractTarget(input: Raw): ContractTarget {
  const i = input ?? {};
  const kind = i["kind"] as ContractKind;
  if (!KINDS.includes(kind)) throw new InputError("סוג החוזה לא מוכר");
  const bookingId = optionalId(i["bookingId"], "ההזמנה");
  const eventId = optionalId(i["eventId"], "האירוע");
  if (kind === "hosting" && (!bookingId || eventId))
    throw new InputError("חוזה אירוח — רק להזמנת לינה (בחרו הזמנה)");
  if (kind === "pool_event" && (!eventId || bookingId))
    throw new InputError("חוזה מתחם הבריכה — רק לאירוע (בחרו אירוע)");
  let signer: ContractTarget["signer"] = null;
  const s = i["signer"];
  if (s && typeof s === "object" && !Array.isArray(s)) {
    const r = s as Record<string, unknown>;
    const fullName = text(r["full_name"], "שם הלקוח", 120);
    const email = text(r["email"], "אימייל", 254);
    const phone = text(r["phone"], "טלפון", 30);
    if (email && !EMAIL.test(email)) throw new InputError("כתובת האימייל לא תקינה");
    if (phone && phone.replace(/\D/g, "").length < 9) throw new InputError("מספר הטלפון לא תקין");
    signer = {
      ...(fullName ? { full_name: fullName } : {}),
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
    };
    if (Object.keys(signer).length === 0) signer = null;
  }
  const o = (i["options"] ?? {}) as Record<string, unknown>;
  const options: ContractTarget["options"] = {};
  if (
    o["deposit_method"] !== undefined &&
    o["deposit_method"] !== null &&
    o["deposit_method"] !== ""
  ) {
    if (!METHODS.includes(o["deposit_method"] as DepositMethod))
      throw new InputError("אמצעי הפיקדון לא מוכר");
    options.deposit_method = o["deposit_method"] as DepositMethod;
  }
  if (o["event_fee"] !== undefined && o["event_fee"] !== null && o["event_fee"] !== "") {
    const n = Number(o["event_fee"]);
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000 || Math.round(n * 100) !== n * 100)
      throw new InputError("התשלום הנוסף לאירוע — סכום לא תקין");
    options.event_fee = n;
  }
  return { kind, bookingId, eventId, guestId: optionalId(i["guestId"], "הלקוח"), signer, options };
}

export function parseContractCreate(input: Raw): ContractTarget & { supersedes: string | null } {
  return {
    ...parseContractTarget(input),
    supersedes: optionalId((input ?? {})["supersedes"], "החוזה הקודם"),
  };
}

export const parseContractId = (input: Raw): { id: string } => ({
  id: uuid((input ?? {})["id"], "החוזה"),
});

export function parseContractCancel(input: Raw): { id: string; reason: string | null } {
  const i = input ?? {};
  return { id: uuid(i["id"], "החוזה"), reason: text(i["reason"], "הסיבה", 300) };
}

export function parseContractFile(input: Raw): { id: string; purpose: "view" | "download" } {
  const i = input ?? {};
  const purpose = i["purpose"] === "download" ? "download" : "view";
  return { id: uuid(i["id"], "החוזה"), purpose };
}

export function parseContractsQuery(input: Raw): {
  q: string | null;
  kind: ContractKind | null;
  status: ContractStatus | null;
  eventType: string | null;
  from: string | null;
  to: string | null;
  limit: number;
  offset: number;
} {
  const i = input ?? {};
  const kind = i["kind"] ? (i["kind"] as ContractKind) : null;
  if (kind && !ALL_KINDS.includes(kind)) throw new InputError("סוג החוזה לא מוכר");
  const status = i["status"] ? (i["status"] as ContractStatus) : null;
  if (status && !STATUSES.includes(status)) throw new InputError("מצב לא מוכר");
  const eventType = typeof i["eventType"] === "string" && i["eventType"] ? i["eventType"] : null;
  if (eventType && !/^[a-z_]{3,20}$/.test(eventType)) throw new InputError("סוג האירוע לא מוכר");
  const limit = typeof i["limit"] === "number" ? i["limit"] : 50;
  const offset = typeof i["offset"] === "number" ? i["offset"] : 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new InputError("עמוד לא תקין");
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000)
    throw new InputError("עמוד לא תקין");
  return {
    q: typeof i["q"] === "string" && i["q"].trim() ? i["q"].trim().slice(0, 100) : null,
    kind,
    status,
    eventType,
    from: i["from"] ? isoDate(i["from"], "מתאריך") : null,
    to: i["to"] ? isoDate(i["to"], "עד תאריך") : null,
    limit,
    offset,
  };
}

export function parseContractToken(input: Raw): { token: string } {
  const token = (input ?? {})["token"];
  if (typeof token !== "string" || !TOKEN.test(token))
    throw new InputError("הקישור לחתימה לא תקין — פתחו אותו שוב מהמייל");
  return { token };
}

/** ת"ז / ח"פ: עד 9 ספרות + ספרת ביקורת (כמו במסד) */
export function israeliIdOk(value: string): boolean {
  if (!/^[0-9]{5,9}$/.test(value)) return false;
  const d = value.padStart(9, "0");
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let x = Number(d[i]) * (i % 2 === 0 ? 1 : 2);
    if (x > 9) x -= 9;
    sum += x;
  }
  return sum % 10 === 0;
}

/** פרטי הלקוח בחתימה. מה חובה — לפי המסמך ודרך המילוי, במסד (הוא יודע מה נשלח); כאן — רק הצורה */
export interface ContractSignFields {
  id_number?: string;
  address?: string;
  deposit_method?: DepositMethod;
  /** דרך ב' (הלקוח ממלא) */
  full_name?: string;
  email?: string;
  phone?: string;
}

export function parseContractSign(input: Raw): {
  token: string;
  fields: ContractSignFields;
  signature: ContractSignature;
  agreed: boolean;
} {
  const i = input ?? {};
  const { token } = parseContractToken(i);
  if (i["agreed"] !== true)
    throw new InputError("יש לאשר שקראתם את כל סעיפי ההסכם ושאתם מסכימים להם");
  const f = (i["fields"] ?? {}) as Record<string, unknown>;
  const fields: ContractSignFields = {};
  const idNumber = String(f["id_number"] ?? "").replace(/\D/g, "");
  if (f["id_number"] !== undefined && f["id_number"] !== null && f["id_number"] !== "") {
    if (!israeliIdOk(idNumber)) throw new InputError("מספר תעודת הזהות / ח.פ לא תקין");
    fields.id_number = idNumber;
  }
  const address = text(f["address"], "כתובת המגורים", 200);
  if (f["address"] !== undefined && f["address"] !== null && f["address"] !== "") {
    if (!address || address.length < 4) throw new InputError("נא למלא כתובת מגורים מלאה");
    fields.address = address;
  }
  if (
    f["deposit_method"] !== undefined &&
    f["deposit_method"] !== null &&
    f["deposit_method"] !== ""
  ) {
    if (!METHODS.includes(f["deposit_method"] as DepositMethod))
      throw new InputError("אמצעי הפיקדון לא מוכר");
    fields.deposit_method = f["deposit_method"] as DepositMethod;
  }
  const fullName = text(f["full_name"], "השם המלא", 120);
  if (fullName !== null) {
    if (fullName.length < 2) throw new InputError("נא למלא שם מלא");
    fields.full_name = fullName;
  }
  const email = text(f["email"], "האימייל", 254);
  if (email !== null) {
    if (!EMAIL.test(email)) throw new InputError("כתובת האימייל לא תקינה");
    fields.email = email;
  }
  const phone = text(f["phone"], "הטלפון", 30);
  if (phone !== null) {
    if (phone.replace(/\D/g, "").length < 9) throw new InputError("מספר הטלפון לא תקין");
    fields.phone = phone;
  }
  const s = (i["signature"] ?? {}) as Record<string, unknown>;
  let signature: ContractSignature;
  if (s["kind"] === "drawn") {
    if (!validSignaturePaths(s["paths"])) throw new InputError("החתימה לא תקינה — חתמו שוב");
    signature = { kind: "drawn", paths: s["paths"] as string[] };
  } else if (s["kind"] === "typed") {
    const name = text(s["name"], "החתימה בהקלדה", 80);
    if (!name || name.length < 2) throw new InputError("כתבו את השם המלא כחתימה");
    signature = { kind: "typed", name };
  } else throw new InputError("חסרה חתימה");
  return { token, fields, signature, agreed: true };
}

// ---------- מסמך עצמאי (בלי הזמנה / אירוע) ----------

const money = (v: unknown, what: string, max: number, required: boolean): number | null => {
  if (v === undefined || v === null || v === "") {
    if (required) throw new InputError(`יש למלא את ${what}`);
    return null;
  }
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max || Math.round(n * 100) !== n * 100)
    throw new InputError(`${what} — סכום לא תקין`);
  return n;
};
const time = (v: unknown, what: string): string | null => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !TIME.test(v))
    throw new InputError(`${what} — יש לכתוב שעה בצורה 22:00`);
  return v;
};

function parseSigner(s: unknown): StandaloneTarget["signer"] {
  if (!s || typeof s !== "object" || Array.isArray(s)) return null;
  const r = s as Record<string, unknown>;
  const fullName = text(r["full_name"], "שם הלקוח", 120);
  const email = text(r["email"], "אימייל", 254);
  const phone = text(r["phone"], "טלפון", 30);
  if (fullName !== null && fullName.length < 2) throw new InputError("נא למלא את שם הלקוח");
  if (email && !EMAIL.test(email)) throw new InputError("כתובת האימייל לא תקינה");
  if (phone && phone.replace(/\D/g, "").length < 9) throw new InputError("מספר הטלפון לא תקין");
  const signer = {
    ...(fullName ? { full_name: fullName } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
  };
  return Object.keys(signer).length ? signer : null;
}

function parseStandaloneInput(kind: ContractKind, raw: unknown): StandaloneInput {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  if (kind === "policy") {
    const doc = r["document_kind"] as PolicyDocKind;
    if (!POLICY_DOC_KINDS.includes(doc)) throw new InputError("המסמך — יש לבחור מהרשימה");
    return { document_kind: doc };
  }
  if (kind === "pool_event") {
    const type = String(r["event_type"] ?? "");
    if (!EVENT_TYPES.includes(type)) throw new InputError("סוג האירוע — יש לבחור מהרשימה");
    const other = type === "other" ? text(r["event_type_other"], "סוג האירוע (אחר)", 80) : null;
    if (type === "other" && !other) throw new InputError("יש למלא את סוג האירוע (אחר)");
    const start = time(r["start_time"], "שעת ההתחלה");
    const end = time(r["end_time"], "שעת הסיום");
    if (!r["event_date"] || !start || !end)
      throw new InputError("יש למלא תאריך, שעת התחלה ושעת סיום");
    const participants = Number(r["participants"]);
    if (!Number.isInteger(participants) || participants < 1 || participants > 1000)
      throw new InputError("מספר המשתתפים חייב להיות מספר שלם בין 1 ל-1000");
    const out: StandaloneInput = {
      event_date: isoDate(r["event_date"], "תאריך האירוע"),
      start_time: start,
      end_time: end,
      event_type: type,
      event_type_other: other,
      participants,
      price: money(r["price"], "המחיר", 1_000_000, true)!,
      deposit_amount: money(r["deposit_amount"], "הפיקדון", 100_000, false),
      late_fee: money(r["late_fee"], "דמי האיחור לשעה", 10_000, false),
    };
    // השימוש בבריכה: לא נשלח — כל החלון המותר; נשלח — שתי השעות, או שתיהן ריקות (בלי שימוש בבריכה)
    if ("pool_start_time" in r || "pool_end_time" in r) {
      const ps = time(r["pool_start_time"], "תחילת השימוש בבריכה");
      const pe = time(r["pool_end_time"], "סוף השימוש בבריכה");
      if ((ps === null) !== (pe === null))
        throw new InputError(
          'השימוש בבריכה — יש למלא גם שעת התחלה וגם שעת סיום, או לבחור "בלי שימוש בבריכה"',
        );
      out.pool_start_time = ps;
      out.pool_end_time = pe;
    }
    return out;
  }
  if (!r["check_in"] || !r["check_out"]) throw new InputError("יש למלא תאריך כניסה ותאריך יציאה");
  const checkIn = isoDate(r["check_in"], "תאריך הכניסה");
  const checkOut = isoDate(r["check_out"], "תאריך היציאה");
  if (checkOut <= checkIn) throw new InputError("תאריך היציאה צריך להיות אחרי תאריך הכניסה");
  const whole = r["whole"] === true;
  const units = Array.isArray(r["units"])
    ? [...new Set((r["units"] as unknown[]).map((u) => (typeof u === "string" ? u.trim() : "")))]
    : [];
  if (units.some((u) => !u || u.length > 80)) throw new InputError("בחירת היחידות לא תקינה");
  if (!whole && units.length === 0) throw new InputError('בחרו את היחידות שבחוזה (או "כל המתחם")');
  const method = r["deposit_method"];
  if (
    method !== undefined &&
    method !== null &&
    method !== "" &&
    !METHODS.includes(method as DepositMethod)
  )
    throw new InputError("אמצעי הפיקדון לא מוכר");
  return {
    check_in: checkIn,
    check_out: checkOut,
    ...(whole ? { whole: true } : { units }),
    price: money(r["price"], "המחיר", 1_000_000, true)!,
    event_fee: money(r["event_fee"], "התשלום הנוסף לאירוע", 1_000_000, false),
    deposit_method: method ? (method as DepositMethod) : null,
  };
}

export function parseStandaloneTarget(input: Raw): StandaloneTarget {
  const i = input ?? {};
  const kind = i["kind"] as ContractKind;
  if (!ALL_KINDS.includes(kind)) throw new InputError("סוג המסמך לא מוכר");
  const fillMode = (i["fillMode"] ?? "business") as ContractFillMode;
  if (!FILL_MODES.includes(fillMode)) throw new InputError("דרך המילוי לא מוכרת");
  const guestId = optionalId(i["guestId"], "הלקוח");
  const signer = parseSigner(i["signer"]);
  if (fillMode === "business" && !guestId) {
    if (!signer?.full_name) throw new InputError("נא למלא את שם הלקוח");
    if (!signer.email) throw new InputError("לשליחת המסמך צריך אימייל תקין של הלקוח");
  }
  return { kind, fillMode, guestId, signer, input: parseStandaloneInput(kind, i["input"]) };
}

/** יצירה: א' — במייל; ב' — קישור להעתקה, או במייל אם העסק כתב אימייל */
export function parseStandaloneCreate(
  input: Raw,
): StandaloneTarget & { deliver: "email" | "link" } {
  const t = parseStandaloneTarget(input);
  const deliver = (input ?? {})["deliver"] === "email" ? "email" : "link";
  if (t.fillMode === "business" && deliver !== "email")
    throw new InputError("מסמך שהעסק ממלא נשלח ללקוח במייל");
  if (deliver === "email" && !t.guestId && !t.signer?.email)
    throw new InputError("לשליחה במייל צריך אימייל תקין של הלקוח");
  return { ...t, deliver };
}

export function parseSignedQuery(input: Raw): {
  q: string | null;
  kind: ContractKind | null;
  origin: ContractOrigin | null;
  from: string | null;
  to: string | null;
  limit: number;
  offset: number;
} {
  const i = input ?? {};
  const kind = i["kind"] ? (i["kind"] as ContractKind) : null;
  if (kind && !ALL_KINDS.includes(kind)) throw new InputError("סוג המסמך לא מוכר");
  const origin = i["origin"] ? (i["origin"] as ContractOrigin) : null;
  if (origin && !ORIGINS.includes(origin)) throw new InputError("מקור לא מוכר");
  const limit = typeof i["limit"] === "number" ? i["limit"] : 50;
  const offset = typeof i["offset"] === "number" ? i["offset"] : 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new InputError("עמוד לא תקין");
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000)
    throw new InputError("עמוד לא תקין");
  const from = i["from"] ? isoDate(i["from"], "מתאריך") : null;
  const to = i["to"] ? isoDate(i["to"], "עד תאריך") : null;
  if (from && to && to < from) throw new InputError("טווח התאריכים לא תקין");
  return {
    q: typeof i["q"] === "string" && i["q"].trim() ? i["q"].trim().slice(0, 100) : null,
    kind,
    origin,
    from,
    to,
    limit,
    offset,
  };
}

/** סימון "נצפה": מסמכים מסוימים (עד 200), או הכול (null) */
export function parseSeenIds(input: Raw): { ids: string[] | null } {
  const raw = (input ?? {})["ids"];
  if (raw === undefined || raw === null) return { ids: null };
  if (!Array.isArray(raw) || raw.length > 200) throw new InputError("יותר מדי מסמכים בבת אחת");
  return { ids: raw.map((x) => uuid(x, "המסמך")) };
}
