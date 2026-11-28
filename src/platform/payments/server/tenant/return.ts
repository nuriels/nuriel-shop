/**
 * Online payments, tenant scope — Hyp's browser return on a store host, the server-to-server VERIFY and the settle.
 * Server only. The ONLY caller of max_attempt_mark_paid and of the kept raw return (U17-B4).
 *
 * handleTenantReturn (GET /payments/return/max, store hosts only):
 *   refuse the platform host (no DB call, no VERIFY: DM-SEP-4) → parse the query exactly as received
 *   (parseReturnQuery: duplicate and reserved names refused, DM-PAY-3) → refuse a return without a non-empty `Sign`
 *   (before any DB write or VERIFY) → max_attempt_record_return with the HOST's store (an attempt of another store
 *   or of the platform is "unknown": recorded in unknown_returns, no VERIFY, DM-SEP-5 / DM-PAY-10) → keep the raw
 *   return encrypted (decision 14) → VERIFY with THIS attempt's own terminal (max_attempt_secrets 'verify') →
 *   max_attempt_mark_paid with the return's flags (Hesh/HKId/MULTI → review, DM-PAY-6/7) → purge → a clean 303
 *   target. Only an EXACT replay (same payload) of a concluded payment skips VERIFY (M06/M08: idempotent); a
 *   different return for a concluded attempt is verified and settled (an approved one → 'duplicate_charge').
 * reverifyTenantReturn: the 5-minute job's retry of a return that arrived but could not be verified.
 * Only CCode exactly "0" in VERIFY counts (X-2): a timeout, HTML or any other answer reaches the DB as "not
 * verified", which can neither pay nor fail the attempt. Every match check (amount, currency, installments,
 * transaction id, terminal, order still awaiting) is the DB's (DM-PAY-5).
 */
import { createHash } from "node:crypto";
import {
  buildVerifyQuery,
  classifyVerifyResponse,
  parseReturnQuery,
  type ParsedReturn,
} from "@/platform/payments/max/protocol";
import type { PaymentMode } from "@/platform/payments/provider";
import { isProviderId } from "@/platform/payments/registry";
import { paymentsRpc } from "@/platform/payments/server/db";
import { hypEndpoint, paymentsReady, type PaymentsEnv } from "@/platform/payments/server/env";
import { hypRequest, type HypHttpResult } from "@/platform/payments/server/http";
import { tenantSecretCipher } from "@/platform/payments/server/tenant-keys";
import { isPlatformHost } from "@/platform/tenancy/current-site.server";
import { verifyCredentials } from "./credentials";
import { asRecord, bool, modeOf, reference, str, uuid } from "./db";
import { shortId, tenantLog } from "./log";

/** the result page; never a Hyp parameter */
export const UNKNOWN_RETURN_LOCATION = "/checkout/pay/unknown";
const resultLocation = (orderId: string | null) =>
  orderId ? `/checkout/pay/${orderId}?r=1` : UNKNOWN_RETURN_LOCATION;

/** attempts whose payment is concluded: an EXACT replay of their recorded return is never verified again */
const CONCLUDED: readonly string[] = ["paid", "test_paid", "failed", "needs_review"];

/**
 * A return must carry Hyp's signature: the exact name `Sign` with a non-empty value (lead rule, also binding D5).
 * Without it the return is refused before any DB write or VERIFY. Inline until max/protocol.ts exports
 * returnHasSignature(parsed) — then this becomes that helper.
 */
export function returnSigned(parsed: Extract<ParsedReturn, { ok: true }>): boolean {
  return parsed.pairs.some(([name, value]) => name === "Sign" && value !== "");
}

export type PaidOrder = { tenantId: string; orderId: string };
export type ReviewItem = { tenantId: string; orderId: string | null; reason: string };

export interface TenantReturnOutcome {
  /** relative 303 target on the same store host */
  location: string;
  /** true when the request came to the platform host (answered 404, nothing recorded) */
  refused: boolean;
  /** settled as paid in this request: the caller sends the order e-mails */
  paid: PaidOrder | null;
  /** went to review in this request: the caller alerts the store's admins */
  review: ReviewItem | null;
}

type SettleOutcome = {
  result: string;
  reason: string | null;
  applied: boolean;
  orderId: string | null;
};

const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * The VERIFY code for the DB: "0" ONLY when the whole answer is exactly CCode=0 (X-2). A clean non-zero code is a
 * rejection; a timeout, a network error, HTML or any unclear answer is null (the DB records an error and keeps the
 * attempt for a retry). An answer such as "CCode=0&x=1" is never passed on as "0".
 */
export function verifyCodeOf(http: HypHttpResult): string | null {
  if (!http.ok) return null;
  const verdict = classifyVerifyResponse(http.body);
  if (verdict.html) return null;
  if (verdict.verified) return "0";
  const code = verdict.ccode;
  return code !== null && code !== "0" && /^[0-9]{1,6}$/.test(code) ? code : null;
}

/** VERIFY with the attempt's own credentials, then the settle. Never throws. */
async function verifyAndSettle(input: {
  env: PaymentsEnv;
  tenantId: string;
  attemptId: string;
  sha: string;
  parsed: Extract<ParsedReturn, { ok: true }>;
}): Promise<SettleOutcome> {
  const none = (result: string): SettleOutcome => ({
    result,
    reason: null,
    applied: false,
    orderId: null,
  });
  let secrets;
  try {
    secrets = await verifyCredentials(input.env, input.tenantId, input.attemptId);
  } catch {
    return none("verify_unavailable");
  }
  if (secrets.result !== "ok") return none(`verify_${secrets.result}`);

  let http: HypHttpResult;
  try {
    http = await hypRequest(hypEndpoint(), buildVerifyQuery(secrets.creds, input.parsed.raw), {
      method: "GET",
    });
  } catch {
    http = { ok: false, error: "network" };
  }
  const verifyCcode = verifyCodeOf(http);
  const { parsed } = input;
  const answer = await paymentsRpc("max_attempt_mark_paid", {
    _tenant: input.tenantId,
    _reference: parsed.order ?? "",
    _payload_sha256: input.sha,
    _verify_ccode: verifyCcode,
    _ccode: parsed.ccode,
    _terminal: secrets.creds.masof,
    _txn_id: parsed.id,
    _amount_minor: parsed.amountMinor,
    _currency: parsed.coin === "1" ? "ILS" : null,
    _installments: parsed.payments,
    _approval_code: parsed.acode,
    _card_brand: parsed.brand,
    _card_last4: parsed.last4,
    _return_flags: parsed.flags,
    _app_environment: input.env,
  });
  if (answer.error) {
    tenantLog.error("settle_failed", {
      attempt: shortId(input.attemptId),
      code: answer.error.code,
    });
    return none("settle_error");
  }
  const r = asRecord(answer.data);
  const outcome: SettleOutcome = {
    result: str(r?.["result"]) ?? "unknown",
    reason: str(r?.["reason"]),
    applied: bool(r?.["applied"]),
    orderId: uuid(r?.["order_id"]),
  };
  tenantLog.info("settle", {
    attempt: shortId(input.attemptId),
    verify: http.ok ? (verifyCcode ?? "unclear") : http.error,
    result: outcome.result,
    reason: outcome.reason,
    flags: parsed.flags.join(",") || null,
  });
  if (outcome.result === "environment_mismatch")
    tenantLog.alert("environment_mismatch", { attempt: shortId(input.attemptId) });
  if (outcome.result === "needs_review" || outcome.result === "duplicate_charge")
    tenantLog.alert("needs_review", {
      attempt: shortId(input.attemptId),
      reason: outcome.reason ?? outcome.result,
    });
  return outcome;
}

function sideEffects(
  tenantId: string,
  fallbackOrderId: string | null,
  settle: SettleOutcome,
): { paid: PaidOrder | null; review: ReviewItem | null } {
  const orderId = settle.orderId ?? fallbackOrderId;
  if ((settle.result === "paid" || settle.result === "test_paid") && settle.applied && orderId)
    return { paid: { tenantId, orderId }, review: null };
  if (settle.result === "needs_review" || settle.result === "duplicate_charge")
    return {
      paid: null,
      review: { tenantId, orderId, reason: settle.reason ?? settle.result },
    };
  return { paid: null, review: null };
}

async function purgeReturns(): Promise<void> {
  const answer = await paymentsRpc("platform_payment_returns_purge");
  if (answer.error) tenantLog.warn("purge_failed", { code: answer.error.code });
}

export async function handleTenantReturn(input: {
  provider: string;
  /** the query string exactly as received, without "?" */
  raw: string;
  /** the store of the request's host */
  hostTenantId: string | null;
  /** the request's host name (for the unknown-returns record) */
  host: string;
}): Promise<TenantReturnOutcome> {
  const base: TenantReturnOutcome = {
    location: UNKNOWN_RETURN_LOCATION,
    refused: false,
    paid: null,
    review: null,
  };
  // a store's return is never processed on the platform host (the platform has its own route)
  if (await isPlatformHost()) {
    tenantLog.warn("return_refused", { why: "platform_host" });
    return { ...base, refused: true };
  }
  if (!isProviderId(input.provider) || !input.hostTenantId) return base;
  const parsed = parseReturnQuery(input.raw);
  if (!parsed.ok) {
    tenantLog.warn("return_refused", { why: parsed.reason });
    return base;
  }
  if (!parsed.order) {
    tenantLog.warn("return_refused", { why: "no_order" });
    return base;
  }
  if (!returnSigned(parsed)) {
    // refused and recorded (the scope log; no DB write: an unsigned return must not touch an attempt)
    tenantLog.warn("return_refused", { why: "no_signature" });
    return base;
  }
  const sha = sha256Hex(input.raw);
  const recorded = await paymentsRpc("max_attempt_record_return", {
    _host_tenant: input.hostTenantId,
    _reference: parsed.order,
    _payload_sha256: sha,
    _ccode: parsed.ccode,
    _txn_id: parsed.id,
    _amount_minor: parsed.amountMinor,
    _installments: parsed.payments,
  });
  if (recorded.error) {
    // nothing was recorded: the same return can simply arrive again
    tenantLog.error("record_failed", { code: recorded.error.code });
    return base;
  }
  const rec = asRecord(recorded.data);
  const result = str(rec?.["result"]);
  if (result === "unknown") {
    // another store's or the platform's reference, or none at all: counted, never verified
    const unknown = await paymentsRpc("platform_payment_unknown_return", {
      _scope: "tenant",
      _host: input.host,
      _payload_sha256: sha,
    });
    tenantLog.warn("return_unknown", { recorded: unknown.error === null });
    return base;
  }
  if (result !== "received" && result !== "replay") {
    tenantLog.warn("return_refused", { why: result ?? "unreadable" });
    return base;
  }
  const attemptId = uuid(rec?.["attempt_id"]);
  const tenantId = uuid(rec?.["tenant_id"]);
  const orderId = uuid(rec?.["order_id"]);
  const mode = modeOf(rec?.["mode"]);
  const state = str(rec?.["state"]);
  const location = resultLocation(orderId);
  if (!attemptId || !tenantId || tenantId !== input.hostTenantId || !mode) {
    tenantLog.error("record_unreadable");
    return { ...base, location };
  }
  // M06: only an EXACT replay (the same payload, "replay") of a concluded payment is idempotent — no VERIFY, no
  // e-mail, the same result page. A DIFFERENT return for a paid / test_paid / needs_review / failed attempt is
  // verified with that attempt's own terminal and settled like any other: the DB turns an approved one into
  // needs_review 'duplicate_charge' (and the caller alerts the store's admins)
  if (result === "replay" && state !== null && CONCLUDED.includes(state)) {
    tenantLog.info("return_replayed", { attempt: shortId(attemptId), state });
    return { ...base, location };
  }
  const ready = paymentsReady("tenant");
  if (!ready.ok) {
    // recorded, not verified: the job (or the same return again) verifies it once payments are on
    tenantLog.alert("return_not_verified", { attempt: shortId(attemptId), why: ready.reason });
    return { ...base, location };
  }
  if (result === "received")
    await keepRawReturn(ready.env, mode, tenantId, attemptId, sha, input.raw);

  const settle = await verifyAndSettle({ env: ready.env, tenantId, attemptId, sha, parsed });
  await purgeReturns();
  return { ...base, location, ...sideEffects(tenantId, orderId, settle) };
}

/** the encrypted raw return for a later VERIFY retry (decision 14): bound to this store and attempt (Q1) */
async function keepRawReturn(
  env: PaymentsEnv,
  mode: PaymentMode,
  tenantId: string,
  attemptId: string,
  sha: string,
  raw: string,
): Promise<void> {
  try {
    const sealed = tenantSecretCipher(env, mode).seal("raw_return", raw, {
      tenantId,
      accountId: attemptId,
    });
    const kept = await paymentsRpc("max_return_keep", {
      _tenant: tenantId,
      _attempt: attemptId,
      _payload_sha256: sha,
      _return_enc: sealed,
    });
    if (kept.error) tenantLog.warn("return_not_kept", { code: kept.error.code });
  } catch {
    tenantLog.warn("return_not_kept", { why: "seal" });
  }
}

/** one item of max_attempts_pending_verify (the job) */
export interface PendingVerify {
  tenantId: string;
  attemptId: string;
  reference: string;
  payloadSha256: string;
  mode: PaymentMode;
}

export function pendingVerifyItems(data: unknown): PendingVerify[] {
  const rows = Array.isArray(data) ? data : [];
  const items: PendingVerify[] = [];
  for (const row of rows) {
    const r = asRecord(row);
    const tenantId = uuid(r?.["tenant_id"]);
    const attemptId = uuid(r?.["attempt_id"]);
    const ref = reference(r?.["reference"]);
    const sha = str(r?.["payload_sha256"]);
    const mode = modeOf(r?.["mode"]);
    if (tenantId && attemptId && ref && sha && /^[0-9a-f]{64}$/.test(sha) && mode)
      items.push({ tenantId, attemptId, reference: ref, payloadSha256: sha, mode });
  }
  return items;
}

/** The job's retry: the kept raw return → VERIFY → settle. null when there is nothing (left) to verify. */
export async function reverifyTenantReturn(
  item: PendingVerify,
): Promise<{ paid: PaidOrder | null; review: ReviewItem | null } | null> {
  const ready = paymentsReady("tenant");
  if (!ready.ok) return null;
  const kept = await paymentsRpc("max_return_get", {
    _tenant: item.tenantId,
    _attempt: item.attemptId,
    _payload_sha256: item.payloadSha256,
  });
  const sealed = kept.error ? null : str(kept.data);
  if (!sealed) return null;
  let raw: string;
  try {
    raw = tenantSecretCipher(ready.env, item.mode).open("raw_return", sealed, {
      tenantId: item.tenantId,
      accountId: item.attemptId,
    });
  } catch {
    tenantLog.alert("return_unreadable", { attempt: shortId(item.attemptId) });
    return null;
  }
  const parsed = parseReturnQuery(raw);
  if (
    !parsed.ok ||
    parsed.order !== item.reference ||
    !returnSigned(parsed) ||
    sha256Hex(raw) !== item.payloadSha256
  ) {
    tenantLog.alert("return_unreadable", { attempt: shortId(item.attemptId), why: "mismatch" });
    return null;
  }
  const settle = await verifyAndSettle({
    env: ready.env,
    tenantId: item.tenantId,
    attemptId: item.attemptId,
    sha: item.payloadSha256,
    parsed,
  });
  return sideEffects(item.tenantId, null, settle);
}
