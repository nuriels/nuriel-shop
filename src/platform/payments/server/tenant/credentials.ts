/**
 * Online payments, tenant scope — a store terminal's credentials for ONE call (server only).
 *
 * The only reader of the store-terminal ciphertext (U17-B4): max_attempt_secrets (SIGN / VERIFY of one attempt; the
 * DB takes the VERIFY lease and counts the calls) and platform_store_terminal_check_secrets (the platform admin's
 * free connection check). Decrypted with the tenant key (tenant-keys.ts, PAYMENTS_SECRETS_KEY) bound to this store:
 * AAD ctx { tenantId, accountId: tenantId } (lead decision Q1), fields "api_key" / "api_password". The result lives
 * in the caller's local variable for one Hyp request: never cached, logged, thrown or returned to a browser.
 */
import type { MaxCredentials, PaymentMode } from "@/platform/payments/provider";
import { paymentsRpc } from "@/platform/payments/server/db";
import { modeAllowed, terminalAllowed, type PaymentsEnv } from "@/platform/payments/server/env";
import { tenantSecretCipher } from "@/platform/payments/server/tenant-keys";
import {
  TenantPaymentError,
  UNAVAILABLE,
  asRecord,
  dbUnreachable,
  int,
  modeOf,
  str,
  unwrap,
} from "./db";
import { shortId, tenantLog } from "./log";

const MASOF = /^[0-9]{10}$/;
export const CREDENTIALS_REFUSED = "יש להזין מחדש את פרטי המסוף של החנות";

export type VerifyCredentials =
  | { result: "ok"; creds: MaxCredentials; mode: PaymentMode }
  | { result: "busy"; retryAfterSeconds: number }
  /** 6 VERIFY calls used: the DB parked the attempt in needs_review 'verify_exhausted' */
  | { result: "exhausted" }
  /**
   * the attempt can never be verified as it is: its terminal changed or is no longer configured, the DB refused,
   * the ciphertext does not open, or a tripwire fired (mode / terminal not for this environment)
   */
  | { result: "refused"; reason: "credentials_changed" | "mode_not_allowed" }
  /** the DB could not be reached: nothing was decided, a later try may succeed */
  | { result: "unavailable" };

/** the DM-ENV-3 tripwires (never proof; the DB enforces): DEMO = test mode and a 00100… terminal */
export function envTripwire(env: PaymentsEnv, masof: string, mode: PaymentMode): boolean {
  return modeAllowed(env, mode) && terminalAllowed(env, masof);
}

/** ciphertext row → credentials; any problem (format, mode, key, AAD) is one fixed error */
function decrypt(
  env: PaymentsEnv,
  tenantId: string,
  row: unknown,
): { creds: MaxCredentials; mode: PaymentMode } {
  const r = asRecord(row);
  const masof = str(r?.["terminal_number"]);
  const mode = modeOf(r?.["mode"]);
  const keyEnc = str(r?.["api_key_enc"]);
  const passEnc = str(r?.["api_password_enc"]);
  if (!masof || !MASOF.test(masof) || !mode || !keyEnc || !passEnc) {
    tenantLog.error("credentials_unreadable", { why: "shape" });
    throw new TenantPaymentError(CREDENTIALS_REFUSED, "credentials");
  }
  try {
    const cipher = tenantSecretCipher(env, mode);
    const ctx = { tenantId, accountId: tenantId };
    return {
      creds: {
        masof,
        key: cipher.open("api_key", keyEnc, ctx),
        passp: cipher.open("api_password", passEnc, ctx),
      },
      mode,
    };
  } catch {
    // a token copied from another store, field, mode or environment, or a changed root secret (DM-ENV-4)
    tenantLog.alert("credentials_unreadable", { why: "decrypt" });
    throw new TenantPaymentError(CREDENTIALS_REFUSED, "credentials");
  }
}

/** SIGN credentials of one attempt (throws TenantPaymentError when the attempt cannot be signed) */
export async function signCredentials(
  env: PaymentsEnv,
  tenantId: string,
  attemptId: string,
): Promise<{ creds: MaxCredentials; mode: PaymentMode }> {
  const row = unwrap(
    "max_attempt_secrets",
    await paymentsRpc("max_attempt_secrets", {
      _tenant: tenantId,
      _attempt: attemptId,
      _purpose: "sign",
    }),
  );
  const r = asRecord(row);
  if (str(r?.["result"]) !== "ok") throw new TenantPaymentError(UNAVAILABLE, "unavailable");
  return decrypt(env, tenantId, row);
}

/**
 * VERIFY credentials of one attempt: the attempt's OWN terminal (the DB refuses when the account moved on).
 * Never throws. "busy" = another VERIFY holds the 45-second lease; "exhausted" = 6 calls used, the DB parked it
 * for review; "refused" = it can never be verified as it is (the caller puts it in front of a person: M1);
 * "unavailable" = the DB could not be reached. `terminal` is the attempt's terminal as the DB recorded it (a
 * tripwire: the credentials must belong to it), null when the caller does not have it.
 */
export async function verifyCredentials(
  env: PaymentsEnv,
  tenantId: string,
  attemptId: string,
  terminal: string | null = null,
): Promise<VerifyCredentials> {
  const attempt = shortId(attemptId);
  const answer = await paymentsRpc("max_attempt_secrets", {
    _tenant: tenantId,
    _attempt: attemptId,
    _purpose: "verify",
  });
  if (answer.error) {
    if (dbUnreachable(answer.error)) {
      tenantLog.error("verify_credentials_unavailable", { attempt, code: answer.error.code });
      return { result: "unavailable" };
    }
    if (/environments differ/i.test(answer.error.message))
      tenantLog.alert("environment_mismatch", { fn: "max_attempt_secrets" });
    tenantLog.warn("verify_credentials_refused", { attempt, code: answer.error.code });
    return { result: "refused", reason: "credentials_changed" };
  }
  const r = asRecord(answer.data);
  const result = str(r?.["result"]);
  if (result === "busy")
    return { result: "busy", retryAfterSeconds: int(r?.["retry_after_seconds"]) ?? 45 };
  if (result === "exhausted") return { result: "exhausted" };
  if (result !== "ok") {
    tenantLog.warn("verify_credentials_refused", { attempt, why: "result" });
    return { result: "refused", reason: "credentials_changed" };
  }
  const masof = str(r?.["terminal_number"]);
  const mode = modeOf(r?.["mode"]);
  if (masof && mode && MASOF.test(masof) && !envTripwire(env, masof, mode)) {
    tenantLog.alert("terminal_not_allowed", { attempt, mode });
    return { result: "refused", reason: "mode_not_allowed" };
  }
  if (terminal !== null && masof !== terminal) {
    tenantLog.warn("verify_credentials_refused", { attempt, why: "terminal" });
    return { result: "refused", reason: "credentials_changed" };
  }
  try {
    const { creds, mode: openedMode } = decrypt(env, tenantId, r);
    return { result: "ok", creds, mode: openedMode };
  } catch {
    // decrypt already logged why (shape, or a token that does not open: DM-ENV-4)
    return { result: "refused", reason: "credentials_changed" };
  }
}

/** the platform admin's free connection check of a store terminal (no attempt row; the DB checks the admin) */
export async function connectionCheckCredentials(
  env: PaymentsEnv,
  actorId: string,
  tenantId: string,
): Promise<{ creds: MaxCredentials; mode: PaymentMode }> {
  const row = unwrap(
    "platform_store_terminal_check_secrets",
    await paymentsRpc("platform_store_terminal_check_secrets", {
      _actor: actorId,
      _tenant: tenantId,
    }),
  );
  const opened = decrypt(env, tenantId, row);
  if (!envTripwire(env, opened.creds.masof, opened.mode)) {
    tenantLog.alert("terminal_not_allowed", { mode: opened.mode });
    throw new TenantPaymentError(UNAVAILABLE, "unavailable");
  }
  return opened;
}
