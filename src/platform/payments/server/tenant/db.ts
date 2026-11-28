/**
 * Online payments, tenant scope — DB result handling for the store side.
 *
 * Calls go through the shared adapter (paymentsRpc, ../db.ts: the unscoped service role, every function takes the
 * store explicitly). Here: the fixed Hebrew text for each DB refusal (a DB text never reaches a browser as is),
 * one error type for the scope, and small readers for the jsonb answers (Json → typed values, nothing trusted).
 */
import { PAYMENT_MESSAGES } from "@/platform/payments/max/messages";
import { ONLINE_OVER_DEMO_CAP, TERMINAL_SAVE_NEEDS_FORCE } from "@/platform/payments/tenant-views";
import type { PaymentsDbError, PaymentsRpcResult } from "@/platform/payments/server/db";
import { tenantLog } from "./log";

export const UNAVAILABLE = PAYMENT_MESSAGES.unavailable;
export const GENERIC_FAILURE = "הפעולה נכשלה. אפשר לנסות שוב.";

/** a refusal the browser may see: the message is always one of this module's fixed texts */
export class TenantPaymentError extends Error {
  readonly kind: "refused" | "unavailable" | "credentials";
  constructor(message: string, kind: "refused" | "unavailable" | "credentials" = "refused") {
    super(message);
    this.name = "TenantPaymentError";
    this.kind = kind;
  }
}

/** DB text (migration 208 RAISE messages) → fixed Hebrew; first match wins */
const DB_MESSAGES: readonly (readonly [RegExp, string])[] = [
  [/environments differ/i, UNAVAILABLE],
  [/limited to 50 ILS/i, ONLINE_OVER_DEMO_CAP],
  [/not available (?:in this store )?right now/i, UNAVAILABLE],
  [/order not found/i, "ההזמנה לא נמצאה"],
  [/store not found/i, "החנות לא נמצאה"],
  [/too many payment attempts/i, "נעשו יותר מדי ניסיונות תשלום להזמנה הזו. כדאי לפנות לחנות."],
  [/payment window .* is closing/i, "הזמן לתשלום ההזמנה מסתיים. אפשר לבצע הזמנה חדשה."],
  [/with force/i, TERMINAL_SAVE_NEEDS_FORCE],
  [/is being verified/i, "התשלום נמצא בבדיקה. אפשר לרענן את העמוד בעוד רגע."],
  [/not awaiting an online payment/i, "ההזמנה כבר לא ממתינה לתשלום"],
  [/no payable amount/i, "לא נמצא סכום לתשלום בהזמנה"],
  [/not fully configured|no longer configured/i, "פרטי המסוף לא הושלמו"],
  [
    /clear or replace the credentials/i,
    "אפשר למחוק את פרטי המסוף או להחליף אותם — לא את שניהם יחד",
  ],
  [/invalid settings|invalid_parameter|malformed/i, "ההגדרות שנשלחו לא תקינות"],
  [
    /terminal.*(?:registered|belongs|another|in use)|already (?:registered|used)/i,
    "מספר המסוף כבר רשום לחנות אחרת או לפלטפורמה",
  ],
  [/(?:live|test).*(?:not allowed|refused)|prefix|00100/i, "מספר המסוף או המצב לא מתאימים לסביבה"],
  [
    /only (?:the|a) (?:platform admin|store admin|store owner)|not allowed|insufficient_privilege|permission denied/i,
    "אין הרשאה לפעולה הזו",
  ],
];

export function tenantDbMessage(error: PaymentsDbError): string {
  for (const [pattern, text] of DB_MESSAGES) if (pattern.test(error.message)) return text;
  return GENERIC_FAILURE;
}

/**
 * A transport or transient failure, where no function decided anything: no SQLSTATE (network, the adapter's own
 * "database unavailable"), a PostgREST code, or the connection / serialization / resources / shutdown classes.
 * Every other error is the database's answer — a refusal the caller must act on, never retry silently.
 */
export function dbUnreachable(error: PaymentsDbError): boolean {
  const code = error.code ?? "";
  return !/^[0-9A-Z]{5}$/.test(code) || /^(?:08|40|53|57)/.test(code);
}

/** the data of a call, or a TenantPaymentError with the fixed text (logged with the function name and SQLSTATE) */
export function unwrap<T>(fn: string, result: PaymentsRpcResult<T>): T {
  if (result.error) {
    const text = tenantDbMessage(result.error);
    const kind = text === UNAVAILABLE || text === GENERIC_FAILURE ? "unavailable" : "refused";
    if (/environments differ/i.test(result.error.message))
      tenantLog.alert("environment_mismatch", { fn });
    else tenantLog.warn("db_refused", { fn, code: result.error.code });
    throw new TenantPaymentError(text, kind);
  }
  return result.data as T;
}

// ------------------------------------------------------------------ jsonb readers (nothing is trusted)

export type JsonRecord = Readonly<Record<string, unknown>>;

export function asRecord(value: unknown): JsonRecord | null {
  if (Array.isArray(value) && value.length === 1) return asRecord(value[0]);
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export const str = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

export const int = (value: unknown): number | null => {
  const n = typeof value === "string" && /^-?[0-9]+$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) ? n : null;
};

export const bool = (value: unknown): boolean => value === true;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const uuid = (value: unknown): string | null => {
  const text = typeof value === "string" ? value.toLowerCase() : "";
  return UUID.test(text) ? text : null;
};

const REFERENCE = /^[0-9a-f]{32}$/;
export const reference = (value: unknown): string | null =>
  typeof value === "string" && REFERENCE.test(value) ? value : null;

export const modeOf = (value: unknown): "test" | "live" | null =>
  value === "test" || value === "live" ? value : null;
