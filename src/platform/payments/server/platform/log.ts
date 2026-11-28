/**
 * Online payments, platform scope — the scope's only logger (DM-SEC-7, U17 rule): one line per event,
 * "[pay:platform] <event> name=value …", always passed through redactPaymentText. Callers log short ids (8
 * characters), codes, results and reasons — never a URL, a query, a body, a credential, an e-mail or an amount.
 */
import { redactPaymentText } from "@/platform/payments/redact";

export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Readonly<Record<string, LogValue>>;

const EVENT = /^[a-z][a-z0-9_.:-]{0,63}$/;
const NAME = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * One field value: redacted FIRST (with its name, so `masof=…` or an embedded `PassP=…` is masked), then any run of
 * 9+ digits keeps its last 2 only (terminal-number or card-like), then one token — nothing that could split the line
 * or fake another field (no log injection) — bounded.
 */
function valueToken(name: string, value: Exclude<LogValue, null | undefined>): string {
  const redacted = redactPaymentText(`${name}=${String(value)}`);
  return redacted
    .slice(redacted.indexOf("=") + 1)
    .replace(/[0-9]{9,}/g, (run) => `#${run.slice(-2)}`)
    .replace(/[^A-Za-z0-9_.:+#-]/g, "_")
    .slice(0, 80);
}

/** the redacted line (exported for the tests) */
export function platformLine(event: string, fields: LogFields = {}, alert = false): string {
  const parts = [`[pay:platform]${alert ? " ALERT" : ""} ${EVENT.test(event) ? event : "event"}`];
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === null || !NAME.test(name)) continue;
    parts.push(`${name}=${valueToken(name, value)}`);
  }
  return redactPaymentText(parts.join(" "));
}

export interface PlatformLogger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** an operator alert: review, duplicate charge, environment mismatch, terminal credentials refused */
  alert(event: string, fields?: LogFields): void;
}

export const platformLog: PlatformLogger = {
  info: (event, fields) => console.log(platformLine(event, fields)),
  warn: (event, fields) => console.warn(platformLine(event, fields)),
  error: (event, fields) => console.error(platformLine(event, fields)),
  alert: (event, fields) => console.error(platformLine(event, fields, true)),
};

/** the first 8 characters of an id — log lines and alerts never carry a whole id */
export const shortId = (id: unknown): string =>
  typeof id === "string" && /^[0-9a-f-]{8,}$/i.test(id) ? id.slice(0, 8) : "-";
