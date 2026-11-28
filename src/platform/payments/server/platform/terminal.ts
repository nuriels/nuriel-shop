/**
 * Online payments, platform scope — NURIEL's own terminal, for the platform admin (plan §4.3; arch §5, §8.7).
 *
 * • Platform host and a verified session only; the DB checks the platform admin on every call (service role with
 *   an explicit _actor that comes from the session, never from input).
 * • Saving needs a step-up first (DM-SEP-6): a 6-digit code e-mailed to the admin, bound to the admin and to the
 *   exact change set (which fields and which secrets change — not the secret values), 10 minutes, ≤ 5 tries,
 *   single use (stepup.ts + the DB). This file is the sole caller of platform_terminal_save (U17-B4) and consumes
 *   the challenge right before it. The secret values travel once, in the save's POST body; they are sealed here
 *   with the platform cipher (account id of NURIEL's terminal) and never logged, returned or kept.
 * • Test connection: SIGN of ₪1 with a random reference — nothing is charged (the page is never opened). Only a
 *   terminal checked this way takes payments (the DB requires status "verified").
 * • Lists: payments to NURIEL (review items, resolve) and "sent to Hyp and never returned" (reconciliation, M9).
 */
import { randomBytes } from "node:crypto";
import type {
  CardPaymentRow,
  CodeSent,
  TerminalChange,
  TerminalSave,
  TerminalTest,
  TerminalView,
  UnreturnedRow,
} from "@/platform/billing/pay-terminal.functions";
import { escapeHtml, sendBusinessEmail } from "@/platform/email/send.server";
import type { PaymentMode } from "@/platform/payments/provider";
import {
  buildSignParams,
  encodeParams,
  validateSignResponse,
} from "@/platform/payments/max/protocol";
import { accountEmail, stepupRpc } from "@/platform/payments/server/db";
import {
  hypEndpoint,
  modeAllowed,
  paymentsEnv,
  paymentsReady,
  terminalAllowed,
  type PaymentsEnv,
} from "@/platform/payments/server/env";
import { hypRequest } from "@/platform/payments/server/http";
import {
  PLATFORM_ACCOUNT_ID,
  platformSecretCipher,
  stepupKey,
} from "@/platform/payments/server/platform-keys";
import { createStepupService, stepupPurposeHash } from "@/platform/payments/server/stepup";
import { allowAction } from "@/platform/security/rate-limit.server";
import { isPlatformHost } from "@/platform/tenancy/current-site.server";
import {
  platformTerminalCheckCredentials,
  type PlatformCipher,
  type TerminalSecrets,
} from "./credentials";
import {
  PlatformPaymentError,
  asRow,
  asRows,
  dbFailure,
  flag,
  int,
  platformCall,
  platformPaymentsRpc,
  text,
  uuid,
  type PlatformErrorCode,
  type PlatformRpc,
  type Row,
} from "./db";
import { platformLog, type PlatformLogger } from "./log";

type Ready = { ok: true; env: PaymentsEnv } | { ok: false; reason: string };
type StepupService = ReturnType<typeof createStepupService>;

/** the step-up purpose of a change of NURIEL's terminal (stepup.ts) */
const TERMINAL_PURPOSE = "platform_terminal_change";

/** the change set a code is bound to (never a secret value) */
export type TerminalIntent = {
  mode: PaymentMode;
  terminal_number: string | null;
  enabled: boolean | null;
  set_api_key: boolean;
  set_api_password: boolean;
  clear_credentials: boolean;
  force: boolean;
  max_installments: 1;
};

export interface TerminalDeps {
  isPlatformHost(): Promise<boolean>;
  session(): Promise<{ userId: string } | null>;
  platformOrigin(): Promise<string | null>;
  ready(): Ready;
  /** the environment marker alone (the DEMO notice), whether or not the root key is ready */
  paymentsEnv(): PaymentsEnv | null;
  endpoint(): string;
  allow(key: string, limit: number, windowMs: number): boolean;
  rpc: PlatformRpc;
  stepup(env: PaymentsEnv): StepupService;
  purposeHash(actorId: string, intent: TerminalIntent): string;
  cipher(env: PaymentsEnv, mode: PaymentMode): PlatformCipher;
  checkCredentials(actorId: string, env: PaymentsEnv): Promise<TerminalSecrets>;
  accountEmail(userId: string): Promise<string | null>;
  sendEmail: typeof sendBusinessEmail;
  http: typeof hypRequest;
  randomReference(): string;
  log: PlatformLogger;
}

const HOST = /^([a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?)(?::([0-9]{1,5}))?$/;

/** the platform host's origin as the browser sees it (http and the port only on a local *.localhost stack) */
async function requestPlatformOrigin(): Promise<string | null> {
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();
  if (!request) return null;
  let urlHost = "";
  try {
    urlHost = new URL(request.url).host;
  } catch {
    urlHost = "";
  }
  const raw = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? urlHost)
    .split(",")[0]!
    .trim()
    .toLowerCase();
  const match = HOST.exec(raw);
  if (!match) return null;
  const hostname = match[1]!;
  const local = hostname === "localhost" || hostname.endsWith(".localhost");
  return local ? `http://${raw}` : `https://${hostname}`;
}

export const defaultTerminalDeps: TerminalDeps = {
  isPlatformHost,
  session: async () => {
    try {
      const { sessionFromRequest } = await import("@/platform/auth/session.server");
      const session = await sessionFromRequest();
      return session ? { userId: session.userId } : null;
    } catch {
      return null;
    }
  },
  platformOrigin: requestPlatformOrigin,
  ready: () => paymentsReady("platform"),
  paymentsEnv,
  endpoint: hypEndpoint,
  allow: allowAction,
  rpc: platformPaymentsRpc,
  stepup: (env) => createStepupService(stepupRpc, stepupKey(env)),
  purposeHash: (actorId, intent) => stepupPurposeHash(actorId, TERMINAL_PURPOSE, intent),
  cipher: platformSecretCipher,
  checkCredentials: (actorId, env) => platformTerminalCheckCredentials(actorId, env),
  accountEmail,
  sendEmail: sendBusinessEmail,
  http: hypRequest,
  randomReference: () => randomBytes(16).toString("hex"),
  log: platformLog,
};

const MINUTES_15 = 15 * 60_000;
const HYP_OPTIONS = { method: "GET", timeoutMs: 15_000, maxBytes: 64 * 1024 } as const;
const MASOF = /^[0-9]{10}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SIX_DIGITS = /^[0-9]{6}$/;
/** the same rule as the protocol builders: printable, bounded, no control or format characters */
const CREDENTIAL = /^[^\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]{1,256}$/u;

/** DEMO: test only; production: live only (decision ה-4) */
const modeFor = (env: PaymentsEnv): PaymentMode => (env === "demo" ? "test" : "live");

async function admin(
  deps: TerminalDeps,
  limit: readonly [action: string, count: number],
): Promise<{ actorId: string; env: PaymentsEnv }> {
  if (!(await deps.isPlatformHost())) throw new PlatformPaymentError("platform_only");
  const session = await deps.session();
  if (!session) throw new PlatformPaymentError("login");
  if (!deps.allow(`pay-term:${limit[0]}:${session.userId}`, limit[1], MINUTES_15))
    throw new PlatformPaymentError("rate_limited");
  const ready = deps.ready();
  if (!ready.ok) {
    deps.log.warn("terminal_off", { reason: ready.reason });
    throw new PlatformPaymentError("unavailable");
  }
  return { actorId: session.userId, env: ready.env };
}

// ------------------------------------------------------------------------------------------ views

const STATUSES: readonly string[] = ["unverified", "verified", "failed"];
const hint = (value: string | null) => {
  const digits = (value ?? "").replace(/[^0-9]/g, "");
  return digits.length >= 2 ? `••${digits.slice(-2)}` : null;
};

function viewOf(
  row: Row | null,
  origin: string | null,
  server: { demo: boolean; ready: boolean },
): TerminalView {
  const status = text(row, "status");
  const mode = text(row, "mode");
  const environment = text(row, "environment");
  const unknown = asRow(row?.["unknown_returns"]);
  return {
    configured: flag(row, "configured"),
    environment: environment === "demo" || environment === "production" ? environment : null,
    demo: server.demo,
    paymentsReady: server.ready,
    flagOn: flag(row, "flag"),
    enabled: flag(row, "enabled"),
    mode: mode === "test" || mode === "live" ? mode : null,
    status:
      status !== null && STATUSES.includes(status) ? (status as TerminalView["status"]) : null,
    lastVerifiedAt: text(row, "last_verified_at"),
    terminalHint: hint(text(row, "terminal_hint")),
    hasApiKey: flag(row, "has_api_key"),
    hasApiPassword: flag(row, "has_api_password"),
    credentialsUpdatedAt: text(row, "credentials_updated_at"),
    testAmountCapMinor: int(row, "test_amount_cap_minor"),
    unknownReturns24h: {
      platform: int(unknown, "platform_24h") ?? 0,
      tenant: int(unknown, "tenant_24h") ?? 0,
      lastAt: text(unknown, "last_at"),
    },
    successUrl: origin ? `${origin}/platform/payments/return/max` : null,
  };
}

const serverOf = (deps: TerminalDeps, ready: boolean) => ({
  demo: deps.paymentsEnv() === "demo",
  ready,
});

async function statusRow(actorId: string, deps: TerminalDeps): Promise<Row | null> {
  const answer = await platformCall(deps.rpc, "platform_terminal_status", { _actor: actorId });
  if (answer.error) throw dbFailure(answer.error, "platform_terminal_status", deps.log);
  return asRow(answer.data);
}

export async function platformTerminalStatus(
  deps: TerminalDeps = defaultTerminalDeps,
): Promise<TerminalView> {
  if (!(await deps.isPlatformHost())) throw new PlatformPaymentError("platform_only");
  const session = await deps.session();
  if (!session) throw new PlatformPaymentError("login");
  if (!deps.allow(`pay-term:status:${session.userId}`, 60, MINUTES_15))
    throw new PlatformPaymentError("rate_limited");
  // the status is readable even when payments are off on this server (the page says why)
  const ready = deps.ready();
  const row = await statusRow(session.userId, deps);
  return viewOf(row, await deps.platformOrigin(), serverOf(deps, ready.ok));
}

// ------------------------------------------------------------------------------------------ step-up + save

function checkChange(change: TerminalChange, env: PaymentsEnv): void {
  if (change.terminalNumber !== null) {
    if (!MASOF.test(change.terminalNumber) || !terminalAllowed(env, change.terminalNumber))
      throw new PlatformPaymentError("terminal_invalid");
  }
  if (change.clearCredentials && (change.setApiKey || change.setApiPassword))
    throw new PlatformPaymentError("invalid");
  const changes =
    change.terminalNumber !== null ||
    change.enabled !== null ||
    change.setApiKey ||
    change.setApiPassword ||
    change.clearCredentials;
  if (!changes) throw new PlatformPaymentError("invalid");
}

export function intentOf(change: TerminalChange, env: PaymentsEnv): TerminalIntent {
  return {
    mode: modeFor(env),
    terminal_number: change.terminalNumber,
    enabled: change.enabled,
    set_api_key: change.setApiKey,
    set_api_password: change.setApiPassword,
    clear_credentials: change.clearCredentials,
    force: change.force,
    max_installments: 1,
  };
}

const maskEmail = (email: string) => {
  const [name = "", domain = ""] = email.split("@");
  return `${name.slice(0, 1)}***@${domain}`;
};

function codeEmail(code: string) {
  return {
    subject: "קוד אימות לשמירת מסוף הפלטפורמה",
    html: `<div dir="rtl" style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.6">
<p>קוד האימות לשמירת השינוי במסוף הפלטפורמה של NURIEL:</p>
<p dir="ltr" style="font-size:28px;font-weight:bold;letter-spacing:6px">${escapeHtml(code)}</p>
<p>הקוד תקף ל-10 דקות ולשינוי אחד בלבד.</p>
<p>לא ביקשתם את הקוד? אפשר להתעלם מההודעה: בלי הקוד שום דבר לא משתנה.</p>
</div>`,
  };
}

export async function requestTerminalSaveCode(
  change: TerminalChange,
  deps: TerminalDeps = defaultTerminalDeps,
): Promise<CodeSent> {
  const { actorId, env } = await admin(deps, ["code", 5]);
  checkChange(change, env);
  const purposeHash = deps.purposeHash(actorId, intentOf(change, env));
  const email = await deps.accountEmail(actorId);
  if (!email) throw new PlatformPaymentError("stepup_send");
  let issued: { challengeId: string; code: string; expiresAt: string };
  try {
    issued = await deps.stepup(env).issue(actorId, purposeHash);
  } catch {
    deps.log.warn("stepup_issue", {});
    throw new PlatformPaymentError("stepup_send");
  }
  const { subject, html } = codeEmail(issued.code);
  const sent = await deps.sendEmail({
    to: email,
    subject,
    html,
    senderName: "NURIEL",
    replyTo: null,
    idempotencyKey: `stepup:${issued.challengeId}`,
  });
  if (!sent.sent) {
    deps.log.warn("stepup_email", { skipped: sent.skipped });
    throw new PlatformPaymentError("stepup_send");
  }
  deps.log.info("stepup_sent", {});
  return {
    challengeId: issued.challengeId,
    expiresAt: issued.expiresAt,
    maskedEmail: maskEmail(email),
  };
}

const STEPUP_REASON: Readonly<Record<string, PlatformErrorCode>> = {
  expired: "stepup_expired",
  wrong_code: "stepup_wrong",
  locked: "stepup_locked",
  purpose_mismatch: "stepup_mismatch",
};

export async function savePlatformTerminal(
  input: TerminalSave,
  deps: TerminalDeps = defaultTerminalDeps,
): Promise<TerminalView> {
  const { actorId, env } = await admin(deps, ["save", 10]);
  const change: TerminalChange = {
    terminalNumber: input.terminalNumber,
    enabled: input.enabled,
    setApiKey: input.apiKey !== null,
    setApiPassword: input.apiPassword !== null,
    clearCredentials: input.clearCredentials,
    force: input.force,
  };
  checkChange(change, env);
  if (
    (input.apiKey !== null && !CREDENTIAL.test(input.apiKey)) ||
    (input.apiPassword !== null && !CREDENTIAL.test(input.apiPassword))
  )
    throw new PlatformPaymentError("invalid");
  if (!UUID.test(input.challengeId) || !SIX_DIGITS.test(input.code))
    throw new PlatformPaymentError("stepup_failed");

  // DM-SEP-6: the code must approve exactly this change, for this admin, right now (single use)
  const consumed = await deps
    .stepup(env)
    .consume(
      actorId,
      input.challengeId,
      deps.purposeHash(actorId, intentOf(change, env)),
      input.code,
    );
  if (!consumed.ok) {
    deps.log.warn("stepup_refused", { reason: consumed.reason ?? "refused" });
    throw new PlatformPaymentError(STEPUP_REASON[consumed.reason ?? ""] ?? "stepup_failed");
  }

  const mode = modeFor(env);
  const patch: Record<string, string | boolean | number> = {
    mode,
    terminal_max_installments: 1,
    max_installments: 1,
  };
  if (change.terminalNumber !== null) patch["terminal_number"] = change.terminalNumber;
  if (change.enabled !== null) patch["enabled"] = change.enabled;
  if (input.apiKey !== null || input.apiPassword !== null) {
    const cipher = deps.cipher(env, mode);
    const ctx = { accountId: PLATFORM_ACCOUNT_ID };
    if (input.apiKey !== null) patch["api_key_enc"] = cipher.seal("api_key", input.apiKey, ctx);
    if (input.apiPassword !== null)
      patch["api_password_enc"] = cipher.seal("api_password", input.apiPassword, ctx);
    patch["key_id"] = cipher.kid;
  }
  if (change.clearCredentials) patch["clear_credentials"] = true;
  if (change.force) patch["force"] = true;

  const saved = await platformCall(deps.rpc, "platform_terminal_save", {
    _actor: actorId,
    _patch: patch,
    _app_environment: env,
  });
  if (saved.error) throw dbFailure(saved.error, "platform_terminal_save", deps.log);
  deps.log.info("terminal_saved", {
    terminal: change.terminalNumber !== null,
    enabled: change.enabled,
    credentials: change.setApiKey || change.setApiPassword,
    cleared: change.clearCredentials,
    forced: change.force,
  });
  return viewOf(asRow(saved.data), await deps.platformOrigin(), serverOf(deps, true));
}

// ------------------------------------------------------------------------------------------ test connection

const TEST_AMOUNT_MINOR = 100;

export async function testPlatformTerminal(
  deps: TerminalDeps = defaultTerminalDeps,
): Promise<TerminalTest> {
  const { actorId, env } = await admin(deps, ["test", 10]);
  const secrets = await deps.checkCredentials(actorId, env);
  let ok = false;
  let code: string | null = null;
  if (!terminalAllowed(env, secrets.creds.masof) || !modeAllowed(env, secrets.mode)) {
    code = "bad_terminal"; // not a terminal of this environment (≤ 16 characters: the DB keeps the code)
  } else {
    const endpoint = deps.endpoint();
    const order = deps.randomReference();
    const pairs = buildSignParams(secrets.creds, {
      amountMinor: TEST_AMOUNT_MINOR,
      order,
      moreData: true,
    });
    const http = await deps.http(endpoint, encodeParams(pairs), HYP_OPTIONS);
    const sign = http.ok
      ? validateSignResponse(
          http.body,
          { masof: secrets.creds.masof, amountMinor: TEST_AMOUNT_MINOR, order, moreData: true },
          endpoint,
        )
      : ({ ok: false, code: http.error } as const);
    ok = sign.ok;
    code = sign.ok ? null : sign.code === "ccode" ? (sign.ccode ?? "ccode") : sign.code;
  }
  const safeCode = code !== null && /^[0-9A-Za-z_-]{1,16}$/.test(code) ? code : null;
  const verified = await platformCall(deps.rpc, "platform_terminal_verified", {
    _actor: actorId,
    _ok: ok,
    _code: safeCode,
  });
  if (verified.error) throw dbFailure(verified.error, "platform_terminal_verified", deps.log);
  deps.log.info("terminal_test", { ok, code: safeCode });
  return {
    ok,
    code: safeCode,
    status: viewOf(asRow(verified.data), await deps.platformOrigin(), serverOf(deps, true)),
  };
}

// ------------------------------------------------------------------------------------------ lists

const LIST_STATES: readonly string[] = [
  "created",
  "redirected",
  "returned",
  "paid",
  "test_paid",
  "needs_review",
  "failed",
  "expired",
  "cancelled",
];
const stateOf = (row: Row) => {
  const state = text(row, "state");
  return state !== null && LIST_STATES.includes(state) ? state : "unknown";
};
const modeOf = (row: Row) => (text(row, "mode") === "live" ? "live" : "test");

export async function platformCardPaymentsList(
  input: { tenantId: string | null },
  deps: TerminalDeps = defaultTerminalDeps,
): Promise<CardPaymentRow[]> {
  const { actorId } = await admin(deps, ["list", 60]);
  const answer = await platformCall(deps.rpc, "platform_card_payments", {
    _actor: actorId,
    _tenant: input.tenantId,
    _limit: 100,
  });
  if (answer.error) throw dbFailure(answer.error, "platform_card_payments", deps.log);
  return asRows(answer.data).flatMap((p) => {
    const id = uuid(p, "id");
    if (!id) return [];
    const flags = Array.isArray(p["return_flags"])
      ? (p["return_flags"] as unknown[]).filter((f): f is string => typeof f === "string")
      : [];
    return [
      {
        id,
        payerTenantId: uuid(p, "payer_tenant_id"),
        payerLabel: text(p, "payer_label"),
        targetLabel: text(p, "target_label"),
        amountMinor: int(p, "amount_minor") ?? 0,
        state: stateOf(p),
        mode: modeOf(p),
        applied: flag(p, "applied"),
        installments: int(p, "installments"),
        cardBrand: text(p, "card_brand"),
        cardLast4: /^[0-9]{4}$/.test(text(p, "card_last4") ?? "") ? text(p, "card_last4") : null,
        approvalCode: text(p, "approval_code"),
        providerTxnId: text(p, "provider_txn_id"),
        terminalHint: hint(text(p, "terminal_hint")),
        returnFlags: flags,
        reviewReason: text(p, "review_reason"),
        reviewResolvedAt: text(p, "review_resolved_at"),
        createdAt: text(p, "created_at"),
        paidAt: text(p, "paid_at"),
      },
    ];
  });
}

export async function platformUnreturnedList(
  deps: TerminalDeps = defaultTerminalDeps,
): Promise<UnreturnedRow[]> {
  const { actorId } = await admin(deps, ["list", 60]);
  const answer = await platformCall(deps.rpc, "platform_unreturned_attempts", {
    _actor: actorId,
    _limit: 50,
  });
  if (answer.error) throw dbFailure(answer.error, "platform_unreturned_attempts", deps.log);
  return asRows(answer.data).flatMap((a) => {
    const id = uuid(a, "id");
    if (!id) return [];
    return [
      {
        id,
        payerLabel: text(a, "payer_label"),
        targetLabel: text(a, "target_label"),
        attemptNo: int(a, "attempt_no"),
        reference: /^[0-9a-f]{32}$/.test(text(a, "reference") ?? "") ? text(a, "reference") : null,
        amountMinor: int(a, "amount_minor") ?? 0,
        mode: modeOf(a),
        state: stateOf(a),
        terminalHint: hint(text(a, "terminal_hint")),
        createdAt: text(a, "created_at"),
        signedAt: text(a, "signed_at"),
        expiresAt: text(a, "expires_at"),
      },
    ];
  });
}

export async function resolvePlatformCardPayment(
  input: { attemptId: string; note: string | null },
  deps: TerminalDeps = defaultTerminalDeps,
): Promise<{ resolved: boolean }> {
  const { actorId } = await admin(deps, ["resolve", 20]);
  if (!UUID.test(input.attemptId)) throw new PlatformPaymentError("invalid");
  const answer = await platformCall(deps.rpc, "platform_card_payment_resolve", {
    _actor: actorId,
    _attempt: input.attemptId,
    _note: input.note,
  });
  if (answer.error) throw dbFailure(answer.error, "platform_card_payment_resolve", deps.log);
  return { resolved: answer.data === true };
}
