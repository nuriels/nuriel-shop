/**
 * Online payments, platform scope — the scope's DB caller and its error type (server only).
 *
 * • platformPaymentsRpc: the shared service-role adapter (server/db.ts — unscoped, no tenant header) limited to the
 *   platform scope's own functions. Names are matched by pattern, so each sole-caller function (settle, secrets,
 *   raw-return keep/get, terminal save) is named only in its one file (U17-B4); no store function, no step-up
 *   function (stepup.ts has its own caller). Never throws: { data, error }.
 * • platformCall(rpc, fn, args): the arguments are checked against the typed DB API (through paymentsRpc's own
 *   signature) while the injected rpc stays a plain function (the unit tests pass a fake).
 * • PlatformPaymentError: what a caller may show. The DB's RAISE texts (English) are mapped to fixed Hebrew; any
 *   other failure is a generic text plus a log line with the function name and the SQLSTATE only.
 */
import { paymentsRpc, type PaymentsDbError, type PaymentsFn } from "@/platform/payments/server/db";
import type { PlatformLogger } from "./log";

/** the platform scope's functions of migration 208 (a pattern: see the header) */
export type PlatformFn =
  | `platform_attempt_${string}`
  | `platform_attempts_${string}`
  | `platform_terminal_${string}`
  | `platform_card_${string}`
  | `platform_return_${string}`
  | "platform_unreturned_attempts"
  | "platform_payment_unknown_return"
  | "platform_payment_returns_purge";

const PLATFORM_FN =
  /^platform_(?:attempts?_[a-z0-9_]+|terminal_[a-z0-9_]+|card_[a-z0-9_]+|return_[a-z0-9_]+|unreturned_attempts|payment_unknown_return|payment_returns_purge)$/;

export type PlatformRpcResult = { data: unknown; error: PaymentsDbError | null };
/** the injected DB caller (production: platformPaymentsRpc) */
export type PlatformRpc = (
  fn: PlatformFn,
  args: Record<string, unknown>,
) => Promise<PlatformRpcResult>;

type LooseCall = (fn: string, args?: object) => Promise<PlatformRpcResult>;

export const platformPaymentsRpc: PlatformRpc = async (fn, args) => {
  if (!PLATFORM_FN.test(fn)) {
    return { data: null, error: { message: "payments: function not allowed", code: null } };
  }
  const call = paymentsRpc as unknown as LooseCall;
  return Object.keys(args).length === 0 ? call(fn) : call(fn, args);
};

/** the typed arguments of a declared DB function; an undeclared one (newer than the typed API) is unchecked */
type DeclaredArgs<F extends PaymentsFn> =
  Parameters<typeof paymentsRpc<F>> extends [unknown, infer A] ? A : Record<string, never>;
export type PlatformArgs<F extends PlatformFn> = F extends PaymentsFn
  ? DeclaredArgs<F>
  : Record<string, unknown>;

export function platformCall<F extends PlatformFn>(
  rpc: PlatformRpc,
  fn: F,
  args: PlatformArgs<F>,
): Promise<PlatformRpcResult> {
  return rpc(fn, args as Record<string, unknown>);
}

// ------------------------------------------------------------------------------------------------ results

export type Row = Readonly<Record<string, unknown>>;

/** a jsonb object answer (supabase-js gives parsed JSON; a JSON string or a one-row array is accepted) */
export function asRow(data: unknown): Row | null {
  let value = data;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (Array.isArray(value) && value.length === 1) value = value[0];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : null;
}

/** a jsonb array answer of objects (anything else is dropped) */
export function asRows(data: unknown): Row[] {
  let value = data;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }
  return Array.isArray(value)
    ? value.filter((v): v is Row => v !== null && typeof v === "object" && !Array.isArray(v))
    : [];
}

export const text = (row: Row | null, name: string): string | null => {
  const v = row?.[name];
  return typeof v === "string" ? v : null;
};
export const int = (row: Row | null, name: string): number | null => {
  const v = row?.[name];
  const n = typeof v === "string" && /^-?[0-9]{1,15}$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) ? n : null;
};
export const flag = (row: Row | null, name: string): boolean => row?.[name] === true;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const uuid = (row: Row | null, name: string): string | null => {
  const v = text(row, name)?.toLowerCase() ?? null;
  return v !== null && UUID.test(v) ? v : null;
};

// ------------------------------------------------------------------------------------------------ errors

export type PlatformErrorCode =
  | "login"
  | "not_owner"
  | "not_admin"
  | "store_only"
  | "platform_only"
  | "unavailable"
  | "not_payable"
  | "already_paid"
  | "verifying"
  | "too_many"
  | "test_cap"
  | "sign_failed"
  | "credentials"
  | "stepup_required"
  | "stepup_failed"
  | "stepup_expired"
  | "stepup_wrong"
  | "stepup_locked"
  | "stepup_mismatch"
  | "stepup_send"
  | "terminal_invalid"
  | "terminal_taken"
  | "force_needed"
  | "invalid"
  | "rate_limited"
  | "generic";

export const PLATFORM_ERROR_TEXT: Readonly<Record<PlatformErrorCode, string>> = Object.freeze({
  login: "נדרשת התחברות",
  not_owner: "רק בעלי העסק יכולים לשלם כאן",
  not_admin: "הפעולה מותרת רק למנהלי הפלטפורמה",
  store_only: "את התשלום אפשר להתחיל רק מפאנל הניהול של העסק",
  platform_only: "הפעולה זמינה רק בפאנל הפלטפורמה",
  unavailable: "התשלום המקוון אינו זמין כרגע",
  not_payable: "אי אפשר לשלם את החיוב הזה בתשלום מקוון",
  already_paid: "החיוב כבר שולם",
  verifying: "התשלום נמצא בבדיקה. אפשר לרענן בעוד רגע.",
  too_many: "נעשו יותר מדי ניסיונות תשלום לחיוב הזה. כדאי לפנות לצוות NURIEL.",
  test_cap: "בסביבת DEMO אפשר לשלם עד 50 ₪ בכל תשלום",
  sign_failed: "לא ניתן לפתוח את דף התשלום כרגע. אפשר לנסות שוב.",
  credentials: "יש להזין מחדש את פרטי המסוף",
  stepup_required: "יש לאשר את השינוי בקוד האימות שנשלח למייל",
  stepup_failed: "קוד האימות לא התקבל. אפשר לבקש קוד חדש.",
  stepup_expired: "תוקף קוד האימות פג. אפשר לבקש קוד חדש.",
  stepup_wrong: "קוד האימות שגוי. אפשר לנסות שוב.",
  stepup_locked: "היו יותר מדי ניסיונות עם הקוד הזה. אפשר לבקש קוד חדש.",
  stepup_mismatch: "הקוד נשלח לשינוי אחר. אחרי שינוי בפרטים יש לבקש קוד חדש.",
  stepup_send: "לא ניתן לשלוח את קוד האימות כרגע. אפשר לנסות שוב בעוד כמה דקות.",
  terminal_invalid: "בסביבת DEMO אפשר להגדיר רק מסוף בדיקות (מספר בן 10 ספרות שמתחיל ב-00100)",
  terminal_taken: "מספר המסוף הזה כבר משויך לחשבון אחר",
  // = TERMINAL_FORCE_NEEDED_TEXT (pay-terminal.functions.ts): the page recognises it and asks for confirmation
  force_needed:
    "יש תשלום לפלטפורמה שעדיין בתהליך (דף תשלום שנפתח וטרם הסתיים, או תשלום שממתין לאימות). שמירה עכשיו תעביר אותו לבדיקה ידנית.",
  invalid: "הפרטים שהוזנו אינם תקינים",
  rate_limited: "יותר מדי ניסיונות. אפשר לנסות שוב בעוד כמה דקות.",
  generic: "הפעולה לא הושלמה. אפשר לנסות שוב בעוד כמה דקות.",
});

/** The only error the platform payment code lets out: a fixed code and its fixed Hebrew text, no stack. */
export class PlatformPaymentError extends Error {
  readonly code: PlatformErrorCode;
  constructor(code: PlatformErrorCode) {
    super(PLATFORM_ERROR_TEXT[code]);
    this.name = "PlatformPaymentError";
    this.code = code;
    this.stack = "";
  }
}

/** the DB's RAISE texts of the platform functions (migration 208) → a fixed code */
const DB_MESSAGES: readonly (readonly [RegExp, PlatformErrorCode])[] = [
  [/environments differ/i, "unavailable"],
  [/only the owner of the business pays/i, "not_owner"],
  [/only (?:the|a) platform admin/i, "not_admin"],
  [/not available for this business/i, "not_payable"],
  [/unknown payable item|cannot be paid online|amount out of range/i, "not_payable"],
  [/already paid|already covered/i, "already_paid"],
  [/save again with force/i, "force_needed"],
  [/payment of this item is being verified/i, "verifying"],
  [/too many payment attempts/i, "too_many"],
  [/too many verification codes/i, "rate_limited"],
  [/test payments are limited to 50/i, "test_cap"],
  [
    /not available right now|no longer configured|cannot be signed|online payments are off/i,
    "unavailable",
  ],
  [/verification code sent by email first|step-up/i, "stepup_required"],
  [/one payment only/i, "invalid"],
  [/only test terminals|only live terminals/i, "terminal_invalid"],
  [
    /already registered|cannot be moved to another owner|stays bound to its owner/i,
    "terminal_taken",
  ],
  [/not fully configured/i, "credentials"],
  [/invalid settings|clear or replace the credentials/i, "invalid"],
];

/** maps a DB failure to the error a caller may throw; unknown ones are logged (function + SQLSTATE only) */
export function dbFailure(
  error: PaymentsDbError,
  fn: PlatformFn,
  log: PlatformLogger,
): PlatformPaymentError {
  const message = String(error.message ?? "");
  for (const [re, code] of DB_MESSAGES) if (re.test(message)) return new PlatformPaymentError(code);
  log.error("db", { fn, sqlstate: error.code ?? "none" });
  return new PlatformPaymentError("generic");
}

/** any failure → what a caller may let out (a PlatformPaymentError stays itself) */
export function toPlatformError(error: unknown): PlatformPaymentError {
  return error instanceof PlatformPaymentError ? error : new PlatformPaymentError("generic");
}
