/**
 * Online payments, platform scope — NURIEL's terminal credentials for ONE call (server only).
 *
 * The sole caller of platform_attempt_secrets and platform_terminal_check_secrets (U17-B4). The DB hands out the
 * ciphertext; this file opens it with the platform cipher (platform-keys.ts, PLATFORM_TERMINAL_SECRETS_KEY) under
 * PLATFORM_ACCOUNT_ID (NURIEL's terminal) and the field name (AAD), and returns the plaintext to the caller for one
 * SIGN or VERIFY. Nothing is logged, cached or kept (U17-B8). A token that does not open (rotated root key, a
 * ciphertext copied from elsewhere — DM-ENV-4) is one fixed error: the admin re-enters the terminal details.
 */
import type { MaxCredentials, PaymentMode } from "@/platform/payments/provider";
import { modeAllowed, type PaymentsEnv } from "@/platform/payments/server/env";
import {
  PLATFORM_ACCOUNT_ID,
  platformSecretCipher,
} from "@/platform/payments/server/platform-keys";
import {
  PlatformPaymentError,
  asRow,
  dbFailure,
  int,
  platformCall,
  platformPaymentsRpc,
  text,
  type PlatformRpc,
  type Row,
} from "./db";
import { platformLog, type PlatformLogger } from "./log";

export interface PlatformCipher {
  readonly kid: string;
  seal(field: string, value: string, ctx: { accountId: string }): string;
  open(field: string, token: string, ctx: { accountId: string }): string;
}

export interface CredentialsDeps {
  rpc: PlatformRpc;
  cipher(env: PaymentsEnv, mode: PaymentMode): PlatformCipher;
  log: PlatformLogger;
}

export const defaultCredentialsDeps: CredentialsDeps = {
  rpc: platformPaymentsRpc,
  cipher: platformSecretCipher,
  log: platformLog,
};

export type TerminalSecrets = { creds: MaxCredentials; mode: PaymentMode };
export type AttemptSecrets =
  | ({ result: "ok" } & TerminalSecrets)
  | { result: "busy"; retryAfterSeconds: number }
  | { result: "exhausted" };

const MASOF = /^[0-9]{10}$/;
const isMode = (value: unknown): value is PaymentMode => value === "test" || value === "live";

function openRow(row: Row | null, env: PaymentsEnv, deps: CredentialsDeps): TerminalSecrets {
  const masof = text(row, "terminal_number");
  const mode = text(row, "mode");
  const keyToken = text(row, "api_key_enc");
  const passwordToken = text(row, "api_password_enc");
  if (masof === null || !MASOF.test(masof) || !isMode(mode) || !keyToken || !passwordToken)
    throw new PlatformPaymentError("credentials");
  if (!modeAllowed(env, mode)) {
    deps.log.alert("mode_not_allowed", { mode });
    throw new PlatformPaymentError("unavailable");
  }
  try {
    const cipher = deps.cipher(env, mode);
    const ctx = { accountId: PLATFORM_ACCOUNT_ID };
    const creds: MaxCredentials = {
      masof,
      key: cipher.open("api_key", keyToken, ctx),
      passp: cipher.open("api_password", passwordToken, ctx),
    };
    return { creds, mode };
  } catch {
    deps.log.alert("credentials_unreadable", { mode });
    throw new PlatformPaymentError("credentials");
  }
}

/** NURIEL's terminal for SIGN or VERIFY of one platform attempt (VERIFY: the DB's lease and 6-call cap apply) */
export async function platformAttemptCredentials(
  attemptId: string,
  purpose: "sign" | "verify",
  env: PaymentsEnv,
  deps: CredentialsDeps = defaultCredentialsDeps,
): Promise<AttemptSecrets> {
  const answer = await platformCall(deps.rpc, "platform_attempt_secrets", {
    _attempt: attemptId,
    _purpose: purpose,
  });
  if (answer.error) throw dbFailure(answer.error, "platform_attempt_secrets", deps.log);
  const row = asRow(answer.data);
  const result = text(row, "result");
  if (result === "busy")
    return {
      result: "busy",
      retryAfterSeconds: Math.max(1, int(row, "retry_after_seconds") ?? 45),
    };
  if (result === "exhausted") return { result: "exhausted" };
  if (result !== "ok") throw new PlatformPaymentError("generic");
  return { result: "ok", ...openRow(row, env, deps) };
}

/** NURIEL's terminal for the free connection check of the platform admin (no attempt row) */
export async function platformTerminalCheckCredentials(
  actorId: string,
  env: PaymentsEnv,
  deps: CredentialsDeps = defaultCredentialsDeps,
): Promise<TerminalSecrets> {
  const answer = await platformCall(deps.rpc, "platform_terminal_check_secrets", {
    _actor: actorId,
  });
  if (answer.error) throw dbFailure(answer.error, "platform_terminal_check_secrets", deps.log);
  return openRow(asRow(answer.data), env, deps);
}
