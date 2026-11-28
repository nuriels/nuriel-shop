/**
 * MAX/Hyp payments — the environment guard (server only; plan §6.1 ENV-1, ENV-3, ENV-7, ENV-9).
 *
 * • paymentsEnv(): PAYMENTS_ENV must say "demo" or "production". It is never derived from NODE_ENV (that is
 *   "production" in every container). "production" counts only on the production platform host, and "demo" is
 *   refused there; anything else means payments are off (null).
 * • hypEndpoint(): the fixed Hyp address. The test-only MAX_PAY_TEST_URL (the local mock) is honoured only when it
 *   is http(s) to 127.0.0.1 / localhost AND the platform host itself is localhost / *.localhost — a host that
 *   cannot be served from the internet (the pattern of src/platform/ai/router.server.ts). It belongs in TEST_ONLY
 *   of tests/unit/env-forwarding.test.ts (contract §2) and is never forwarded to a container.
 * • paymentsReady(scope): the environment plus that scope's root secret: at least 32 characters, not a
 *   placeholder or a known E2E fixture, different from the other scope's root and from every other secret the
 *   app reads. No fallback to any other secret. Every refusal is a fixed lower-case code.
 * • paymentsStartupLine(): one value-free line for the server log / the DEMO server check.
 * • No value of any environment variable is ever returned, logged or put in an error.
 */
import { createHash } from "node:crypto";
import { MIN_ROOT_CHARS, safeEqual } from "./crypto";
import { platformRootSecret } from "./platform-keys";
import { tenantRootSecret } from "./tenant-keys";

export type PaymentsEnv = "demo" | "production";
/** = PaymentScope / PaymentMode in ../provider.ts */
type PaymentScope = "platform" | "tenant";
type PaymentMode = "test" | "live";

export const PRODUCTION_PLATFORM_HOST = "nuriel.nuri1.fit";
export const HYP_ENDPOINT = "https://pay.hyp.co.il/p/";

/** why payments are off: the fixed codes of paymentsReady() (also printed by paymentsStartupLine) */
export type PaymentsOffReason =
  | "env"
  | "scope"
  | "root_missing"
  | "root_short"
  | "root_placeholder"
  | "roots_equal"
  | "root_reused";

type EnvState = { env: PaymentsEnv } | { off: "unset" | "invalid" | "host_mismatch" };

/**
 * Every other secret the server reads (src/, docker-compose.yml). A payments root equal to one of them is refused:
 * one leaked value must never open the terminal credentials as well. Public keys are listed too (a root equal to
 * a public value is no secret at all).
 */
const OTHER_APP_SECRETS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "LOGIN_CODE_SECRET",
  "LICENSE_KEYS_SECRET",
  "GROW_SECRETS_KEY",
  "HOSPITALITY_SECRET",
  "BUSINESS_PROFILE_SECRET",
  "AI_ASSISTANT_SECRET",
  "GSC_OAUTH_CLIENT_SECRET",
  "RESEND_API_KEY",
] as const;

/** fragments of typical placeholder values (compared lower-case, letters and digits only) */
const PLACEHOLDER_WORDS = [
  "changeme",
  "replaceme",
  "placeholder",
  "example",
  "yoursecret",
  "yourkey",
  "secretkey",
  "secrethere",
  "keyhere",
  "notasecret",
  "insecure",
  "dummy",
  "default",
  "password",
  "sample",
];

/**
 * SHA-256 of the fixed secrets in e2e/scripts/app-up.sh that are long enough to pass the length check
 * (MX-19: an E2E fixture must never become a real root). tests/unit/payments-env.test.ts reads that script and
 * checks that every such fixture is refused.
 */
const KNOWN_FIXTURE_DIGESTS = new Set([
  "e0fa9ddf4c63f761cf1cc4fe06b583b73a35bdebdd7adf6b55711a8514c6c3d8",
  "d8380ad4bfcdda3a0f4ff13a4c03f2c71ebdb3ffe330705601983d3a4430f649",
]);

function platformHost(): string {
  return (process.env["PLATFORM_ADMIN_HOST"]?.trim().toLowerCase() ?? "").replace(/\.$/, "");
}

function envState(): EnvState {
  const marker = process.env["PAYMENTS_ENV"]?.trim();
  if (!marker) return { off: "unset" };
  if (marker !== "demo" && marker !== "production") return { off: "invalid" };
  const onProductionHost = platformHost() === PRODUCTION_PLATFORM_HOST;
  // production only on the production host; demo never there
  if ((marker === "production") !== onProductionHost) return { off: "host_mismatch" };
  return { env: marker };
}

/** "demo" | "production"; null = payments off (missing/unknown, or not matching the platform host) */
export function paymentsEnv(): PaymentsEnv | null {
  const state = envState();
  return "env" in state ? state.env : null;
}

const LOOPBACK_URL = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d{2,5})?(?:\/[\w/-]*)?$/;

/** the test-only mock address, when (and only when) every condition holds */
function mockOverride(): string | null {
  const override = process.env["MAX_PAY_TEST_URL"]?.trim();
  const host = platformHost();
  const localPlatform = host === "localhost" || host.endsWith(".localhost");
  if (!override || !localPlatform || !LOOPBACK_URL.test(override)) return null;
  try {
    const url = new URL(override);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    const web = url.protocol === "http:" || url.protocol === "https:";
    return loopback && web && !url.username && !url.password && !url.search && !url.hash
      ? override
      : null;
  } catch {
    return null;
  }
}

/** HYP_ENDPOINT, unless the guarded test-only MAX_PAY_TEST_URL applies (local mock on a local platform host) */
export function hypEndpoint(): string {
  return mockOverride() ?? HYP_ENDPOINT;
}

/** DM-ENV-3 (decision ה-4): DEMO uses only `test`, production only `live` */
export function modeAllowed(env: PaymentsEnv, mode: PaymentMode): boolean {
  return env === "demo" ? mode === "test" : env === "production" && mode === "live";
}

/**
 * DM-ENV-3 tripwire (never proof, plan §6.1): a DEMO terminal starts with 00100, a production terminal never
 * does. Terminal numbers are 10 digits (as in the DB CHECK).
 */
export function terminalAllowed(env: PaymentsEnv, terminal: string): boolean {
  if (typeof terminal !== "string" || !/^[0-9]{10}$/.test(terminal)) return false;
  const testPrefix = terminal.startsWith("00100");
  return env === "demo" ? testPrefix : env === "production" && !testPrefix;
}

function isPlaceholder(root: string): boolean {
  const flat = root.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (PLACEHOLDER_WORDS.some((word) => flat.includes(word))) return true;
  // "aaaa…", "0000…", "abab…", "0123456789" repeated: too few distinct characters or a short repeating block
  if (new Set(root).size < 8) return true;
  for (let period = 1; period <= 16; period++) {
    // periodic with this period ⇔ shifting it by the period changes nothing (compared in constant time)
    if (safeEqual(root.slice(period), root.slice(0, root.length - period))) return true;
  }
  const digest = createHash("sha256").update(root, "utf8").digest("hex");
  return [...KNOWN_FIXTURE_DIGESTS].some((known) => safeEqual(known, digest));
}

/** the root of one scope is usable on its own (no comparison with other values yet) */
function rootProblem(root: string | undefined): PaymentsOffReason | null {
  if (!root) return "root_missing";
  if (root.length < MIN_ROOT_CHARS) return "root_short";
  if (isPlaceholder(root)) return "root_placeholder";
  return null;
}

/** payments may run for this scope: { ok, env }, or a fixed reason code (never a value) */
export function paymentsReady(
  scope: PaymentScope,
): { ok: true; env: PaymentsEnv } | { ok: false; reason: PaymentsOffReason } {
  const env = paymentsEnv();
  if (!env) return { ok: false, reason: "env" };
  if (scope !== "tenant" && scope !== "platform") return { ok: false, reason: "scope" };
  const own = scope === "tenant" ? tenantRootSecret() : platformRootSecret();
  const other = scope === "tenant" ? platformRootSecret() : tenantRootSecret();
  const problem = rootProblem(own);
  if (problem !== null || own === undefined)
    return { ok: false, reason: problem ?? "root_missing" };
  if (other && safeEqual(own, other)) return { ok: false, reason: "roots_equal" };
  for (const name of OTHER_APP_SECRETS) {
    const value = process.env[name]?.trim();
    if (value && safeEqual(own, value)) return { ok: false, reason: "root_reused" };
  }
  return { ok: true, env };
}

/**
 * One line for the server log at start and for the DEMO server check, e.g.
 * "[payments] env=demo endpoint=hyp tenant=ready platform=off:root_missing".
 * Only fixed words: never a value of any environment variable (not even the host).
 */
export function paymentsStartupLine(): string {
  const state = envState();
  const env = "env" in state ? state.env : `off:${state.off}`;
  const endpoint = mockOverride() === null ? "hyp" : "local-mock";
  const scopeState = (scope: PaymentScope) => {
    const ready = paymentsReady(scope);
    return ready.ok ? "ready" : `off:${ready.reason}`;
  };
  return `[payments] env=${env} endpoint=${endpoint} tenant=${scopeState("tenant")} platform=${scopeState("platform")}`;
}
