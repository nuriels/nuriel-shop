/**
 * Online payments, platform scope — the browser's return from Hyp on the PLATFORM host, then VERIFY and settle
 * (plan §3.1, §3.3, §4.2; arch §2.3, §4.4).
 *
 * • Platform host only (isPlatformHost(), U17-B9; storeGate already answers 403 for /platform/* on every store
 *   host). No request tenant is read (on this host it would be the default store): the payer comes from the
 *   attempt row only.
 * • The raw query is parsed by the protocol module (duplicate / reserved names refused, DM-PAY-3) and kept unchanged
 *   for VERIFY; a refused query writes nothing. The lookup is in the platform table only: a store's reference is
 *   unknown here → platform_payment_unknown_return and no VERIFY (DM-SEP-4, DM-PAY-10).
 * • VERIFY with NURIEL's terminal of THAT attempt (DM-SEP-2). Only an exactly verified answer reaches the DB as "0"
 *   (DM-PAY-4); timeouts, HTML and anomalies are null (the attempt stays returned; the job or a replay verifies
 *   again). The settle function is the only writer of the provider ledger row (DM-PLAT-3) and gets the return
 *   flags (document / hk / multi → review, DM-PAY-6/7). Sole caller of platform_attempt_mark_paid,
 *   platform_return_keep and platform_return_get (U17-B4).
 * • After paid: nothing else — no store e-mail, no activation, no renewal (decision ה-3). Review, duplicate charge,
 *   environment mismatch, exhausted VERIFY → alertPlatformAdmins.
 * • The caller answers 303 + no-store + no-referrer to `location`: the store address the owner started from (saved on
 *   the attempt, validated twice), never a request parameter.
 */
import { createHash } from "node:crypto";
import type { PaymentMode } from "@/platform/payments/provider";
import {
  buildVerifyQuery,
  classifyVerifyResponse,
  parseReturnQuery,
  returnHasSignature,
  type ParsedReturn,
  type VerifyResult,
} from "@/platform/payments/max/protocol";
import { hypEndpoint, paymentsReady, type PaymentsEnv } from "@/platform/payments/server/env";
import { hypRequest } from "@/platform/payments/server/http";
import { platformSecretCipher } from "@/platform/payments/server/platform-keys";
import { isPlatformHost } from "@/platform/tenancy/current-site.server";
import { alertPlatformAdmins } from "./alerts";
import {
  platformAttemptCredentials,
  type AttemptSecrets,
  type PlatformCipher,
} from "./credentials";
import {
  PlatformPaymentError,
  asRow,
  dbFailure,
  flag,
  platformCall,
  platformPaymentsRpc,
  text,
  uuid,
  type PlatformRpc,
} from "./db";
import { platformLog, shortId, type PlatformLogger } from "./log";

type Ready = { ok: true; env: PaymentsEnv } | { ok: false; reason: string };

export interface PlatformReturnDeps {
  isPlatformHost(): Promise<boolean>;
  ready(): Ready;
  endpoint(): string;
  rpc: PlatformRpc;
  credentials(attemptId: string, purpose: "verify", env: PaymentsEnv): Promise<AttemptSecrets>;
  cipher(env: PaymentsEnv, mode: PaymentMode): PlatformCipher;
  http: typeof hypRequest;
  alert(reason: string, attemptId: string | null): Promise<void>;
  log: PlatformLogger;
}

export const defaultReturnDeps: PlatformReturnDeps = {
  isPlatformHost,
  ready: () => paymentsReady("platform"),
  endpoint: hypEndpoint,
  rpc: platformPaymentsRpc,
  credentials: (attemptId, purpose, env) => platformAttemptCredentials(attemptId, purpose, env),
  cipher: platformSecretCipher,
  http: hypRequest,
  alert: alertPlatformAdmins,
  log: platformLog,
};

/** what happened, for the route (location) and the tests */
export type SettleResult = "paid" | "review" | "not_paid" | "pending" | "concluded" | "error";
export type PlatformReturnOutcome = {
  location: string;
  result: SettleResult | "refused" | "unknown" | "off";
  attemptId: string | null;
};

/** no attempt known (or nothing to say): the platform host's start page */
export const PLATFORM_RETURN_FALLBACK = "/";
const HYP_OPTIONS = { method: "GET", timeoutMs: 15_000, maxBytes: 64 * 1024 } as const;
/** a store origin as platform_attempt_open stores it: https://<host>, or http://…localhost[:port] locally */
const STORE_ORIGIN =
  /^(?:https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+|http:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*localhost(?::[0-9]{1,5})?)$/;
/**
 * An EXACT replay (the same payload hash) of a concluded attempt gets no VERIFY: idempotent, same result page (M06,
 * M08). A DIFFERENT return for a concluded attempt is verified and settled like any other — the DB turns an
 * approved one into needs_review "duplicate_charge" (+ alert): money may have moved twice.
 */
const CONCLUDED: readonly string[] = ["paid", "test_paid", "needs_review", "failed"];

export const sha256Hex = (raw: string) => createHash("sha256").update(raw, "utf8").digest("hex");

/** back to "המנוי שלי" of the store the owner started from (validated again here: never an open redirect) */
export function returnLocation(origin: string | null): string {
  return origin !== null && STORE_ORIGIN.test(origin)
    ? `${origin}/admin?tab=billing&pay=return`
    : PLATFORM_RETURN_FALLBACK;
}

const isMode = (value: unknown): value is PaymentMode => value === "test" || value === "live";

/** DM-PAY-4: "0" only for an exactly verified answer; a plain numeric refusal code as is; anything else null */
export function verifyCodeForDb(v: VerifyResult | null): string | null {
  if (v === null || v.html) return null;
  if (v.verified) return "0";
  return v.ccode !== null && /^[0-9]{1,6}$/.test(v.ccode) && v.ccode !== "0" ? v.ccode : null;
}

/** the DB keeps a brand only as a lower-case word; Hyp's numeric codes are not mapped (undocumented, Q18) */
const brandName = (brand: string | null) => {
  const name =
    brand
      ?.trim()
      .toLowerCase()
      .replace(/[\s.-]+/g, "_") ?? "";
  return /^[a-z_]{2,20}$/.test(name) ? name : null;
};

type Parsed = Extract<ParsedReturn, { ok: true }>;

async function verifyAndSettle(
  item: { attemptId: string; reference: string; sha: string; raw: string; parsed: Parsed },
  env: PaymentsEnv,
  deps: PlatformReturnDeps,
): Promise<{ result: SettleResult; reason?: string }> {
  const attempt = shortId(item.attemptId);
  let secrets: Awaited<ReturnType<PlatformReturnDeps["credentials"]>>;
  try {
    secrets = await deps.credentials(item.attemptId, "verify", env);
  } catch (error) {
    // review M1: the terminal or its credentials changed (or cannot be opened) after the payer was sent to Hyp —
    // this return cannot be verified now, so the platform team is told (one e-mail per attempt)
    deps.log.error("verify_credentials", {
      attempt,
      code: error instanceof PlatformPaymentError ? error.code : "internal",
    });
    await deps.alert("verify_credentials", item.attemptId);
    return { result: "error" };
  }
  if (secrets.result === "busy") {
    deps.log.info("verify_busy", { attempt });
    return { result: "pending" };
  }
  if (secrets.result === "exhausted") {
    await deps.alert("verify_exhausted", item.attemptId);
    return { result: "review", reason: "verify_exhausted" };
  }
  const endpoint = deps.endpoint();
  const http = await deps.http(endpoint, buildVerifyQuery(secrets.creds, item.raw), HYP_OPTIONS);
  const verify = http.ok ? classifyVerifyResponse(http.body) : null;
  const verifyCcode = verifyCodeForDb(verify);
  deps.log.info("verify", {
    attempt,
    transport: http.ok ? "ok" : http.error,
    html: verify?.html ?? false,
    verified: verify?.verified ?? false,
    ccode: verifyCcode,
  });
  const parsed = item.parsed;
  const answer = await platformCall(deps.rpc, "platform_attempt_mark_paid", {
    _reference: item.reference,
    _payload_sha256: item.sha,
    _verify_ccode: verifyCcode,
    _ccode: parsed.ccode,
    _terminal: secrets.creds.masof,
    _txn_id: parsed.id,
    _amount_minor: parsed.amountMinor,
    _currency: parsed.coin === "1" ? "ILS" : null,
    _installments: parsed.payments,
    _approval_code: parsed.acode,
    _card_brand: brandName(parsed.brand),
    _card_last4: parsed.last4,
    _return_flags: parsed.flags,
    _app_environment: env,
  });
  if (answer.error) {
    dbFailure(answer.error, "platform_attempt_mark_paid", deps.log);
    return { result: "error" };
  }
  const row = asRow(answer.data);
  const result = text(row, "result");
  switch (result) {
    case "paid":
    case "test_paid":
      deps.log.info("settle", { attempt, result, applied: flag(row, "applied") });
      return { result: "paid" };
    case "already_paid":
      deps.log.info("settle", { attempt, result });
      return { result: "concluded" };
    case "needs_review":
    case "duplicate_charge": {
      const reason = result === "duplicate_charge" ? result : (text(row, "reason") ?? "review");
      await deps.alert(reason, item.attemptId);
      return { result: "review", reason };
    }
    case "environment_mismatch":
      await deps.alert("environment_mismatch", item.attemptId);
      return { result: "error" };
    case "not_paid":
      deps.log.info("settle", { attempt, result });
      return { result: "not_paid" };
    case "unverified":
      // not verified now: the attempt stays returned (a forged return can neither pay nor fail it)
      deps.log.warn("settle", { attempt, result });
      return { result: "pending" };
    default:
      deps.log.warn("settle", { attempt, result: result ?? "none" });
      return { result: "error" };
  }
}

async function keepRaw(
  attemptId: string,
  sha: string,
  raw: string,
  env: PaymentsEnv,
  mode: PaymentMode,
  deps: PlatformReturnDeps,
): Promise<void> {
  try {
    // decision 14: sealed under the attempt's own id (a copy into another attempt does not open)
    const token = deps.cipher(env, mode).seal("raw_return", raw, { accountId: attemptId });
    const kept = await platformCall(deps.rpc, "platform_return_keep", {
      _attempt: attemptId,
      _payload_sha256: sha,
      _return_enc: token,
    });
    if (kept.error) deps.log.error("raw_keep", { attempt: shortId(attemptId) });
  } catch {
    deps.log.error("raw_keep", { attempt: shortId(attemptId) });
  }
}

async function purge(deps: PlatformReturnDeps): Promise<void> {
  const purged = await platformCall(deps.rpc, "platform_payment_returns_purge", {});
  if (purged.error) deps.log.error("purge", {});
}

export async function handlePlatformReturn(
  input: { provider: string; raw: string; host: string },
  deps: PlatformReturnDeps = defaultReturnDeps,
): Promise<PlatformReturnOutcome> {
  const refused = (result: PlatformReturnOutcome["result"]): PlatformReturnOutcome => ({
    location: PLATFORM_RETURN_FALLBACK,
    result,
    attemptId: null,
  });
  if (input.provider !== "max" || !(await deps.isPlatformHost())) return refused("refused");
  const ready = deps.ready();
  if (!ready.ok) {
    // nothing recorded: the attempt expires into the "sent and never returned" list (manual reconciliation)
    deps.log.alert("return_off", { reason: ready.reason });
    return refused("off");
  }
  const env = ready.env;
  const parsed = parseReturnQuery(input.raw);
  if (!parsed.ok || parsed.order === null) {
    deps.log.warn("return_refused", { reason: parsed.ok ? "no_order" : parsed.reason });
    return refused("refused");
  }
  // without Hyp's transaction signature VERIFY cannot succeed: refused before any DB write, like the tenant side
  // (review L3: nothing recorded, the attempt is not moved to returned, no alert per forged request)
  if (!returnHasSignature(parsed)) {
    deps.log.warn("return_refused", { reason: "unsigned" });
    return refused("refused");
  }
  const sha = sha256Hex(input.raw);
  const recorded = await platformCall(deps.rpc, "platform_attempt_record_return", {
    _reference: parsed.order,
    _payload_sha256: sha,
    _ccode: parsed.ccode,
    _txn_id: parsed.id,
    _amount_minor: parsed.amountMinor,
    _installments: parsed.payments,
  });
  if (recorded.error) {
    dbFailure(recorded.error, "platform_attempt_record_return", deps.log);
    return refused("error");
  }
  const row = asRow(recorded.data);
  const result = text(row, "result");
  if (result === "unknown") {
    // another scope's or a forged reference: counted for the misconfiguration alert, never verified
    const host = /^[a-z0-9.-]{1,253}$/.test(input.host) ? input.host : "unknown.invalid";
    const noted = await platformCall(deps.rpc, "platform_payment_unknown_return", {
      _scope: "platform",
      _host: host,
      _payload_sha256: sha,
    });
    if (noted.error) deps.log.error("unknown_return", {});
    deps.log.warn("return_unknown", {});
    return refused("unknown");
  }
  const attemptId = uuid(row, "attempt_id");
  const mode = text(row, "mode");
  if ((result !== "received" && result !== "replay") || attemptId === null || !isMode(mode)) {
    deps.log.warn("return_refused", { reason: result ?? "none" });
    return refused("refused");
  }
  const location = returnLocation(text(row, "return_origin"));
  const state = text(row, "state") ?? "";
  if (result === "replay" && CONCLUDED.includes(state)) {
    deps.log.info("return_replay", { attempt: shortId(attemptId), state });
    return { location, result: "concluded", attemptId };
  }
  if (result === "received") await keepRaw(attemptId, sha, input.raw, env, mode, deps);
  let settled: { result: SettleResult };
  try {
    settled = await verifyAndSettle(
      { attemptId, reference: parsed.order, sha, raw: input.raw, parsed },
      env,
      deps,
    );
  } catch (error) {
    deps.log.error("verify_failed", {
      attempt: shortId(attemptId),
      code: error instanceof PlatformPaymentError ? error.code : "internal",
    });
    settled = { result: "error" };
  }
  await purge(deps);
  return { location, result: settled.result, attemptId };
}

/** the job's re-VERIFY of a return that was recorded but not verified (transport failure, lease) */
export async function reverifyPlatformReturn(
  item: { attemptId: string; reference: string; sha: string; mode: PaymentMode },
  deps: PlatformReturnDeps = defaultReturnDeps,
): Promise<{ result: SettleResult | "gone" | "off"; reason?: string }> {
  const ready = deps.ready();
  if (!ready.ok) return { result: "off" };
  const attempt = shortId(item.attemptId);
  const got = await platformCall(deps.rpc, "platform_return_get", {
    _attempt: item.attemptId,
    _payload_sha256: item.sha,
  });
  if (got.error) {
    dbFailure(got.error, "platform_return_get", deps.log);
    return { result: "error" };
  }
  if (typeof got.data !== "string" || got.data === "") return { result: "gone" }; // purged (≤ 2 h) or never kept
  let raw: string;
  try {
    raw = deps
      .cipher(ready.env, item.mode)
      .open("raw_return", got.data, { accountId: item.attemptId });
  } catch {
    deps.log.alert("raw_unreadable", { attempt });
    return { result: "error" };
  }
  const parsed = parseReturnQuery(raw);
  if (
    !parsed.ok ||
    parsed.order !== item.reference ||
    sha256Hex(raw) !== item.sha ||
    !returnHasSignature(parsed)
  ) {
    deps.log.alert("raw_mismatch", { attempt });
    return { result: "error" };
  }
  try {
    return await verifyAndSettle(
      { attemptId: item.attemptId, reference: item.reference, sha: item.sha, raw, parsed },
      ready.env,
      deps,
    );
  } catch (error) {
    deps.log.error("verify_failed", {
      attempt,
      code: error instanceof PlatformPaymentError ? error.code : "internal",
    });
    return { result: "error" };
  }
}
