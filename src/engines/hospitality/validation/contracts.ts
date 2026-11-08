// מסמכי לקוחות (מיגרציה 64): בדיקת הקלט — אותן הודעות כמו המסד (הוא הסמכות הסופית)
import { validSignaturePaths, type ContractSignature } from "../contracts/signature";
import type {
  ContractKind,
  ContractStatus,
  ContractTarget,
  DepositMethod,
} from "../types/contracts";
import { InputError, isoDate, uuid } from "./input";

type Raw = Record<string, unknown> | null | undefined;
const KINDS: ContractKind[] = ["hosting", "pool_event"];
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
  if (kind && !KINDS.includes(kind)) throw new InputError("סוג החוזה לא מוכר");
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

export function parseContractSign(input: Raw): {
  token: string;
  fields: { id_number: string; address: string; deposit_method?: DepositMethod };
  signature: ContractSignature;
  agreed: boolean;
} {
  const i = input ?? {};
  const { token } = parseContractToken(i);
  if (i["agreed"] !== true)
    throw new InputError("יש לאשר שקראתם את כל סעיפי ההסכם ושאתם מסכימים להם");
  const f = (i["fields"] ?? {}) as Record<string, unknown>;
  const idNumber = String(f["id_number"] ?? "").replace(/\D/g, "");
  if (!israeliIdOk(idNumber)) throw new InputError("מספר תעודת הזהות / ח.פ לא תקין");
  const address = text(f["address"], "כתובת המגורים", 200);
  if (!address || address.length < 4) throw new InputError("נא למלא כתובת מגורים מלאה");
  const fields: { id_number: string; address: string; deposit_method?: DepositMethod } = {
    id_number: idNumber,
    address,
  };
  if (
    f["deposit_method"] !== undefined &&
    f["deposit_method"] !== null &&
    f["deposit_method"] !== ""
  ) {
    if (!METHODS.includes(f["deposit_method"] as DepositMethod))
      throw new InputError("אמצעי הפיקדון לא מוכר");
    fields.deposit_method = f["deposit_method"] as DepositMethod;
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
