/**
 * MAX/Hyp payments — the key for the stores' own terminals (scope `tenant`; server only).
 *
 * • Root: PAYMENTS_SECRETS_KEY, read in this file and nowhere else (U17-B6). No fallback to any other secret:
 *   without it (or with fewer than 32 characters) nothing can be sealed or opened.
 * • HKDF info "nuriel/payments/v1/<env>/tenant/<mode>"; AAD
 *   "<env>|tenant|<tenantId>|max|<mode>|<accountId>|<field>|<kid>". A token copied to another store, account,
 *   field, mode, scope or environment does not open.
 * • DEMO works only with `test`, production only with `live` (decision ה-4, DM-ENV-3): any other pair is refused
 *   here too, so a DEMO instance cannot even build a key for live credentials.
 * • Callers check paymentsReady("tenant") (env.ts) first: it adds the checks that need the other secrets
 *   (the two roots differ, no reuse of another app secret, no placeholder).
 * • Nothing is cached between calls (U17-B8): each cipher is built on demand and lives only with its caller.
 */
import { MIN_ROOT_CHARS, hkdfKey, joinAad, keyIdOf, open, seal } from "./crypto";
import type { PaymentsEnv } from "./env";

/** = PaymentMode in ../provider.ts */
type PaymentMode = "test" | "live";
type TenantContext = { tenantId: string; accountId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FIELD = /^[a-z][a-z0-9_]{0,63}$/;

/** the only reader of the tenant root secret (trimmed; undefined when absent or empty) */
export function tenantRootSecret(): string | undefined {
  return process.env["PAYMENTS_SECRETS_KEY"]?.trim() || undefined;
}

const uuidOrNull = (value: unknown): string | null => {
  const text = typeof value === "string" ? value.toLowerCase() : "";
  return UUID.test(text) ? text : null;
};

export function tenantSecretCipher(
  env: PaymentsEnv,
  mode: PaymentMode,
): {
  kid: string;
  seal(field: string, value: string, ctx: TenantContext): string;
  open(field: string, token: string, ctx: TenantContext): string;
} {
  // the same rule as modeAllowed() in env.ts (inline here: env.ts imports this file)
  const allowed = env === "demo" ? mode === "test" : env === "production" && mode === "live";
  const root = tenantRootSecret();
  if (!allowed || !root || root.length < MIN_ROOT_CHARS) {
    throw new Error("payments: tenant key unavailable");
  }
  const kid = keyIdOf(root);
  const key = hkdfKey(root, `nuriel/payments/v1/${env}/tenant/${mode}`);
  const aad = (field: unknown, ctx: TenantContext | undefined): string | null => {
    const tenantId = uuidOrNull(ctx?.tenantId);
    const accountId = uuidOrNull(ctx?.accountId);
    if (!tenantId || !accountId || typeof field !== "string" || !FIELD.test(field)) return null;
    return joinAad([env, "tenant", tenantId, "max", mode, accountId, field, kid]);
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
