// The first independent review's vitest probes (R-T1, R-T2, R-T3, R-P1), kept as permanent regression tests: the
// reviewer's scenario, asserting the fixed behaviour (contract §7 M1/M2, §7.1 X-17). Fakes only: no network, no DB.
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  type Answer = { data: unknown; error: { message: string; code: string | null } | null };
  return {
    calls: [] as { fn: string; args: Record<string, unknown> | undefined }[],
    answers: new Map<
      string,
      (args: Record<string, unknown> | undefined) => Answer | Promise<Answer>
    >(),
    hyp: [] as { endpoint: string; query: string }[],
    hypAnswer: (() => ({ ok: false, error: "network" })) as (query: string) => unknown,
  };
});

vi.mock("@/platform/payments/server/db", () => ({
  paymentsRpc: vi.fn(async (fn: string, args?: Record<string, unknown>) => {
    h.calls.push({ fn, args });
    const answer = h.answers.get(fn);
    return answer
      ? answer(args)
      : { data: null, error: { message: `unexpected ${fn}`, code: null } };
  }),
  stepupRpc: vi.fn(),
  accountEmail: vi.fn(),
}));
vi.mock("@/platform/payments/server/http", () => ({
  HYP_HTTP_DEFAULTS: { timeoutMs: 15_000, maxBytes: 64 * 1024 },
  hypRequest: vi.fn(async (endpoint: string, query: string) => {
    h.hyp.push({ endpoint, query });
    return h.hypAnswer(query);
  }),
}));
vi.mock("@/platform/tenancy/current-site.server", () => ({
  isPlatformHost: vi.fn(async () => false),
}));

const STORE_B = "7e2e0000-0000-0000-0000-00000000000b";
const ORDER = "11111111-2222-4333-8444-555555555555";
const ATTEMPT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const REFERENCE = "0123456789abcdef0123456789abcdef";
const TERMINAL = "0010090003";
const MOCK_ENDPOINT = "http://127.0.0.1:4010/hyp/p/";
const ENV_NAMES = [
  "PAYMENTS_ENV",
  "PLATFORM_ADMIN_HOST",
  "MAX_PAY_TEST_URL",
  "PAYMENTS_SECRETS_KEY",
  "PLATFORM_TERMINAL_SECRETS_KEY",
];
const saved = { ...process.env };
beforeAll(() => {
  process.env["PAYMENTS_ENV"] = "demo";
  process.env["PLATFORM_ADMIN_HOST"] = "platform.shop.localhost";
  process.env["MAX_PAY_TEST_URL"] = MOCK_ENDPOINT;
  process.env["PAYMENTS_SECRETS_KEY"] = randomBytes(32).toString("hex");
  process.env["PLATFORM_TERMINAL_SECRETS_KEY"] = randomBytes(32).toString("hex");
});
afterAll(() => {
  for (const name of ENV_NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

const ok = (data: unknown) => () => ({ data, error: null });
const returnQuery = () =>
  `Id=123456789012&CCode=0&Amount=10.00&ACode=0012345&Order=${REFERENCE}&Payments=1&L4digit=1234&Coin=1&Sign=${"b".repeat(64)}`;
const claimRow = (reason: string) => ({
  attempt_id: ATTEMPT,
  tenant_id: STORE_B,
  order_id: ORDER,
  review_reason: reason,
});

beforeEach(() => {
  h.calls.length = 0;
  h.hyp.length = 0;
  h.answers.clear();
});

function recorded() {
  h.answers.set(
    "max_attempt_record_return",
    ok({
      result: "received",
      attempt_id: ATTEMPT,
      tenant_id: STORE_B,
      order_id: ORDER,
      state: "returned",
      terminal_number: TERMINAL,
      mode: "test",
    }),
  );
  h.answers.set("max_return_keep", ok(true));
  h.answers.set("platform_payment_returns_purge", ok(0));
  h.answers.set("max_review_alerts_claim", ok([]));
}

async function alertsDuring(fn: () => Promise<unknown>): Promise<string[]> {
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    await fn();
    return error.mock.calls.map((c) => String(c[0])).filter((line) => line.includes("ALERT"));
  } finally {
    error.mockRestore();
    warn.mockRestore();
  }
}

describe("review 1 — a payment parked or stuck must reach a person", () => {
  it("R-T1: VERIFY exhausted (the DB parked it 'verify_exhausted') → the claim hands the store its review", async () => {
    recorded();
    h.answers.set("max_attempt_secrets", ok({ result: "exhausted" }));
    h.answers.set("max_review_alerts_claim", ok([claimRow("verify_exhausted")]));
    const { handleTenantReturn } = await import("@/platform/payments/server/tenant/return");
    let out: Awaited<ReturnType<typeof handleTenantReturn>> | undefined;
    const alerts = await alertsDuring(async () => {
      out = await handleTenantReturn({
        provider: "max",
        raw: returnQuery(),
        hostTenantId: STORE_B,
        host: "store-b.shop.localhost",
      });
    });
    expect(out?.review).toEqual([
      { tenantId: STORE_B, attemptId: ATTEMPT, orderId: ORDER, reason: "verify_exhausted" },
    ]);
    expect(alerts.some((line) => line.includes("ALERT needs_review"))).toBe(true);
    expect(h.hyp).toHaveLength(0);
  });

  it("R-T2: the attempt's terminal was changed meanwhile (secrets refused) → an ALERT line, no VERIFY", async () => {
    recorded();
    h.answers.set("max_attempt_secrets", () => ({
      data: null,
      error: {
        message: "online payment: the terminal of this attempt is no longer configured",
        code: "23514",
      },
    }));
    const { handleTenantReturn } = await import("@/platform/payments/server/tenant/return");
    const alerts = await alertsDuring(() =>
      handleTenantReturn({
        provider: "max",
        raw: returnQuery(),
        hostTenantId: STORE_B,
        host: "store-b.shop.localhost",
      }),
    );
    expect(h.hyp).toHaveLength(0);
    expect(alerts.some((line) => line.includes("ALERT verify_credentials_refused"))).toBe(true);
    // and the claim ran, so the DB's park (credentials change with force, or the sweep) rings once
    expect(h.calls.at(-1)?.fn).toBe("max_review_alerts_claim");
  });

  it("R-T3: the job's re-VERIFY hitting 'exhausted' → no VERIFY; the same tick's claim reports the review", async () => {
    const { tenantSecretCipher } = await import("@/platform/payments/server/tenant-keys");
    const raw = returnQuery();
    const sealed = tenantSecretCipher("demo", "test").seal("raw_return", raw, {
      tenantId: STORE_B,
      accountId: ATTEMPT,
    });
    const sha = createHash("sha256").update(raw, "utf8").digest("hex");
    h.answers.set(
      "max_attempts_pending_verify",
      ok([
        {
          attempt_id: ATTEMPT,
          tenant_id: STORE_B,
          reference: REFERENCE,
          payload_sha256: sha,
          mode: "test",
        },
      ]),
    );
    h.answers.set("max_return_get", ok(sealed));
    h.answers.set("max_attempt_secrets", ok({ result: "exhausted" }));
    h.answers.set("max_attempts_expire", ok(0));
    h.answers.set("platform_payment_returns_purge", ok(0));
    h.answers.set("max_review_alerts_claim", ok([claimRow("verify_exhausted")]));
    const { runTenantPaymentJobs } = await import("@/platform/payments/server/tenant/jobs");
    let out: Awaited<ReturnType<typeof runTenantPaymentJobs>> | undefined;
    await alertsDuring(async () => (out = await runTenantPaymentJobs()));
    expect(out?.review).toHaveLength(1);
    expect(out?.review[0]?.reason).toBe("verify_exhausted");
    expect(h.hyp).toHaveLength(0);
  });
});

describe("review 1 — the same stuck case on NURIEL's terminal", () => {
  it("R-P1: VERIFY credentials refused (terminal changed while the owner was on Hyp's page) → platform ALERT", async () => {
    const { handlePlatformReturn } = await import("@/platform/payments/server/platform/return");
    const { PlatformPaymentError } = await import("@/platform/payments/server/platform/db");
    const alerts: string[] = [];
    const rpc = vi.fn(async (fn: string) => {
      if (fn === "platform_attempt_record_return")
        return {
          data: {
            result: "received",
            attempt_id: ATTEMPT,
            payer_tenant_id: STORE_B,
            state: "returned",
            terminal_number: TERMINAL,
            mode: "test",
            return_origin: null,
          },
          error: null,
        };
      if (fn === "platform_return_keep") return { data: true, error: null };
      return { data: 0, error: null };
    });
    const out = await handlePlatformReturn(
      { provider: "max", raw: returnQuery(), host: "platform.shop.localhost" },
      {
        isPlatformHost: async () => true,
        ready: () => ({ ok: true, env: "demo" }),
        endpoint: () => MOCK_ENDPOINT,
        rpc: rpc as never,
        credentials: async () => {
          throw new PlatformPaymentError("unavailable");
        },
        cipher: () => ({ kid: "0badc0de", seal: () => "v1:x", open: () => "" }),
        http: vi.fn() as never,
        alert: async (reason) => void alerts.push(reason),
        claimAlerts: async () => 0,
        log: {
          info: () => {},
          warn: () => {},
          error: () => {},
          alert: (event) => void alerts.push(event),
        },
      },
    );
    expect(out.result).toBe("error");
    expect(alerts.length).toBeGreaterThan(0);
  });
});
