// The second independent review's vitest probes (R2-2, R2-4, R2-6), kept as permanent regression tests: the
// reviewer's scenario, asserting the fixed behaviour (contract §7.1 X-14, X-18, X-19, X-20, X-25). Fakes only.
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const rpcCalls: string[] = [];
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdminUnscoped: {
    rpc: async (fn: string) => {
      rpcCalls.push(fn);
      return { data: fn === "expire_unpaid_orders" ? 1 : [], error: null };
    },
  },
}));

import {
  handlePlatformReturn,
  type PlatformReturnDeps,
} from "@/platform/payments/server/platform/return";
import { intentOf, secretCommitment } from "@/platform/payments/server/platform/terminal";
import { stepupPurposeHash } from "@/platform/payments/server/stepup";

const ENV_NAMES = [
  "PAYMENTS_ENV",
  "PLATFORM_ADMIN_HOST",
  "PAYMENTS_SECRETS_KEY",
  "PLATFORM_TERMINAL_SECRETS_KEY",
];
const saved = { ...process.env };
beforeAll(() => {
  process.env["PAYMENTS_ENV"] = "demo";
  process.env["PLATFORM_ADMIN_HOST"] = "platform.shop.localhost";
  process.env["PAYMENTS_SECRETS_KEY"] = randomBytes(32).toString("hex");
  process.env["PLATFORM_TERMINAL_SECRETS_KEY"] = randomBytes(32).toString("hex");
});
afterAll(() => {
  for (const name of ENV_NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rpcCalls.length = 0;
});

describe("R2-2: the 5-minute tick and the parking pass", () => {
  it("jobs on but payments not ready → expire_unpaid_orders, then the parking pass, the purge and the alert claim", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("PAYMENTS_SECRETS_KEY", "");
    const { paymentsTick } = await import("@/server/services/payment-expiry");
    await paymentsTick();
    // an order is never cancelled by a tick that skips the parking pass (X-19); the DB holds returned orders (X-14)
    expect(rpcCalls).toEqual([
      "expire_unpaid_orders",
      "max_attempts_expire",
      "platform_payment_returns_purge",
      "max_review_alerts_claim",
    ]);
  });

  it("PAYMENTS_JOBS=off on a configured server → only expire_unpaid_orders, and one ALERT jobs_off at start (X-25)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("PAYMENTS_JOBS", "off");
    const { paymentsTick, startPaymentExpiryJob } =
      await import("@/server/services/payment-expiry");
    startPaymentExpiryJob();
    await paymentsTick();
    expect(rpcCalls).toEqual(["expire_unpaid_orders"]);
    expect(errors.mock.calls.map((c) => String(c[0]))).toContain("[pay:tenant] ALERT jobs_off");
  });
});

describe("R2-4: a platform return that arrives while platform payments are not ready", () => {
  it("ready() false → the return is recorded first (the charge stays not payable), then no VERIFY (X-18)", async () => {
    const calls: string[] = [];
    const alerts: string[] = [];
    const deps: PlatformReturnDeps = {
      isPlatformHost: async () => true,
      ready: () => ({ ok: false, reason: "root_missing" }),
      endpoint: () => "http://127.0.0.1:1/hyp/p/",
      rpc: (async (fn: string) => {
        calls.push(fn);
        return { data: null, error: null };
      }) as unknown as PlatformReturnDeps["rpc"],
      credentials: async () => {
        throw new Error("not reached");
      },
      cipher: () => {
        throw new Error("not reached");
      },
      http: async () => ({ ok: false, error: "network" }),
      alert: async () => undefined,
      claimAlerts: async () => 0,
      log: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        alert: (event) => void alerts.push(event),
      },
    };
    const raw = `Id=fake1&CCode=0&Amount=10.00&ACode=0012345&Order=${"a".repeat(32)}&Coin=1&Sign=fakesig`;
    await handlePlatformReturn({ provider: "max", raw, host: "platform.localhost" }, deps);
    expect(calls).toContain("platform_attempt_record_return");
  });
});

describe("R2-6: the step-up code is bound to the secret VALUES, not only to which secrets change", () => {
  it("two saves with different KEY / PassP values give different purpose hashes (X-20)", () => {
    const actor = "c2090000-0000-4000-8000-0000000000f2";
    const key = randomBytes(32);
    const base = {
      terminalNumber: null,
      enabled: null,
      setApiKey: true,
      setApiPassword: true,
      clearCredentials: false,
      force: false,
    };
    const commits = (k: string, p: string) => ({
      apiKey: secretCommitment(key, "api_key", k),
      apiPassword: secretCommitment(key, "api_password", p),
    });
    const a = intentOf(base, "demo", commits("fake-key-a", "fake-pass-a"));
    const b = intentOf(base, "demo", commits("fake-key-b", "fake-pass-b"));
    expect(stepupPurposeHash(actor, "platform_terminal_change", a)).not.toBe(
      stepupPurposeHash(actor, "platform_terminal_change", b),
    );
  });
});
