// Online payments, platform scope — the platform admin's server functions for NURIEL's own terminal (platform
// host only; the orchestrator checks the host, the session and the rate limits; the DB checks the platform admin).
// Thin: input parsing here (pure), everything else in src/platform/payments/server/platform/terminal.ts, reached
// only by a dynamic import inside the handler (U17-B11). The terminal's KEY and password travel once, in the save's
// POST body; they are never returned. The types below are the only shapes the browser sees.
import { createServerFn } from "@tanstack/react-start";

export interface TerminalView {
  configured: boolean;
  /** the DB's environment marker */
  environment: "demo" | "production" | null;
  /** this server runs DEMO payments */
  demo: boolean;
  /** this server is ready for platform payments (environment + root key) */
  paymentsReady: boolean;
  flagOn: boolean;
  enabled: boolean;
  mode: "test" | "live" | null;
  status: "unverified" | "verified" | "failed" | null;
  lastVerifiedAt: string | null;
  /** the last 2 digits only, e.g. "••42" */
  terminalHint: string | null;
  hasApiKey: boolean;
  hasApiPassword: boolean;
  credentialsUpdatedAt: string | null;
  testAmountCapMinor: number | null;
  unknownReturns24h: { platform: number; tenant: number; lastAt: string | null };
  /** to copy into the Hyp portal (success URL of NURIEL's terminal) */
  successUrl: string | null;
}

/** what a step-up code approves: which fields change, and WHICH secrets change (never their values) */
export interface TerminalChange {
  terminalNumber: string | null;
  enabled: boolean | null;
  setApiKey: boolean;
  setApiPassword: boolean;
  clearCredentials: boolean;
  force: boolean;
}

export interface TerminalSave {
  terminalNumber: string | null;
  enabled: boolean | null;
  apiKey: string | null;
  apiPassword: string | null;
  clearCredentials: boolean;
  force: boolean;
  challengeId: string;
  code: string;
}

export interface CodeSent {
  challengeId: string;
  expiresAt: string;
  maskedEmail: string;
}

export interface TerminalTest {
  ok: boolean;
  code: string | null;
  status: TerminalView;
}

export interface CardPaymentRow {
  id: string;
  payerTenantId: string | null;
  payerLabel: string | null;
  targetLabel: string | null;
  amountMinor: number;
  state: string;
  mode: "test" | "live";
  applied: boolean;
  installments: number | null;
  cardBrand: string | null;
  cardLast4: string | null;
  approvalCode: string | null;
  providerTxnId: string | null;
  terminalHint: string | null;
  returnFlags: string[];
  reviewReason: string | null;
  reviewResolvedAt: string | null;
  createdAt: string | null;
  paidAt: string | null;
}

export interface UnreturnedRow {
  id: string;
  payerLabel: string | null;
  targetLabel: string | null;
  attemptNo: number | null;
  /** the payment reference (Order) to look up in the Hyp portal */
  reference: string | null;
  amountMinor: number;
  mode: "test" | "live";
  state: string;
  terminalHint: string | null;
  createdAt: string | null;
  signedAt: string | null;
  expiresAt: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INVALID = "הפרטים שהוזנו אינם תקינים";

const terminal = () => import("@/platform/payments/server/platform/terminal");

async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const { toPlatformError } = await import("@/platform/payments/server/platform/db");
    throw toPlatformError(error);
  }
}

const bool = (value: unknown) => value === true;
const optionalBool = (value: unknown) => (typeof value === "boolean" ? value : null);

/** digits only (spaces and dashes typed by hand are dropped); empty → no change */
function terminalNumberOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/[\s-]/g, "");
  if (digits === "") return null;
  if (!/^[0-9]{10}$/.test(digits)) throw new Error("מספר המסוף צריך להיות בן 10 ספרות");
  return digits;
}

/** a secret typed into the form: trimmed, bounded, no control characters; empty → unchanged */
function secretOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === "") return null;
  if (text.length > 256 || /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(text)) throw new Error(INVALID);
  return text;
}

export function parseTerminalChange(input: unknown): TerminalChange {
  const i = (input ?? {}) as Record<string, unknown>;
  return {
    terminalNumber: terminalNumberOf(i["terminalNumber"]),
    enabled: optionalBool(i["enabled"]),
    setApiKey: bool(i["setApiKey"]),
    setApiPassword: bool(i["setApiPassword"]),
    clearCredentials: bool(i["clearCredentials"]),
    force: bool(i["force"]),
  };
}

export function parseTerminalSave(input: unknown): TerminalSave {
  const i = (input ?? {}) as Record<string, unknown>;
  const challengeId = String(i["challengeId"] ?? "")
    .trim()
    .toLowerCase();
  const code = String(i["code"] ?? "").replace(/\s/g, "");
  if (!UUID.test(challengeId) || !/^[0-9]{6}$/.test(code))
    throw new Error("יש להזין את קוד האימות בן 6 הספרות שנשלח למייל");
  return {
    terminalNumber: terminalNumberOf(i["terminalNumber"]),
    enabled: optionalBool(i["enabled"]),
    apiKey: secretOf(i["apiKey"]),
    apiPassword: secretOf(i["apiPassword"]),
    clearCredentials: bool(i["clearCredentials"]),
    force: bool(i["force"]),
    challengeId,
    code,
  };
}

export const platformTerminalStatus = createServerFn({ method: "POST" }).handler(
  async (): Promise<TerminalView> =>
    guarded(async () => (await terminal()).platformTerminalStatus()),
);

/** step 1 of a save: e-mails a code bound to this change (no secret value is sent here) */
export const platformTerminalRequestCode = createServerFn({ method: "POST" })
  .inputValidator((input: TerminalChange) => parseTerminalChange(input))
  .handler(async ({ data }): Promise<CodeSent> =>
    guarded(async () => (await terminal()).requestTerminalSaveCode(data)),
  );

/** step 2: the same change + the secrets + the code (consumed before the save, DM-SEP-6) */
export const platformTerminalSave = createServerFn({ method: "POST" })
  .inputValidator((input: TerminalSave) => parseTerminalSave(input))
  .handler(async ({ data }): Promise<TerminalView> =>
    guarded(async () => (await terminal()).savePlatformTerminal(data)),
  );

/** free connection check: SIGN of ₪1, never opened, nothing charged */
export const platformTerminalTest = createServerFn({ method: "POST" }).handler(
  async (): Promise<TerminalTest> => guarded(async () => (await terminal()).testPlatformTerminal()),
);

export const platformCardPayments = createServerFn({ method: "POST" })
  .inputValidator((input: { tenantId?: string | null } | undefined) => {
    const raw = input?.tenantId;
    if (raw === undefined || raw === null || raw === "") return { tenantId: null };
    const tenantId = String(raw).trim().toLowerCase();
    if (!UUID.test(tenantId)) throw new Error(INVALID);
    return { tenantId };
  })
  .handler(async ({ data }): Promise<CardPaymentRow[]> =>
    guarded(async () => (await terminal()).platformCardPaymentsList(data)),
  );

export const platformUnreturnedAttempts = createServerFn({ method: "POST" }).handler(
  async (): Promise<UnreturnedRow[]> =>
    guarded(async () => (await terminal()).platformUnreturnedList()),
);

export const platformCardPaymentResolve = createServerFn({ method: "POST" })
  .inputValidator((input: { attemptId: string; note?: string | null }) => {
    const attemptId = String(input?.attemptId ?? "")
      .trim()
      .toLowerCase();
    if (!UUID.test(attemptId)) throw new Error(INVALID);
    const note = String(input?.note ?? "")
      .trim()
      .slice(0, 500);
    return { attemptId, note: note === "" ? null : note };
  })
  .handler(async ({ data }): Promise<{ resolved: boolean }> =>
    guarded(async () => (await terminal()).resolvePlatformCardPayment(data)),
  );
