/**
 * Online payments, tenant scope — the scope's only log writer: "[pay:tenant] <event> k=v …".
 * Every line passes the single redactor (DM-SEC-7). Callers give fixed event names and short codes only — never a
 * URL, a query, a body, a credential, an e-mail, a name or an amount. `alert` lines mark what a person must look
 * at (review, environment mismatch, refused credentials); monitoring counts them.
 */
import { redactPaymentText } from "@/platform/payments/redact";

type Field = string | number | boolean | null | undefined;

function line(event: string, fields: Readonly<Record<string, Field>>): string {
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([name, value]) => `${name}=${String(value)}`);
  return redactPaymentText(`[pay:tenant] ${event}${parts.length > 0 ? ` ${parts.join(" ")}` : ""}`);
}

export const tenantLog = Object.freeze({
  info(event: string, fields: Readonly<Record<string, Field>> = {}): void {
    console.log(line(event, fields));
  },
  warn(event: string, fields: Readonly<Record<string, Field>> = {}): void {
    console.warn(line(event, fields));
  },
  error(event: string, fields: Readonly<Record<string, Field>> = {}): void {
    console.error(line(event, fields));
  },
  alert(event: string, fields: Readonly<Record<string, Field>> = {}): void {
    console.error(line(`ALERT ${event}`, fields));
  },
});

/** the first 8 characters of an id or reference — enough to find the row, nothing more */
export function shortId(id: unknown): string {
  return typeof id === "string" && id.length > 0 ? id.slice(0, 8) : "-";
}
