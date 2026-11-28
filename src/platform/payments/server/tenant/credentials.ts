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
import type { PaymentsEnv } from "@/platform/payments/server/env";
import { tenantSecretCipher } from "@/platform/payments/server/tenant-keys";
import { TenantPaymentError, UNAVAILABLE, asRecord, int, modeOf, str, unwrap } from "./db";
import { tenantLog } from "./log";

const MASOF = /^[0-9]{10}$/;
export const CREDENTIALS_REFUSED = "יש להזין מחדש את פרטי המסוף של החנות";

export type VerifyCredentials =
  | { result: "ok"; creds: MaxCredentials; mode: PaymentMode }
  | { result: "busy"; retryAfterSeconds: number }
  | { result: "exhausted" };

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
 * "busy" = another VERIFY holds the 45-second lease; "exhausted" = 6 calls used, the DB parked it for review.
 */
export async function verifyCredentials(
  env: PaymentsEnv,
  tenantId: string,
  attemptId: string,
): Promise<VerifyCredentials> {
  const answer = await paymentsRpc("max_attempt_secrets", {
    _tenant: tenantId,
    _attempt: attemptId,
    _purpose: "verify",
  });
  const row = unwrap("max_attempt_secrets", answer);
  const r = asRecord(row);
  const result = str(r?.["result"]);
  if (result === "busy")
    return { result: "busy", retryAfterSeconds: int(r?.["retry_after_seconds"]) ?? 45 };
  if (result === "exhausted") return { result: "exhausted" };
  if (result !== "ok") throw new TenantPaymentError(UNAVAILABLE, "unavailable");
  const { creds, mode } = decrypt(env, tenantId, row);
  return { result: "ok", creds, mode };
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
  return decrypt(env, tenantId, row);
}
