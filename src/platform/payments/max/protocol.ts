/**
 * MAX/Hyp Pay protocol: SIGN / VERIFY builders and parsers for the one-time hosted payment page.
 * Pure: no I/O, no environment access, no module state; credentials pass through the builders and are never kept.
 *
 * Every behaviour below comes from docs/payment-gateways/evidence/demo/01-hyp-protocol.md (§1.2–§1.7, §4, §7)
 * and the official pages it quotes (pay/reference/actions, pay/getting-started/creating-a-payment-page,
 * pay/security/transaction-validation, pay/reference/response-status-codes, pay/invoicing/basic-invoicing).
 * No parameter is invented: SIGN sends a closed allow-list only.
 *
 * Server-side use only: the builders carry KEY/PassP. Never import this module from browser code (the client
 * bundle scan, DM-SEC-1, fails on these literals). Fixed Hebrew texts live in ./messages.ts.
 */
import type { MaxCredentials, ReturnFlag, SignInput } from "@/platform/payments/provider";

// ---------------------------------------------------------------------------------------------------------
// Errors and input checks
// ---------------------------------------------------------------------------------------------------------

export type MaxInputField =
  "masof" | "key" | "passp" | "amount" | "order" | "more_data" | "param" | "return" | "endpoint";

/** Invalid input to a builder (a programming or configuration error). The message names the field, never a value. */
export class MaxProtocolInputError extends Error {
  readonly field: MaxInputField;
  constructor(field: MaxInputField) {
    super(`max protocol: invalid ${field}`);
    this.name = "MaxProtocolInputError";
    this.field = field;
  }
}

/** `Masof`: "10 digits" (pay/reference/actions). The `00100` test-terminal rule is the caller's (mode-aware). */
const MASOF_RE = /^[0-9]{10}$/;
/** Attempt reference sent as `Order`: 32 lowercase hex (128 random bits). */
const ORDER_RE = /^[0-9a-f]{32}$/;
/** Control, format (bidi, zero-width), lone-surrogate and line/paragraph-separator characters. */
const UNSAFE_CHAR_RE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
const UNSAFE_CHARS_RE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu;
const CREDENTIAL_MAX = 256;
/** Optional customer prefill: names are cut at the cap; e-mail and phone are dropped (a cut value is wrong data). */
const NAME_MAX = 50;
const EMAIL_MAX = 254;
const CELL_MAX = 20;
/** A return longer than this is refused before anything else. */
export const RETURN_MAX_LENGTH = 4096;

const isCredentialText = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= CREDENTIAL_MAX && !UNSAFE_CHAR_RE.test(v);

function assertCredentials(creds: MaxCredentials): void {
  if (typeof creds !== "object" || creds === null) throw new MaxProtocolInputError("masof");
  if (typeof creds.masof !== "string" || !MASOF_RE.test(creds.masof))
    throw new MaxProtocolInputError("masof");
  if (!isCredentialText(creds.key)) throw new MaxProtocolInputError("key");
  if (!isCredentialText(creds.passp)) throw new MaxProtocolInputError("passp");
}

const isMinorAmount = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;

function assertEndpoint(endpoint: string): void {
  if (
    typeof endpoint !== "string" ||
    !/^https?:\/\/[^\s?#]+$/.test(endpoint) ||
    UNSAFE_CHAR_RE.test(endpoint)
  )
    throw new MaxProtocolInputError("endpoint");
}

/** Strip unsafe characters, trim, cap by code points (never splits a surrogate pair). */
function cleanClientText(value: unknown, max: number, overCap: "cut" | "drop"): string {
  if (typeof value !== "string") return "";
  const text = value.replace(UNSAFE_CHARS_RE, "").trim();
  const points = Array.from(text);
  if (points.length <= max) return text;
  return overCap === "cut" ? points.slice(0, max).join("").trim() : "";
}

// ---------------------------------------------------------------------------------------------------------
// Money: integer agorot <-> Hyp decimal string. String arithmetic only (no float multiplication).
// ---------------------------------------------------------------------------------------------------------

/** Hyp `Amount`: "a decimal number with up to two fractional digits (for example, 10.00, 10.5, or 10)". */
const DECIMAL_RE = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/;
const MAX_SAFE_DIGITS = String(Number.MAX_SAFE_INTEGER);

/** "10" → 1000, "10.5" → 1050, "10.00" → 1000, "0.01" → 1. Anything else (sign, spaces, exponent, 3+ fraction digits, leading zeros, > MAX_SAFE_INTEGER agorot) → null. */
export function decimalToMinor(v: string): number | null {
  if (typeof v !== "string") return null;
  const m = DECIMAL_RE.exec(v);
  if (!m) return null;
  const digits = `${m[1] ?? ""}${(m[2] ?? "").padEnd(2, "0")}`.replace(/^0+(?=[0-9])/, "");
  if (
    digits.length > MAX_SAFE_DIGITS.length ||
    (digits.length === MAX_SAFE_DIGITS.length && digits > MAX_SAFE_DIGITS)
  )
    return null;
  return Number(digits);
}

/** 1050 → "10.50", 5 → "0.05". Throws on anything that is not a non-negative safe integer. */
export function minorToDecimal(v: number): string {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)
    throw new MaxProtocolInputError("amount");
  const digits = String(v).padStart(3, "0");
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

// ---------------------------------------------------------------------------------------------------------
// Encoding and parsing helpers
// ---------------------------------------------------------------------------------------------------------

const PARAM_KEY_RE = /^[A-Za-z][A-Za-z0-9_.-]*$/;

/** RFC 3986 percent-encoding: only A–Z a–z 0–9 - . _ ~ stay literal (space → %20, never "+"). */
function encodeComponent(s: string): string {
  let out: string;
  try {
    out = encodeURIComponent(s);
  } catch {
    throw new MaxProtocolInputError("param"); // lone surrogate
  }
  return out.replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** application/x-www-form-urlencoded value → text ("+" is a space). null when the escapes are not valid UTF-8. */
function decodeFormValue(raw: string): string | null {
  try {
    return decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    return null;
  }
}

/** The response is HTML: "If the response contains HTML instead of a URL-encoded string or JSON, it indicates a system error." */
function looksLikeHtml(body: string): boolean {
  return body.trimStart().startsWith("<") || /<html/i.test(body);
}

type PairsResult =
  | { ok: true; pairs: [string, string][]; byLower: Map<string, string> }
  | { ok: false; reason: "malformed" | "duplicate_key" | "reserved_key" };

/**
 * `k=v&k=v…` with raw (undecoded) values in original order. Every segment needs a plain-ASCII key and "=";
 * keys are unique case-insensitively (so `spType`/`SpType` or `bincard`/`BinCard` count as one name).
 */
function splitPairs(s: string, reserved: ReadonlySet<string>): PairsResult {
  const pairs: [string, string][] = [];
  const byLower = new Map<string, string>();
  for (const segment of s.split("&")) {
    const eq = segment.indexOf("=");
    if (eq < 1) return { ok: false, reason: "malformed" };
    const name = segment.slice(0, eq);
    if (!PARAM_KEY_RE.test(name)) return { ok: false, reason: "malformed" };
    const lower = name.toLowerCase();
    if (reserved.has(lower)) return { ok: false, reason: "reserved_key" };
    if (byLower.has(lower)) return { ok: false, reason: "duplicate_key" };
    const value = segment.slice(eq + 1);
    byLower.set(lower, value);
    pairs.push([name, value]);
  }
  return { ok: true, pairs, byLower };
}

const NO_RESERVED: ReadonlySet<string> = new Set();

// ---------------------------------------------------------------------------------------------------------
// SIGN request
// ---------------------------------------------------------------------------------------------------------

/** The closed SIGN allow-list, in the order sent. Nothing else is ever sent (DM-PAY-1). */
export const SIGN_PARAM_ORDER = [
  "action",
  "What",
  "Masof",
  "KEY",
  "PassP",
  "Amount",
  "Coin",
  "Order",
  "Sign",
  "MoreData",
  "hideBtns",
  "PageLang",
  "ClientName",
  "ClientLName",
  "email",
  "cell",
] as const;

/**
 * SIGN parameters (`action=APISign`, `What=SIGN`) in the documented DEMO set (evidence 01 §1.2): credentials,
 * `Amount` always (2 fraction digits from integer agorot), `Coin=1` (ILS), `Order`, `Sign=True` (needed for
 * VERIFY), `MoreData=True` only when asked, `hideBtns=True`, `PageLang=HEB`, then optional synthetic customer
 * prefill. Never installments, J5/Postpone, recurring, invoices/documents, Hyp e-mails or the Israeli ID.
 */
export function buildSignParams(creds: MaxCredentials, input: SignInput): [string, string][] {
  assertCredentials(creds);
  if (typeof input !== "object" || input === null || !isMinorAmount(input.amountMinor))
    throw new MaxProtocolInputError("amount");
  if (typeof input.order !== "string" || !ORDER_RE.test(input.order))
    throw new MaxProtocolInputError("order");
  if (typeof input.moreData !== "boolean") throw new MaxProtocolInputError("more_data");

  const pairs: [string, string][] = [
    ["action", "APISign"],
    ["What", "SIGN"],
    ["Masof", creds.masof],
    ["KEY", creds.key],
    ["PassP", creds.passp],
    ["Amount", minorToDecimal(input.amountMinor)],
    ["Coin", "1"],
    ["Order", input.order],
    ["Sign", "True"],
  ];
  if (input.moreData) pairs.push(["MoreData", "True"]);
  pairs.push(["hideBtns", "True"], ["PageLang", "HEB"]);

  const client = input.client;
  if (client) {
    const optional: [string, string][] = [
      ["ClientName", cleanClientText(client.firstName, NAME_MAX, "cut")],
      ["ClientLName", cleanClientText(client.lastName, NAME_MAX, "cut")],
      ["email", cleanClientText(client.email, EMAIL_MAX, "drop")],
      ["cell", cleanClientText(client.cell, CELL_MAX, "drop")],
    ];
    for (const pair of optional) if (pair[1] !== "") pairs.push(pair);
  }
  return pairs;
}

/** Pairs → `k=v&k=v`, every value percent-encoded ("URL-encode all parameter values", creating-a-payment-page). */
export function encodeParams(pairs: [string, string][]): string {
  return pairs
    .map(([name, value]) => {
      if (typeof name !== "string" || !PARAM_KEY_RE.test(name) || typeof value !== "string")
        throw new MaxProtocolInputError("param");
      return `${name}=${encodeComponent(value)}`;
    })
    .join("&");
}

// ---------------------------------------------------------------------------------------------------------
// SIGN response
// ---------------------------------------------------------------------------------------------------------

export type SignResult =
  | { ok: true; payUrl: string; echo: Record<string, string> }
  | {
      ok: false;
      code:
        | "html"
        | "ccode"
        | "no_signature"
        | "no_action_pay"
        | "secret_echo"
        | "mismatch"
        | "malformed";
      ccode?: string;
    };

/** Credential names that must never come back (they would end up in the browser's URL). */
const SECRET_NAMES: ReadonlySet<string> = new Set(["key", "passp", "zpass"]);

/**
 * Names that change what Hyp's page does (installments, J5/postpone, recurring, documents, Hyp e-mails, token
 * owner) or carry data we never send. We never send them; one in a SIGN response means the page is not ours.
 */
const FORBIDDEN_ECHO: ReadonlySet<string> = new Set(
  [
    "UserId",
    "Tash",
    "FixTash",
    "tashType",
    "ShowEngTashText",
    "J5",
    "Postpone",
    "HK",
    "freq",
    "TashFirstPayment",
    "FirstPaymentTash",
    "OnlyOnApprove",
    "SendHesh",
    "sendHeshSMS",
    "Pritim",
    "heshDesc",
    "sendemail",
    "tOwner",
    "Token",
  ].map((n) => n.toLowerCase()),
);
const isForbiddenEcho = (lowerName: string) =>
  FORBIDDEN_ECHO.has(lowerName) || lowerName.startsWith("ez.");

/** Lenient scan (before any structural check): does any segment name a credential, in any case or %-encoding? */
function namesSecret(body: string): boolean {
  for (const segment of body.split("&")) {
    const eq = segment.indexOf("=");
    const rawName = eq < 0 ? segment : segment.slice(0, eq);
    const name = (decodeFormValue(rawName) ?? rawName).trim().toLowerCase();
    if (SECRET_NAMES.has(name)) return true;
  }
  return false;
}

/** RFC 3986 query characters with valid %-escapes only, so the body can be appended to a URL byte for byte. */
const URL_QUERY_CHARS_RE = /^[A-Za-z0-9\-._~!$&'()*+,;=:@/?%]+$/;
const BAD_ESCAPE_RE = /%(?![0-9A-Fa-f]{2})/;

/**
 * Checks Hyp's SIGN response (evidence 01 §1.3, §7 C4/C5). Accepted only when it is not HTML; names no credential;
 * is a well-formed URL-encoded string without duplicate names; carries no non-zero `CCode`; has a non-empty
 * `signature` and `action=pay`; echoes nothing we never send; and echoes exactly what we sent for `Masof`,
 * `Amount` (same agorot), `Coin=1`, `Order`, `Sign=True` and `MoreData` (`True` when sent, absent otherwise).
 * `payUrl` = endpoint + "?" + the trimmed body exactly ("append the entire response", never re-encoded).
 */
export function validateSignResponse(
  body: string,
  sent: { masof: string; amountMinor: number; order: string; moreData: boolean },
  endpoint: string,
): SignResult {
  assertEndpoint(endpoint);
  if (typeof sent !== "object" || sent === null || !MASOF_RE.test(sent.masof))
    throw new MaxProtocolInputError("masof");
  if (!isMinorAmount(sent.amountMinor)) throw new MaxProtocolInputError("amount");
  if (!ORDER_RE.test(sent.order)) throw new MaxProtocolInputError("order");
  if (typeof sent.moreData !== "boolean") throw new MaxProtocolInputError("more_data");

  if (typeof body !== "string") return { ok: false, code: "malformed" };
  if (looksLikeHtml(body)) return { ok: false, code: "html" };
  const trimmed = body.trim();
  if (trimmed === "") return { ok: false, code: "malformed" };
  if (namesSecret(trimmed)) return { ok: false, code: "secret_echo" };
  if (!URL_QUERY_CHARS_RE.test(trimmed) || BAD_ESCAPE_RE.test(trimmed))
    return { ok: false, code: "malformed" };
  const parsed = splitPairs(trimmed, NO_RESERVED);
  if (!parsed.ok) return { ok: false, code: "malformed" };
  const raw = (name: string) => parsed.byLower.get(name.toLowerCase());

  const ccodeRaw = raw("CCode");
  if (ccodeRaw !== undefined) {
    const ccode = decodeFormValue(ccodeRaw);
    if (ccode === null) return { ok: false, code: "malformed" };
    if (ccode !== "0") return { ok: false, code: "ccode", ccode };
  }
  if (!raw("signature")) return { ok: false, code: "no_signature" };
  if (decodeFormValue(raw("action") ?? "") !== "pay") return { ok: false, code: "no_action_pay" };
  for (const [name] of parsed.pairs)
    if (isForbiddenEcho(name.toLowerCase())) return { ok: false, code: "mismatch" };

  const expected: [string, string][] = [
    ["Masof", sent.masof],
    ["Coin", "1"],
    ["Order", sent.order],
    ["Sign", "True"],
  ];
  if (sent.moreData) expected.push(["MoreData", "True"]);
  else if (raw("MoreData") !== undefined) return { ok: false, code: "mismatch" };
  const echo: Record<string, string> = {};
  for (const [name, want] of expected) {
    const got = decodeFormValue(raw(name) ?? "");
    if (got !== want) return { ok: false, code: "mismatch" };
    echo[name] = got;
  }
  const amountRaw = raw("Amount");
  const amount = amountRaw === undefined ? null : decodeFormValue(amountRaw);
  if (amount === null || decimalToMinor(amount) !== sent.amountMinor)
    return { ok: false, code: "mismatch" };
  echo["Amount"] = amount;

  return { ok: true, payUrl: `${endpoint}?${trimmed}`, echo };
}

// ---------------------------------------------------------------------------------------------------------
// Return (payment completion redirect)
// ---------------------------------------------------------------------------------------------------------

export type ParsedReturn =
  | {
      ok: true;
      /** The query string exactly as received (no leading "?"), for VERIFY. */
      raw: string;
      /** Raw (still %-encoded) name/value pairs in original order. */
      pairs: [string, string][];
      ccode: string | null;
      id: string | null;
      order: string | null;
      amountMinor: number | null;
      coin: string | null;
      payments: number | null;
      acode: string | null;
      brand: string | null;
      last4: string | null;
      flags: ReturnFlag[];
    }
  | { ok: false; reason: "empty" | "too_long" | "duplicate_key" | "reserved_key" | "malformed" };

/**
 * Names only we send on VERIFY. One in a return is a forgery indicator, and it would also put a second value
 * for that name into our VERIFY request. Contract: KEY/PassP/action/What; `Masof` added (see the report):
 * no documented redirect carries it, and buildVerifyQuery sends its own.
 */
const RESERVED_RETURN_NAMES: ReadonlySet<string> = new Set([
  "key",
  "passp",
  "action",
  "what",
  "masof",
]);
/** Printable ASCII only; `#`, `"`, `<`, `>` never reach a server unencoded from a browser. */
const RAW_RETURN_RE = /^[\x21-\x7E]+$/;
const RAW_RETURN_BAD_RE = /[#"<>]/;
const ID_RE = /^[0-9A-Za-z_.:-]{1,64}$/;
const PAYMENTS_RE = /^[0-9]{1,3}$/;
const ACODE_RE = /^[0-9A-Za-z]{1,16}$/;
const BRAND_RE = /^[0-9A-Za-z ._-]{1,32}$/;
const LAST4_RE = /^[0-9]{4}$/;

/**
 * Parses Hyp's return query (evidence 01 §1.4, §1.6 #2). Keeps `raw` unchanged for VERIFY; refuses an empty or
 * over-long query, a malformed one, duplicate names (case-insensitive) and reserved names. Decodes only the
 * fields it extracts. A field that is absent, empty or not in its expected shape comes back as null — callers
 * must treat null `ccode`/`id`/`order`/`amountMinor` as "cannot be paid". Exceptions that fail closed instead:
 * an `Id` or `Payments` that is present but not in shape refuses the whole return ("malformed"), so a junk
 * value can never read as "absent".
 * Flags: `document` when `Hesh` or `HeshASM` is non-empty and not "0"; `hk` when `HKId` is present; `multi` when
 * `MULTI` is present (any value).
 */
export function parseReturnQuery(raw: string): ParsedReturn {
  if (typeof raw !== "string" || raw === "") return { ok: false, reason: "empty" };
  if (raw.length > RETURN_MAX_LENGTH) return { ok: false, reason: "too_long" };
  if (!RAW_RETURN_RE.test(raw) || RAW_RETURN_BAD_RE.test(raw))
    return { ok: false, reason: "malformed" };
  const parsed = splitPairs(raw, RESERVED_RETURN_NAMES);
  if (!parsed.ok) return { ok: false, reason: parsed.reason };

  const get = (name: string) => parsed.byLower.get(name.toLowerCase());
  /** Decoded value, null when absent, empty or not decodable. */
  const text = (name: string): string | null => {
    const value = get(name);
    if (value === undefined) return null;
    const decoded = decodeFormValue(value);
    return decoded === null || decoded === "" ? null : decoded;
  };
  const shaped = (name: string, re: RegExp): string | null => {
    const value = text(name);
    return value !== null && re.test(value) ? value : null;
  };
  /** Present and non-empty, but undecodable or out of shape → refuse. */
  const strictFails = (name: string, re: RegExp): boolean => {
    const value = get(name);
    if (value === undefined || value === "") return false;
    const decoded = decodeFormValue(value);
    return decoded === null || (decoded !== "" && !re.test(decoded));
  };
  if (strictFails("Id", ID_RE) || strictFails("Payments", PAYMENTS_RE))
    return { ok: false, reason: "malformed" };

  const amount = text("Amount");
  const payments = text("Payments");
  const flags: ReturnFlag[] = [];
  if (documentIssued(get("Hesh")) || documentIssued(get("HeshASM"))) flags.push("document");
  if (get("HKId") !== undefined) flags.push("hk");
  if (get("MULTI") !== undefined) flags.push("multi");

  return {
    ok: true,
    raw,
    pairs: parsed.pairs,
    ccode: text("CCode"),
    id: text("Id"),
    order: shaped("Order", ORDER_RE),
    amountMinor: amount === null ? null : decimalToMinor(amount),
    coin: text("Coin"),
    payments: payments === null ? null : Number(payments),
    acode: shaped("ACode", ACODE_RE),
    brand: shaped("Brand", BRAND_RE),
    last4: shaped("L4digit", LAST4_RE),
    flags,
  };
}

/** `Hesh`/`HeshASM` "non-empty and not 0" (decision ה-6). An undecodable value is judged on its raw text. */
function documentIssued(value: string | undefined): boolean {
  if (value === undefined) return false;
  const decoded = decodeFormValue(value) ?? value;
  return decoded !== "" && decoded !== "0";
}

// ---------------------------------------------------------------------------------------------------------
// VERIFY
// ---------------------------------------------------------------------------------------------------------

/**
 * `action=APISign&What=VERIFY&Masof&KEY&PassP` (the account named by the route and the attempt), then "all
 * parameters from the redirect URL, in their original order" — the raw return appended unchanged. Throws when
 * the raw return does not pass parseReturnQuery (never VERIFY a refused return).
 */
export function buildVerifyQuery(creds: MaxCredentials, rawReturn: string): string {
  assertCredentials(creds);
  if (!parseReturnQuery(rawReturn).ok) throw new MaxProtocolInputError("return");
  const prefix = encodeParams([
    ["action", "APISign"],
    ["What", "VERIFY"],
    ["Masof", creds.masof],
    ["KEY", creds.key],
    ["PassP", creds.passp],
  ]);
  return `${prefix}&${rawReturn}`;
}

export type VerifyResult = { verified: boolean; ccode: string | null; html: boolean };

/**
 * VERIFY answer (evidence 01 §1.5): verified only when the whole body is exactly `CCode=0` (one trailing CR/LF
 * run tolerated). HTML, `CCode=00`, `CCode= 0`, ` CCode=0`, `ccode=0`, a repeated CCode, any extra parameter or
 * anything else → not verified. `ccode` is informational (e.g. 902 → credentials alert) and is null when the
 * name is not exactly `CCode` or appears more than once.
 */
export function classifyVerifyResponse(body: string): VerifyResult {
  if (typeof body !== "string") return { verified: false, ccode: null, html: false };
  if (looksLikeHtml(body)) return { verified: false, ccode: null, html: true };
  const text = body.replace(/[\r\n]+$/, "");
  let ccode: string | null = null;
  let seen = 0;
  for (const segment of text.split("&")) {
    const eq = segment.indexOf("=");
    const name = eq < 0 ? segment : segment.slice(0, eq);
    if (name.toLowerCase() !== "ccode") continue;
    seen += 1;
    ccode = name === "CCode" && eq > 0 ? segment.slice(eq + 1) : null;
  }
  return { verified: text === "CCode=0", ccode: seen === 1 ? ccode : null, html: false };
}

export type ReturnOutcome = "approved" | "hold" | "declined";

/**
 * Hold codes — never paid, never failed, always for manual review: 600 J2 check, 700 J5 authorization,
 * 800 postponed (money not captured), and 10 "Partial approval" (Shva — money may have moved, so it is
 * not treated as a decline). The DB settle functions use the same set (migration 208).
 */
const HOLD_CODES: ReadonlySet<string> = new Set(["10", "600", "700", "800"]);

/** The return's own `CCode`: exactly "0" → approved; 10/600/700/800 → hold; anything else (null too) → declined. */
export function classifyReturnCcode(ccode: string | null): ReturnOutcome {
  if (ccode === "0") return "approved";
  if (typeof ccode === "string" && HOLD_CODES.has(ccode)) return "hold";
  return "declined";
}
