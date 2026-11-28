/**
 * MAX/Hyp payments — the key for NURIEL's own terminal (scope `platform`; server only).
 *
 * • Root: PLATFORM_TERMINAL_SECRETS_KEY, read in this file and nowhere else (U17-B6). No fallback to any other
 *   secret: without it (or with fewer than 32 characters) nothing can be sealed, opened or step-up signed.
 * • HKDF info "nuriel/payments/v1/<env>/platform/<mode>"; AAD
 *   "<env>|platform|platform|max|<mode>|<accountId>|<field>|<kid>" (the third part is the owner: always
 *   "platform" in this scope, a store id in the tenant scope). accountId is exactly PLATFORM_ACCOUNT_ID
 *   ("platform") for the terminal credentials themselves, or the attempt id (a UUID) for an encrypted raw return;
 *   anything else is refused.
 * • stepupKey(env): HKDF(root, "nuriel/payments/v1/<env>/platform/stepup") — the HMAC key of the one-time codes
 *   that approve a change of the platform terminal (stepup.ts). It never equals a cipher key (other label).
 * • DEMO works only with `test`, production only with `live` (decision ה-4, DM-ENV-3).
 * • Callers check paymentsReady("platform") (env.ts) first. Nothing is cached between calls (U17-B8).
 */
import { MIN_ROOT_CHARS, hkdfKey, joinAad, keyIdOf, open, seal } from "./crypto";
import type { PaymentsEnv } from "./env";

/** = PaymentMode in ../provider.ts */
type PaymentMode = "test" | "live";
type PlatformContext = { accountId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FIELD = /^[a-z][a-z0-9_]{0,63}$/;

/** the only reader of the platform root secret (trimmed; undefined when absent or empty) */
export function platformRootSecret(): string | undefined {
  return process.env["PLATFORM_TERMINAL_SECRETS_KEY"]?.trim() || undefined;
}

function usableRoot(): string {
  const root = platformRootSecret();
  if (!root || root.length < MIN_ROOT_CHARS) throw new Error("payments: platform key unavailable");
  return root;
}

/** the accountId of NURIEL's terminal credentials (the DB returns no account row id for them) */
export const PLATFORM_ACCOUNT_ID = "platform";

/** exactly PLATFORM_ACCOUNT_ID, or a UUID (an attempt: its raw return), lower-case; anything else → null */
const accountOrNull = (value: unknown): string | null => {
  if (value === PLATFORM_ACCOUNT_ID) return PLATFORM_ACCOUNT_ID;
  const text = typeof value === "string" ? value.toLowerCase() : "";
  return UUID.test(text) ? text : null;
};

export function platformSecretCipher(
  env: PaymentsEnv,
  mode: PaymentMode,
): {
  kid: string;
  seal(field: string, value: string, ctx: PlatformContext): string;
  open(field: string, token: string, ctx: PlatformContext): string;
} {
  // the same rule as modeAllowed() in env.ts (inline here: env.ts imports this file)
  const allowed = env === "demo" ? mode === "test" : env === "production" && mode === "live";
  if (!allowed) throw new Error("payments: platform key unavailable");
  const root = usableRoot();
  const kid = keyIdOf(root);
  const key = hkdfKey(root, `nuriel/payments/v1/${env}/platform/${mode}`);
  const aad = (field: unknown, ctx: PlatformContext | undefined): string | null => {
    const accountId = accountOrNull(ctx?.accountId);
    if (!accountId || typeof field !== "string" || !FIELD.test(field)) return null;
    return joinAad([env, "platform", "platform", "max", mode, accountId, field, kid]);
  };
  return {
    kid,
    seal(field, value, ctx) {
      const bound = aad(field, ctx);
      if (bound === null) throw new Error("payments: encrypt failed");
      return seal(key, value, bound, kid);
    },
    open(field, token, ctx) {
      const bound = aad(field, ctx);
      if (bound === null) throw new Error("payments: decrypt failed");
      return open(key, token, bound);
    },
  };
}

/** the HMAC key of the step-up codes for the platform terminal (one per environment) */
export function stepupKey(env: PaymentsEnv): Buffer {
  if (env !== "demo" && env !== "production") throw new Error("payments: platform key unavailable");
  return hkdfKey(usableRoot(), `nuriel/payments/v1/${env}/platform/stepup`);
}
