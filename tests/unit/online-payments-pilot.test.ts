// MAX/Hyp — the production pilot (contract §7.2 P-4, P-6a, P-7, P-8) on the store side, and the terminal-administration
// guarantees P-6a (1)…(6). Fakes only: the DB caller, the Hyp client, the request context. No network, no database.
import { randomBytes } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
    platformRequest: true,
    platformAdmin: true,
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
vi.mock("@/integrations/supabase/tenant.server", () => ({
  isPlatformRequest: () => h.platformRequest,
  maybeCurrentTenant: () => null,
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdminUnscoped: {},
  isPlatformAdminUser: vi.fn(async () => h.platformAdmin),
}));
vi.mock("@/lib/rate-limit.server", () => ({ allowAction: () => true }));

const STORE_A = "7e2e0000-0000-0000-0000-00000000000a";
const STORE_B = "7e2e0000-0000-0000-0000-00000000000b";
const ORDER = "11111111-2222-4333-8444-555555555555";
const ATTEMPT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ADMIN = "e2e00000-0000-0000-0000-0000000000f0";
const STORE_ADMIN = "e2e00000-0000-0000-0000-0000000000a1";
const REFERENCE = "0123456789abcdef0123456789abcdef";
/** declared fake terminals (scripts/security/declared-fakes.json) */
const TERMINAL = "0010090003";
/** distinctive fake values: none of them may ever appear in a response, a log line or an error */
const FAKE_KEY = "fake-key-p6a-zq81";
const FAKE_PASSP = "fake-passp-p6a-wx27";
const MOCK_ENDPOINT = "http://127.0.0.1:4010/hyp/p/";
const PILOT_REFUSAL = "online payment: this store is not in the pilot";

const ENV_NAMES = [
  "PAYMENTS_ENV",
  "PLATFORM_ADMIN_HOST",
  "MAX_PAY_TEST_URL",
  "PAYMENTS_SECRETS_KEY",
  "PLATFORM_TERMINAL_SECRETS_KEY",
  "PAYMENTS_JOBS",
];
const saved = { ...process.env };
const setPilot = () => {
  process.env["PAYMENTS_ENV"] = "pilot";
  process.env["PLATFORM_ADMIN_HOST"] = "platform.shop.localhost";
  process.env["MAX_PAY_TEST_URL"] = MOCK_ENDPOINT;
};
beforeAll(() => {
  setPilot();
  process.env["PAYMENTS_SECRETS_KEY"] = randomBytes(32).toString("hex");
  process.env["PLATFORM_TERMINAL_SECRETS_KEY"] = randomBytes(32).toString("hex");
  delete process.env["PAYMENTS_JOBS"];
});
afterAll(() => {
  for (const name of ENV_NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

/** every console line written during the test (log, info, warn, error) */
let lines: string[] = [];
let spies: { mockRestore(): void }[] = [];
beforeEach(() => {
  setPilot();
  h.calls.length = 0;
  h.hyp.length = 0;
  h.answers.clear();
  h.hypAnswer = () => ({ ok: false, error: "network" });
  h.platformRequest = true;
  h.platformAdmin = true;
  lines = [];
  spies = (["log", "info", "warn", "error"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    }),
  );
});
afterEach(() => {
  for (const spy of spies) spy.mockRestore();
});

const ok = (data: unknown) => () => ({ data, error: null });
const refused = (message: string) => () => ({ data: null, error: { message, code: "P0001" } });
const callsOf = (fn: string) => h.calls.filter((c) => c.fn === fn);

async function sealedFor(tenantId: string, env: "pilot" | "demo" = "pilot") {
  const { tenantSecretCipher } = await import("@/platform/payments/server/tenant-keys");
  const cipher = tenantSecretCipher(env, "test");
  const ctx = { tenantId, accountId: tenantId };
  return {
    terminal_number: TERMINAL,
    mode: "test",
    key_id: cipher.kid,
    api_key_enc: cipher.seal("api_key", FAKE_KEY, ctx),
    api_password_enc: cipher.seal("api_password", FAKE_PASSP, ctx),
  };
}
const signBody = () =>
  `action=pay&Masof=${TERMINAL}&Amount=1.00&Coin=1&Order=${"c".repeat(32)}&Sign=True&MoreData=True&hideBtns=True&PageLang=HEB&signature=${"a".repeat(64)}`;

/** true when the text carries a secret value or a ciphertext token */
const leaks = (text: string) =>
  text.includes(FAKE_KEY) || text.includes(FAKE_PASSP) || /v1:[0-9a-f]{8}:/.test(text);

describe("P-7: PAYMENTS_ENV=pilot", () => {
  it("is accepted on the production platform host and on a *.localhost host only; demo and production unchanged", async () => {
    const { paymentsEnv } = await import("@/platform/payments/server/env");
    const cases: [string, string, string | null][] = [
      ["pilot", "nuriel.nuri1.fit", "pilot"],
      ["pilot", "platform.shop.localhost", "pilot"],
      ["pilot", "localhost", "pilot"],
      ["pilot", "demo.example.org", null],
      ["demo", "nuriel.nuri1.fit", null],
      ["demo", "demo.example.org", "demo"],
      ["production", "nuriel.nuri1.fit", "production"],
      ["production", "platform.shop.localhost", null],
      ["Pilot", "nuriel.nuri1.fit", null],
    ];
    for (const [marker, host, expected] of cases) {
      process.env["PAYMENTS_ENV"] = marker;
      process.env["PLATFORM_ADMIN_HOST"] = host;
      expect(paymentsEnv(), `${marker}@${host}`).toBe(expected);
    }
  });

  it("allows mode test only, needs a 00100… terminal, the platform scope is off, the startup line says env=pilot", async () => {
    const env = await import("@/platform/payments/server/env");
    expect(env.envMode("pilot")).toBe("test");
    expect(env.modeAllowed("pilot", "test")).toBe(true);
    expect(env.modeAllowed("pilot", "live")).toBe(false);
    expect(env.terminalAllowed("pilot", TERMINAL)).toBe(true);
    expect(env.terminalAllowed("pilot", "1234567890")).toBe(false);
    expect(env.isTestEnv("pilot")).toBe(true);
    // the DEMO server flag (visible to every visitor) stays off in the pilot: no hint to customers (P-4)
    expect(env.demoServer()).toBe(false);
    expect(env.paymentsReady("tenant")).toEqual({ ok: true, env: "pilot" });
    expect(env.paymentsReady("platform")).toEqual({ ok: false, reason: "pilot" });
    expect(env.paymentsStartupLine()).toMatch(
      /^\[payments\] env=pilot endpoint=local-mock tenant=ready platform=off:pilot$/,
    );
    // the same root-key rules as today
    const root = process.env["PAYMENTS_SECRETS_KEY"];
    try {
      process.env["PAYMENTS_SECRETS_KEY"] = "";
      expect(env.paymentsReady("tenant")).toEqual({ ok: false, reason: "root_missing" });
      process.env["PAYMENTS_SECRETS_KEY"] = "short";
      expect(env.paymentsReady("tenant")).toEqual({ ok: false, reason: "root_short" });
    } finally {
      process.env["PAYMENTS_SECRETS_KEY"] = root;
    }
  });

  it("the tenant key exists for pilot/test only; a demo token never opens in the pilot (env is in the context)", async () => {
    const { tenantSecretCipher } = await import("@/platform/payments/server/tenant-keys");
    expect(() => tenantSecretCipher("pilot", "live")).toThrow();
    const ctx = { tenantId: STORE_A, accountId: STORE_A };
    const demoToken = tenantSecretCipher("demo", "test").seal("api_key", FAKE_KEY, ctx);
    expect(() => tenantSecretCipher("pilot", "test").open("api_key", demoToken, ctx)).toThrow();
    const pilotToken = tenantSecretCipher("pilot", "test").seal("api_key", FAKE_KEY, ctx);
    expect(tenantSecretCipher("pilot", "test").open("api_key", pilotToken, ctx)).toBe(FAKE_KEY);
  });

  it("payments unset → off, exactly as production runs today", async () => {
    const env = await import("@/platform/payments/server/env");
    delete process.env["PAYMENTS_ENV"];
    expect(env.paymentsEnv()).toBeNull();
    expect(env.paymentsReady("tenant")).toEqual({ ok: false, reason: "env" });
    expect(env.testPaymentsEnv()).toBe(false);
  });
});

describe("P-4 / P-8: who sees the card payment in the pilot", () => {
  it("a viewer the DB does not offer it to gets no option and no hint of a test environment", async () => {
    const { tenantPaymentOptions } = await import("@/platform/payments/server/tenant/checkout");
    h.answers.set("max_payments_active", ok(false));
    expect(await tenantPaymentOptions(STORE_A, null)).toEqual({
      available: false,
      demo: false,
      maxAmountMinor: null,
    });
    h.answers.set("max_payments_active", ok(true));
    expect(await tenantPaymentOptions(STORE_A, STORE_ADMIN)).toEqual({
      available: true,
      demo: true,
      maxAmountMinor: 5000,
    });
    expect(callsOf("max_payments_active")[1]?.args).toEqual({
      _tenant: STORE_A,
      _actor: STORE_ADMIN,
    });
  });

  it("a store outside the pilot list: every store-side function gets the DB's refusal as one fixed text, no Hyp call", async () => {
    const { PILOT_NOT_LISTED } = await import("@/platform/payments/tenant-views");
    const checkout = await import("@/platform/payments/server/tenant/checkout");
    const staff = await import("@/platform/payments/server/tenant/staff");
    const admin = await import("@/platform/payments/server/tenant/admin");
    const owner = await import("@/platform/payments/server/tenant/owner");
    for (const fn of [
      "max_attempt_open",
      "max_order_payment_status",
      "max_attempt_cancel",
      "max_review_resolve",
      "platform_store_terminal_save",
      "platform_store_terminal_check_secrets",
      "max_account_status",
    ])
      h.answers.set(fn, refused(PILOT_REFUSAL));
    const calls: [string, () => Promise<unknown>][] = [
      [
        "startTenantPayment",
        () =>
          checkout.startTenantPayment({
            tenantId: STORE_B,
            orderId: ORDER,
            customerId: STORE_ADMIN,
            guestToken: null,
          }),
      ],
      ["staffOrderPayment", () => staff.staffOrderPayment(STORE_ADMIN, STORE_B, ORDER)],
      ["cancelOrderAttempt", () => staff.cancelOrderAttempt(STORE_ADMIN, STORE_B, ORDER)],
      [
        "resolveOrderReview",
        () => staff.resolveOrderReview(STORE_ADMIN, STORE_B, ATTEMPT, null, "not_charged"),
      ],
      [
        "saveStoreTerminal",
        () => admin.saveStoreTerminal(ADMIN, STORE_B, { terminalNumber: TERMINAL, enabled: true }),
      ],
      ["testStoreTerminal", () => admin.testStoreTerminal(ADMIN, STORE_B)],
      ["storeTerminalStatus", () => owner.storeTerminalStatus(ADMIN, STORE_B)],
    ];
    for (const [name, call] of calls) {
      await expect(call(), name).rejects.toThrow(PILOT_NOT_LISTED);
    }
    expect(h.hyp).toHaveLength(0);
    // the owner's pilot card reads "coming soon" for such a store
    expect(await owner.storePilotStatus(STORE_ADMIN, STORE_B)).toEqual({
      kind: "pilot",
      active: false,
      demo: false,
    });
  });

  it("the pilot store's owner sees only on / coming soon — no terminal number, no hint, no key flag", async () => {
    const { storePilotStatus } = await import("@/platform/payments/server/tenant/owner");
    h.answers.set(
      "max_account_status",
      ok({
        configured: true,
        active: true,
        enabled: true,
        mode: "test",
        terminal_hint: "03",
        terminal_number: TERMINAL,
        has_api_key: true,
        has_api_password: true,
      }),
    );
    const view = await storePilotStatus(STORE_ADMIN, STORE_A);
    expect(view).toEqual({ kind: "pilot", active: true, demo: true });
    expect(JSON.stringify(view)).not.toMatch(/0010090003|03|has_api/);
  });
});

describe("P-6a: terminal administration", () => {
  it("P-6a (1): only the platform admin on the platform host reaches a store terminal — refused before any DB call", async () => {
    const { requirePlatformTerminalAdmin } = await import("@/lib/online-payments.server");
    h.platformRequest = false;
    await expect(requirePlatformTerminalAdmin(ADMIN, 10)).rejects.toThrow("רק מפאנל הפלטפורמה");
    h.platformRequest = true;
    h.platformAdmin = false;
    // a store admin of A (not a platform admin) calling for A or for B
    await expect(requirePlatformTerminalAdmin(STORE_ADMIN, 10)).rejects.toThrow(
      "אין הרשאה לפעולה הזו",
    );
    h.platformAdmin = true;
    await expect(requirePlatformTerminalAdmin(ADMIN, 10)).resolves.toBeUndefined();
    expect(h.calls).toHaveLength(0);
  });

  it("P-6a (3): a save stores the KEY / PassP only as tokens bound to the store, mode test and env pilot", async () => {
    const { saveStoreTerminal } = await import("@/platform/payments/server/tenant/admin");
    const { tenantSecretCipher } = await import("@/platform/payments/server/tenant-keys");
    h.answers.set("platform_store_terminal_save", ok({ configured: true, has_api_key: true }));
    await saveStoreTerminal(ADMIN, STORE_A, {
      terminalNumber: TERMINAL,
      apiKey: FAKE_KEY,
      apiPassword: FAKE_PASSP,
    });
    const patch = callsOf("platform_store_terminal_save")[0]?.args?.["_patch"] as Record<
      string,
      unknown
    >;
    expect(patch["mode"]).toBe("test");
    expect(String(patch["api_key_enc"])).toMatch(/^v1:/);
    expect(JSON.stringify(patch)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(patch)).not.toContain(FAKE_PASSP);
    const ctx = { tenantId: STORE_A, accountId: STORE_A };
    expect(
      tenantSecretCipher("pilot", "test").open("api_key", String(patch["api_key_enc"]), ctx),
    ).toBe(FAKE_KEY);
    expect(callsOf("platform_store_terminal_save")[0]?.args?.["_app_environment"]).toBe("pilot");
  });

  it("P-6a (4): no response of a store-terminal function carries a KEY / PassP value or a token — save, status, owner read, connection check, unreturned list", async () => {
    const admin = await import("@/platform/payments/server/tenant/admin");
    const owner = await import("@/platform/payments/server/tenant/owner");
    const { SECRET_MASK } = await import("@/platform/payments/tenant-views");
    // a DB answer that (wrongly) carries the tokens and even plain values: nothing of it may pass through
    const sealed = await sealedFor(STORE_A);
    const noisy = {
      configured: true,
      active: true,
      enabled: true,
      status: "verified",
      terminal_hint: "03",
      has_api_key: true,
      has_api_password: true,
      ...sealed,
      api_key: FAKE_KEY,
      api_password: FAKE_PASSP,
    };
    h.answers.set("platform_store_terminal_save", ok(noisy));
    h.answers.set("max_account_status", ok(noisy));
    h.answers.set("platform_store_terminal_check_secrets", ok(sealed));
    h.answers.set("platform_store_terminal_verified", ok(true));
    h.answers.set(
      "max_unreturned_attempts",
      ok([{ order_number: "1042", amount_minor: 1000, state: "redirected", ...sealed }]),
    );
    h.hypAnswer = () => ({ ok: true, status: 200, body: signBody(), html: false });
    const responses: [string, unknown][] = [
      [
        "saveStoreTerminal",
        await admin.saveStoreTerminal(ADMIN, STORE_A, {
          apiKey: FAKE_KEY,
          apiPassword: FAKE_PASSP,
        }),
      ],
      ["storeTerminalStatus", await owner.storeTerminalStatus(ADMIN, STORE_A)],
      ["storePilotStatus", await owner.storePilotStatus(STORE_ADMIN, STORE_A)],
      ["testStoreTerminal", await admin.testStoreTerminal(ADMIN, STORE_A)],
      ["storeUnreturnedAttempts", await admin.storeUnreturnedAttempts(ADMIN, STORE_A)],
    ];
    for (const [name, response] of responses) {
      expect(leaks(JSON.stringify(response)), name).toBe(false);
      // the full terminal number never leaves either: the admin gets the 2-digit hint only
      expect(JSON.stringify(response), name).not.toContain(TERMINAL);
    }
    const status = responses[1]?.[1] as { apiKeyMask: string | null; hasApiKey: boolean };
    expect(status.apiKeyMask).toBe(SECRET_MASK);
    expect(status.hasApiKey).toBe(true);
  });

  it("P-6a (5): an account belongs to the store named in the request — tokens of store B do not open for store A", async () => {
    const admin = await import("@/platform/payments/server/tenant/admin");
    // the DB hands out B's tokens for a check of A (a mix-up or tampering): the AAD binds them to B
    h.answers.set("platform_store_terminal_check_secrets", ok(await sealedFor(STORE_B)));
    await expect(admin.testStoreTerminal(ADMIN, STORE_A)).rejects.toThrow();
    expect(h.hyp).toHaveLength(0);
    expect(callsOf("platform_store_terminal_check_secrets")[0]?.args).toEqual({
      _actor: ADMIN,
      _tenant: STORE_A,
    });
    // a save for A names A to the DB, and its tokens open only as A's
    h.calls.length = 0;
    h.answers.set("platform_store_terminal_save", ok({ configured: true }));
    await admin.saveStoreTerminal(ADMIN, STORE_A, { apiKey: FAKE_KEY });
    const args = callsOf("platform_store_terminal_save")[0]?.args;
    expect(args?.["_tenant"]).toBe(STORE_A);
    const { tenantSecretCipher } = await import("@/platform/payments/server/tenant-keys");
    const token = String((args?.["_patch"] as Record<string, unknown>)["api_key_enc"]);
    expect(() =>
      tenantSecretCipher("pilot", "test").open("api_key", token, {
        tenantId: STORE_B,
        accountId: STORE_B,
      }),
    ).toThrow();
  });

  it("P-6a (6): save, connection check and a return VERIFY with distinctive values — none in a log line or an error", async () => {
    const admin = await import("@/platform/payments/server/tenant/admin");
    const { handleTenantReturn } = await import("@/platform/payments/server/tenant/return");
    const errors: string[] = [];
    const run = async (work: () => Promise<unknown>) => {
      try {
        await work();
      } catch (error) {
        errors.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
      }
    };
    h.answers.set("platform_store_terminal_save", refused(`invalid settings ${FAKE_KEY}`));
    await run(() =>
      admin.saveStoreTerminal(ADMIN, STORE_A, { apiKey: FAKE_KEY, apiPassword: FAKE_PASSP }),
    );
    // too long: refused before the DB, the message names no value
    await run(() =>
      admin.saveStoreTerminal(ADMIN, STORE_A, { apiKey: `${FAKE_KEY}${"x".repeat(300)}` }),
    );
    h.answers.set("platform_store_terminal_check_secrets", ok(await sealedFor(STORE_A)));
    h.answers.set("platform_store_terminal_verified", ok(true));
    h.hypAnswer = () => ({
      ok: true,
      status: 200,
      body: `CCode=902&errMsg=${FAKE_KEY}`,
      html: false,
    });
    await run(() => admin.testStoreTerminal(ADMIN, STORE_A));
    // a return: VERIFY with the attempt's (fake) credentials
    h.answers.set(
      "max_attempt_record_return",
      ok({
        result: "received",
        attempt_id: ATTEMPT,
        tenant_id: STORE_A,
        order_id: ORDER,
        state: "returned",
        terminal_number: TERMINAL,
        mode: "test",
      }),
    );
    h.answers.set("max_return_keep", ok(true));
    h.answers.set("max_attempt_secrets", async () => ({
      data: { result: "ok", ...(await sealedFor(STORE_A)) },
      error: null,
    }));
    h.answers.set("max_attempt_mark_paid", ok({ result: "unverified" }));
    h.answers.set("platform_payment_returns_purge", ok(0));
    h.answers.set("max_review_alerts_claim", ok([]));
    h.hypAnswer = () => ({ ok: false, error: "timeout" });
    await run(() =>
      handleTenantReturn({
        provider: "max",
        raw: `Id=1&CCode=0&Amount=10.00&ACode=0012345&Order=${REFERENCE}&Payments=1&Coin=1&Sign=${"b".repeat(64)}`,
        hostTenantId: STORE_A,
        host: "store-a.shop.localhost",
      }),
    );
    // the credentials did reach Hyp (VERIFY) — and nowhere else
    expect(h.hyp.some((call) => call.query.includes(FAKE_KEY))).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of [...lines, ...errors]) expect(leaks(line), line).toBe(false);
    for (const line of [...lines, ...errors]) expect(line, line).not.toContain(TERMINAL);
  });
});
