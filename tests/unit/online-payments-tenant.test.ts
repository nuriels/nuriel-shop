// MAX/Hyp DEMO — the store (tenant) payment flow, end to end inside the server: start (open → secrets → SIGN →
// signed), the return (record → VERIFY with the attempt's own terminal → settle), the jobs and the store-terminal
// admin. The DB caller and the Hyp HTTP client are fakes: no network, no database. Real crypto and env guard.
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
    platformHost: false,
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
  isPlatformHost: vi.fn(async () => h.platformHost),
}));

const STORE_B = "7e2e0000-0000-0000-0000-00000000000b";
const STORE_A = "00000000-0000-0000-0000-000000000001";
const ORDER = "11111111-2222-4333-8444-555555555555";
const ATTEMPT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CUSTOMER = "e2e00000-0000-0000-0000-0000000000c1";
const REFERENCE = "0123456789abcdef0123456789abcdef";
/** declared fake terminal (scripts/security/declared-fakes.json) */
const TERMINAL = "0010090003";
const MOCK_ENDPOINT = "http://127.0.0.1:4010/hyp/p/";
const FAKE_KEY = "fake-key-unit-test";
const FAKE_PASSP = "fake-passp-unit-test";

const saved = { ...process.env };
beforeAll(() => {
  process.env["PAYMENTS_ENV"] = "demo";
  process.env["PLATFORM_ADMIN_HOST"] = "platform.shop.localhost";
  process.env["MAX_PAY_TEST_URL"] = MOCK_ENDPOINT;
  process.env["PAYMENTS_SECRETS_KEY"] = randomBytes(32).toString("hex");
  process.env["PLATFORM_TERMINAL_SECRETS_KEY"] = randomBytes(32).toString("hex");
  delete process.env["PAYMENTS_JOBS"];
});
afterAll(() => {
  for (const name of [
    "PAYMENTS_ENV",
    "PLATFORM_ADMIN_HOST",
    "MAX_PAY_TEST_URL",
    "PAYMENTS_SECRETS_KEY",
    "PLATFORM_TERMINAL_SECRETS_KEY",
    "PAYMENTS_JOBS",
  ]) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

const ok = (data: unknown) => () => ({ data, error: null });
const refused = (message: string) => () => ({ data: null, error: { message, code: "P0001" } });
const callsOf = (fn: string) => h.calls.filter((c) => c.fn === fn);
const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

async function sealedFor(tenantId: string) {
  const { tenantSecretCipher } = await import("@/platform/payments/server/tenant-keys");
  const cipher = tenantSecretCipher("demo", "test");
  const ctx = { tenantId, accountId: tenantId };
  return {
    terminal_number: TERMINAL,
    mode: "test",
    key_id: cipher.kid,
    api_key_enc: cipher.seal("api_key", FAKE_KEY, ctx),
    api_password_enc: cipher.seal("api_password", FAKE_PASSP, ctx),
  };
}

/** a SIGN answer that validateSignResponse accepts for this attempt */
const signBody = (amount = "10.00") =>
  `action=pay&Masof=${TERMINAL}&Amount=${amount}&Coin=1&Order=${REFERENCE}&Sign=True&MoreData=True&hideBtns=True&PageLang=HEB&signature=${"a".repeat(64)}`;

/** a return query as Hyp would send it (fake values) */
const returnQuery = (extra = "") =>
  `Id=123456789012&CCode=0&Amount=10.00&ACode=0012345&Order=${REFERENCE}&Fild1=&Fild2=&Fild3=&Payments=1&Brand=2&L4digit=1234&Coin=1${extra}&Sign=${"b".repeat(64)}`;

beforeEach(() => {
  h.calls.length = 0;
  h.hyp.length = 0;
  h.answers.clear();
  h.platformHost = false;
  h.hypAnswer = () => ({ ok: false, error: "network" });
});

describe("tenant start (open → secrets → SIGN → signed)", () => {
  it("DM-PAY-1 / DM-ENV-7: signs the store's page at the guarded endpoint and returns the pay URL", async () => {
    const { startTenantPayment } = await import("@/platform/payments/server/tenant/checkout");
    h.answers.set(
      "max_attempt_open",
      ok({
        attempt_id: ATTEMPT,
        reference: REFERENCE,
        amount_minor: 1000,
        currency: "ILS",
        terminal_number: TERMINAL,
        mode: "test",
        expires_at: "2026-11-28T12:30:00Z",
        reused: false,
      }),
    );
    h.answers.set("max_attempt_secrets", async () => ({
      data: { result: "ok", ...(await sealedFor(STORE_B)) },
      error: null,
    }));
    h.answers.set("max_attempt_signed", ok({ result: "redirected" }));
    h.hypAnswer = () => ({ ok: true, status: 200, body: signBody(), html: false });
    const loadClient = vi.fn(async () => ({ firstName: "לקוח", lastName: "בדיקה" }));

    const out = await startTenantPayment({
      tenantId: STORE_B,
      orderId: ORDER,
      customerId: CUSTOMER,
      guestToken: null,
      loadClient,
    });

    expect(out).toEqual({ url: `${MOCK_ENDPOINT}?${signBody()}`, demo: true });
    expect(callsOf("max_attempt_open")[0]?.args).toEqual({
      _tenant: STORE_B,
      _order: ORDER,
      _customer: CUSTOMER,
      _guest_token_sha256: null,
      _app_environment: "demo",
    });
    expect(callsOf("max_attempt_secrets")[0]?.args).toEqual({
      _tenant: STORE_B,
      _attempt: ATTEMPT,
      _purpose: "sign",
    });
    expect(h.hyp).toHaveLength(1);
    expect(h.hyp[0]?.endpoint).toBe(MOCK_ENDPOINT);
    const sent = new URLSearchParams(h.hyp[0]?.query);
    expect(sent.get("What")).toBe("SIGN");
    expect(sent.get("Masof")).toBe(TERMINAL);
    expect(sent.get("KEY")).toBe(FAKE_KEY);
    expect(sent.get("Amount")).toBe("10.00");
    expect(sent.get("Order")).toBe(REFERENCE);
    expect(sent.get("ClientName")).toBe("לקוח");
    expect(loadClient).toHaveBeenCalledTimes(1);
    expect(callsOf("max_attempt_signed")[0]?.args).toEqual({
      _tenant: STORE_B,
      _attempt: ATTEMPT,
      _ok: true,
      _code: null,
    });
  });

  it("a guest proves the order with the hash of its token, never the token itself", async () => {
    const { startTenantPayment } = await import("@/platform/payments/server/tenant/checkout");
    const token = randomBytes(32).toString("base64url");
    h.answers.set("max_attempt_open", refused("order not found"));
    await expect(
      startTenantPayment({
        tenantId: STORE_B,
        orderId: ORDER,
        customerId: null,
        guestToken: token,
      }),
    ).rejects.toThrow("ההזמנה לא נמצאה");
    expect(callsOf("max_attempt_open")[0]?.args?.["_guest_token_sha256"]).toBe(sha256(token));
    expect(JSON.stringify(h.calls)).not.toContain(token);
    expect(h.hyp).toHaveLength(0);
  });

  it("a guest without a token is refused before any DB call", async () => {
    const { startTenantPayment } = await import("@/platform/payments/server/tenant/checkout");
    await expect(
      startTenantPayment({ tenantId: STORE_B, orderId: ORDER, customerId: null, guestToken: null }),
    ).rejects.toThrow("ההזמנה לא נמצאה");
    expect(h.calls).toHaveLength(0);
  });

  it("a refused SIGN is recorded with its code and answered with a fixed text (never Hyp's)", async () => {
    const { startTenantPayment } = await import("@/platform/payments/server/tenant/checkout");
    h.answers.set(
      "max_attempt_open",
      ok({
        attempt_id: ATTEMPT,
        reference: REFERENCE,
        amount_minor: 1000,
        terminal_number: TERMINAL,
        mode: "test",
      }),
    );
    h.answers.set("max_attempt_secrets", async () => ({
      data: { result: "ok", ...(await sealedFor(STORE_B)) },
      error: null,
    }));
    h.answers.set("max_attempt_signed", ok({ result: "failed" }));
    h.hypAnswer = () => ({ ok: true, status: 200, body: "CCode=902&errMsg=Hyp+text", html: false });
    await expect(
      startTenantPayment({
        tenantId: STORE_B,
        orderId: ORDER,
        customerId: CUSTOMER,
        guestToken: null,
      }),
    ).rejects.toThrow("לא ניתן לפתוח את דף התשלום כרגע. אפשר לנסות שוב בעוד כמה דקות.");
    expect(callsOf("max_attempt_signed")[0]?.args).toMatchObject({ _ok: false, _code: "902" });
  });

  it("DM-ENV-4: another store's sealed credentials do not open — no SIGN, a payer sees 'unavailable'", async () => {
    const { startTenantPayment } = await import("@/platform/payments/server/tenant/checkout");
    h.answers.set(
      "max_attempt_open",
      ok({
        attempt_id: ATTEMPT,
        reference: REFERENCE,
        amount_minor: 1000,
        terminal_number: TERMINAL,
        mode: "test",
      }),
    );
    h.answers.set("max_attempt_secrets", async () => ({
      data: { result: "ok", ...(await sealedFor(STORE_A)) },
      error: null,
    }));
    await expect(
      startTenantPayment({
        tenantId: STORE_B,
        orderId: ORDER,
        customerId: CUSTOMER,
        guestToken: null,
      }),
    ).rejects.toThrow("התשלום המקוון אינו זמין כרגע");
    expect(h.hyp).toHaveLength(0);
  });

  it("DM-ENV-1: payments off (no PAYMENTS_ENV) → no DB call, no Hyp call", async () => {
    const { startTenantPayment, tenantPaymentOptions } =
      await import("@/platform/payments/server/tenant/checkout");
    process.env["PAYMENTS_ENV"] = "";
    try {
      await expect(
        startTenantPayment({
          tenantId: STORE_B,
          orderId: ORDER,
          customerId: CUSTOMER,
          guestToken: null,
        }),
      ).rejects.toThrow("התשלום המקוון אינו זמין כרגע");
      expect(await tenantPaymentOptions(STORE_B, null)).toEqual({ available: false, demo: false });
      expect(h.calls).toHaveLength(0);
      expect(h.hyp).toHaveLength(0);
    } finally {
      process.env["PAYMENTS_ENV"] = "demo";
    }
  });

  it("L8: SIGN tripwires — another terminal than the attempt's, a live mode or a non-test terminal in DEMO → no SIGN", async () => {
    const { startTenantPayment } = await import("@/platform/payments/server/tenant/checkout");
    const alert = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const variants: Record<string, string>[] = [
        { open: "0010090002", row: TERMINAL, mode: "test" },
        { open: TERMINAL, row: TERMINAL, mode: "live" },
        { open: "1234567890", row: "1234567890", mode: "test" },
      ];
      for (const v of variants) {
        h.calls.length = 0;
        h.hyp.length = 0;
        h.answers.set(
          "max_attempt_open",
          ok({
            attempt_id: ATTEMPT,
            reference: REFERENCE,
            amount_minor: 1000,
            terminal_number: v["open"],
            mode: "test",
          }),
        );
        h.answers.set("max_attempt_secrets", async () => ({
          data: {
            result: "ok",
            ...(await sealedFor(STORE_B)),
            terminal_number: v["row"],
            mode: v["mode"],
          },
          error: null,
        }));
        h.answers.set("max_attempt_signed", ok({ result: "failed" }));
        h.hypAnswer = () => ({ ok: true, status: 200, body: signBody(), html: false });
        await expect(
          startTenantPayment({
            tenantId: STORE_B,
            orderId: ORDER,
            customerId: CUSTOMER,
            guestToken: null,
          }),
          JSON.stringify(v),
        ).rejects.toThrow("התשלום המקוון אינו זמין כרגע");
        expect(h.hyp, JSON.stringify(v)).toHaveLength(0);
        // a live-mode row does not even open with the test cipher; the other two are recorded as a failed SIGN
        if (v["mode"] === "test")
          expect(callsOf("max_attempt_signed")[0]?.args, JSON.stringify(v)).toMatchObject({
            _ok: false,
            _code: null,
          });
      }
      expect(
        alert.mock.calls.some((c) => String(c[0]).includes("ALERT terminal_not_allowed")),
      ).toBe(true);
    } finally {
      alert.mockRestore();
    }
  });
});

describe("tenant return (record → VERIFY → settle)", () => {
  const received = (state = "returned", result = "received") =>
    ok({
      result,
      attempt_id: ATTEMPT,
      tenant_id: STORE_B,
      order_id: ORDER,
      state,
      terminal_number: TERMINAL,
      mode: "test",
    });

  async function verifiable() {
    h.answers.set("max_return_keep", ok(true));
    h.answers.set("max_attempt_secrets", async () => ({
      data: { result: "ok", ...(await sealedFor(STORE_B)) },
      error: null,
    }));
    h.answers.set("platform_payment_returns_purge", ok(1));
  }

  it("DM-SEP-4: the platform host is refused before any DB call or VERIFY", async () => {
    const { handleTenantReturn } = await import("@/platform/payments/server/tenant/return");
    h.platformHost = true;
    const out = await handleTenantReturn({
      provider: "max",
      raw: returnQuery(),
      hostTenantId: STORE_A,
      host: "platform.shop.localhost",
    });
    expect(out.refused).toBe(true);
    expect(h.calls).toHaveLength(0);
    expect(h.hyp).toHaveLength(0);
  });

  it("DM-PAY-3: a return naming a reserved key is refused without any DB write", async () => {
    const { handleTenantReturn } = await import("@/platform/payments/server/tenant/return");
    const out = await handleTenantReturn({
      provider: "max",
      raw: `${returnQuery()}&KEY=fake-injected`,
      hostTenantId: STORE_B,
      host: "store-b.shop.localhost",
    });
    expect(out.location).toBe("/checkout/pay/unknown");
    expect(h.calls).toHaveLength(0);
  });

  it("DM-PAY-10 / DM-SEP-5: an unknown reference (another store, the platform) is counted, never verified", async () => {
    const { handleTenantReturn } = await import("@/platform/payments/server/tenant/return");
    h.answers.set("max_attempt_record_return", ok({ result: "unknown" }));
    h.answers.set("platform_payment_unknown_return", ok(true));
    const out = await handleTenantReturn({
      provider: "max",
      raw: returnQuery(),
      hostTenantId: STORE_B,
      host: "store-b.shop.localhost",
    });
    expect(out).toMatchObject({ location: "/checkout/pay/unknown", paid: null, review: null });
    expect(callsOf("platform_payment_unknown_return")[0]?.args).toEqual({
      _scope: "tenant",
      _host: "store-b.shop.localhost",
      _payload_sha256: sha256(returnQuery()),
    });
    expect(callsOf("max_attempt_secrets")).toHaveLength(0);
    expect(h.hyp).toHaveLength(0);
  });

  it("records for the HOST's store, keeps the raw return sealed, VERIFYs with the attempt's terminal, settles", async () => {
    const { handleTenantReturn } = await import("@/platform/payments/server/tenant/return");
    h.answers.set("max_attempt_record_return", received());
    await verifiable();
    h.answers.set(
      "max_attempt_mark_paid",
      ok({
        result: "test_paid",
        applied: true,
        mode: "test",
        attempt_id: ATTEMPT,
        order_id: ORDER,
      }),
    );
    h.hypAnswer = () => ({ ok: true, status: 200, body: "CCode=0\r\n", html: false });
    const raw = returnQuery();

    const out = await handleTenantReturn({
      provider: "max",
      raw,
      hostTenantId: STORE_B,
      host: "store-b.shop.localhost",
    });

    expect(out).toEqual({
      location: `/checkout/pay/${ORDER}?r=1`,
      refused: false,
      paid: { tenantId: STORE_B, orderId: ORDER },
      review: null,
    });
    expect(callsOf("max_attempt_record_return")[0]?.args).toEqual({
      _host_tenant: STORE_B,
      _reference: REFERENCE,
      _payload_sha256: sha256(raw),
      _ccode: "0",
      _txn_id: "123456789012",
      _amount_minor: 1000,
      _installments: 1,
    });
    // the raw return is kept sealed, bound to this store and attempt
    const kept = callsOf("max_return_keep")[0]?.args;
    expect(String(kept?.["_return_enc"])).toMatch(/^v1:/);
    expect(String(kept?.["_return_enc"])).not.toContain(REFERENCE);
    const { tenantSecretCipher } = await import("@/platform/payments/server/tenant-keys");
    expect(
      tenantSecretCipher("demo", "test").open("raw_return", String(kept?.["_return_enc"]), {
        tenantId: STORE_B,
        accountId: ATTEMPT,
      }),
    ).toBe(raw);
    // VERIFY: the attempt's own credentials, then the raw return unchanged and in its order
    expect(callsOf("max_attempt_secrets")[0]?.args).toMatchObject({ _purpose: "verify" });
    expect(h.hyp[0]?.query.startsWith(`action=APISign&What=VERIFY&Masof=${TERMINAL}&KEY=`)).toBe(
      true,
    );
    expect(h.hyp[0]?.query.endsWith(`&${raw}`)).toBe(true);
    expect(callsOf("max_attempt_mark_paid")[0]?.args).toEqual({
      _tenant: STORE_B,
      _reference: REFERENCE,
      _payload_sha256: sha256(raw),
      _verify_ccode: "0",
      _ccode: "0",
      _terminal: TERMINAL,
      _txn_id: "123456789012",
      _amount_minor: 1000,
      _currency: "ILS",
      _installments: 1,
      _approval_code: "0012345",
      _card_brand: "2",
      _card_last4: "1234",
      _return_flags: [],
      _app_environment: "demo",
    });
    expect(callsOf("platform_payment_returns_purge")).toHaveLength(1);
  });

  it("DM-PAY-7 / DM-PAY-6: Hesh, HKId and MULTI reach the settle as flags; a review is reported for the bell", async () => {
    const { handleTenantReturn } = await import("@/platform/payments/server/tenant/return");
    h.answers.set("max_attempt_record_return", received());
    await verifiable();
    h.answers.set(
      "max_attempt_mark_paid",
      ok({ result: "needs_review", reason: "document_issued", order_id: ORDER }),
    );
    h.hypAnswer = () => ({ ok: true, status: 200, body: "CCode=0", html: false });
    const out = await handleTenantReturn({
      provider: "max",
      raw: returnQuery("&Hesh=4711&HKId=9&MULTI=1"),
      hostTenantId: STORE_B,
      host: "store-b.shop.localhost",
    });
    expect(callsOf("max_attempt_mark_paid")[0]?.args?.["_return_flags"]).toEqual([
      "document",
      "hk",
      "multi",
    ]);
    expect(out.paid).toBeNull();
    expect(out.review).toEqual({ tenantId: STORE_B, orderId: ORDER, reason: "document_issued" });
  });

  it("M08: a payment that is already concluded is never verified again (refresh, replay)", async () => {
    const { handleTenantReturn } = await import("@/platform/payments/server/tenant/return");
    for (const state of ["test_paid", "paid", "failed", "needs_review"]) {
      h.calls.length = 0;
      h.answers.set("max_attempt_record_return", received(state, "replay"));
      const out = await handleTenantReturn({
        provider: "max",
        raw: returnQuery(),
        hostTenantId: STORE_B,
        host: "store-b.shop.localhost",
      });
      expect(out.location, state).toBe(`/checkout/pay/${ORDER}?r=1`);
      expect(out.paid, state).toBeNull();
      expect(callsOf("max_attempt_secrets"), state).toHaveLength(0);
      expect(callsOf("max_attempt_mark_paid"), state).toHaveLength(0);
    }
    expect(h.hyp).toHaveLength(0);
  });

  it("M06: a DIFFERENT return for a concluded attempt is verified with its own terminal and settled (duplicate → review)", async () => {
    const { handleTenantReturn } = await import("@/platform/payments/server/tenant/return");
    for (const state of ["test_paid", "paid", "needs_review", "failed"]) {
      h.calls.length = 0;
      h.hyp.length = 0;
      h.answers.set("max_attempt_record_return", received(state, "received"));
      await verifiable();
      h.answers.set(
        "max_attempt_mark_paid",
        ok({
          result: "duplicate_charge",
          attempt_id: ATTEMPT,
          order_id: ORDER,
          tenant_id: STORE_B,
        }),
      );
      h.hypAnswer = () => ({ ok: true, status: 200, body: "CCode=0", html: false });
      const out = await handleTenantReturn({
        provider: "max",
        raw: returnQuery("&Fild4=second"),
        hostTenantId: STORE_B,
        host: "store-b.shop.localhost",
      });
      expect(callsOf("max_attempt_secrets")[0]?.args, state).toMatchObject({
        _tenant: STORE_B,
        _attempt: ATTEMPT,
        _purpose: "verify",
      });
      expect(h.hyp, state).toHaveLength(1);
      expect(callsOf("max_attempt_mark_paid"), state).toHaveLength(1);
      expect(out.paid, state).toBeNull();
      expect(out.review, state).toEqual({
        tenantId: STORE_B,
        orderId: ORDER,
        reason: "duplicate_charge",
      });
    }
  });

  it("a return without a non-empty Sign is refused before any DB write or VERIFY", async () => {
    const { handleTenantReturn } = await import("@/platform/payments/server/tenant/return");
    const unsigned = returnQuery().replace(/&Sign=[^&]*$/, "");
    const empty = returnQuery().replace(/&Sign=[^&]*$/, "&Sign=");
    const otherCase = returnQuery().replace(/&Sign=/, "&sign=");
    for (const raw of [unsigned, empty, otherCase]) {
      const out = await handleTenantReturn({
        provider: "max",
        raw,
        hostTenantId: STORE_B,
        host: "store-b.shop.localhost",
      });
      expect(out.location, raw.slice(-20)).toBe("/checkout/pay/unknown");
    }
    expect(h.calls).toHaveLength(0);
    expect(h.hyp).toHaveLength(0);
    // the same rule as the protocol helper (X-11): the signed fixture passes it, the three variants do not
    const { parseReturnQuery, returnHasSignature } =
      await import("@/platform/payments/max/protocol");
    const signedOk = (raw: string) => {
      const parsed = parseReturnQuery(raw);
      return parsed.ok && returnHasSignature(parsed);
    };
    expect(signedOk(returnQuery())).toBe(true);
    expect([unsigned, empty, otherCase].map(signedOk)).toEqual([false, false, false]);
  });

  it("a replay of a return that was not verified yet is verified (the browser can retry), without keeping it twice", async () => {
    const { handleTenantReturn } = await import("@/platform/payments/server/tenant/return");
    h.answers.set("max_attempt_record_return", received("returned", "replay"));
    await verifiable();
    h.answers.set(
      "max_attempt_mark_paid",
      ok({ result: "test_paid", applied: true, order_id: ORDER }),
    );
    h.hypAnswer = () => ({ ok: true, status: 200, body: "CCode=0", html: false });
    const out = await handleTenantReturn({
      provider: "max",
      raw: returnQuery(),
      hostTenantId: STORE_B,
      host: "store-b.shop.localhost",
    });
    expect(out.paid).toEqual({ tenantId: STORE_B, orderId: ORDER });
    expect(callsOf("max_return_keep")).toHaveLength(0);
  });

  it("DM-PAY-4: a timeout reaches the DB as 'not verified' (null), never as 0; a busy lease skips VERIFY", async () => {
    const { handleTenantReturn } = await import("@/platform/payments/server/tenant/return");
    h.answers.set("max_attempt_record_return", received());
    await verifiable();
    h.answers.set("max_attempt_mark_paid", ok({ result: "unverified" }));
    h.hypAnswer = () => ({ ok: false, error: "timeout" });
    const out = await handleTenantReturn({
      provider: "max",
      raw: returnQuery(),
      hostTenantId: STORE_B,
      host: "store-b.shop.localhost",
    });
    expect(callsOf("max_attempt_mark_paid")[0]?.args?.["_verify_ccode"]).toBeNull();
    expect(out).toMatchObject({ paid: null, review: null, location: `/checkout/pay/${ORDER}?r=1` });

    h.calls.length = 0;
    h.hyp.length = 0;
    h.answers.set("max_attempt_secrets", ok({ result: "busy", retry_after_seconds: 30 }));
    await handleTenantReturn({
      provider: "max",
      raw: returnQuery(),
      hostTenantId: STORE_B,
      host: "store-b.shop.localhost",
    });
    expect(h.hyp).toHaveLength(0);
    expect(callsOf("max_attempt_mark_paid")).toHaveLength(0);
  });

  it("DM-PAY-4 (X-2): only an answer that is exactly CCode=0 is passed on as verified", async () => {
    const { verifyCodeOf } = await import("@/platform/payments/server/tenant/return");
    const answer = (body: string, html = false) => ({ ok: true as const, status: 200, body, html });
    expect(verifyCodeOf(answer("CCode=0"))).toBe("0");
    expect(verifyCodeOf(answer("CCode=0\n"))).toBe("0");
    expect(verifyCodeOf(answer("CCode=0&Extra=1"))).toBeNull();
    expect(verifyCodeOf(answer("CCode=00"))).toBe("00");
    expect(verifyCodeOf(answer("CCode= 0"))).toBeNull();
    expect(verifyCodeOf(answer("CCode=902"))).toBe("902");
    expect(verifyCodeOf(answer("<html>CCode=0</html>", true))).toBeNull();
    expect(verifyCodeOf({ ok: false, error: "timeout" })).toBeNull();
    expect(verifyCodeOf({ ok: false, error: "too_large" })).toBeNull();
  });

  /** the scope's ALERT lines written during fn (console.error) */
  async function alertsDuring(fn: () => Promise<unknown>): Promise<string[]> {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await fn();
      return spy.mock.calls.map((c) => String(c[0])).filter((line) => line.includes("ALERT"));
    } finally {
      spy.mockRestore();
      warn.mockRestore();
    }
  }
  const storeReturn = async () => {
    const { handleTenantReturn } = await import("@/platform/payments/server/tenant/return");
    return handleTenantReturn({
      provider: "max",
      raw: returnQuery(),
      hostTenantId: STORE_B,
      host: "store-b.shop.localhost",
    });
  };

  it("R-T1 / M2: VERIFY exhausted (the DB parked the attempt) → a review item for the store's bell + an ALERT line", async () => {
    h.answers.set("max_attempt_record_return", received());
    await verifiable();
    h.answers.set("max_attempt_secrets", ok({ result: "exhausted" }));
    let out: Awaited<ReturnType<typeof storeReturn>> | undefined;
    const alerts = await alertsDuring(async () => (out = await storeReturn()));
    expect(out?.review).toEqual({ tenantId: STORE_B, orderId: ORDER, reason: "verify_exhausted" });
    expect(alerts.some((line) => line.includes("ALERT verify_exhausted"))).toBe(true);
    expect(h.hyp).toHaveLength(0);
    expect(callsOf("max_attempt_mark_paid")).toHaveLength(0);
  });

  it("M2: the settle answering exhausted / verify_exhausted is a review item too", async () => {
    for (const result of ["exhausted", "verify_exhausted"]) {
      h.answers.set("max_attempt_record_return", received());
      await verifiable();
      h.answers.set("max_attempt_mark_paid", ok({ result, order_id: ORDER }));
      h.hypAnswer = () => ({ ok: false, error: "timeout" });
      let out: Awaited<ReturnType<typeof storeReturn>> | undefined;
      const alerts = await alertsDuring(async () => (out = await storeReturn()));
      expect(out?.review, result).toEqual({
        tenantId: STORE_B,
        orderId: ORDER,
        reason: "verify_exhausted",
      });
      expect(alerts.length, result).toBeGreaterThan(0);
    }
  });

  it("R-T2 / M1: VERIFY credentials refused (terminal changed / no longer configured) → review + ALERT, no VERIFY", async () => {
    h.answers.set("max_attempt_record_return", received());
    await verifiable();
    h.answers.set("max_attempt_secrets", () => ({
      data: null,
      error: {
        message: "online payment: the terminal of this attempt is no longer configured",
        code: "23514",
      },
    }));
    let out: Awaited<ReturnType<typeof storeReturn>> | undefined;
    const alerts = await alertsDuring(async () => (out = await storeReturn()));
    expect(h.hyp).toHaveLength(0);
    expect(out?.review).toEqual({
      tenantId: STORE_B,
      orderId: ORDER,
      reason: "credentials_changed",
    });
    expect(alerts.some((line) => line.includes("ALERT verify_credentials_refused"))).toBe(true);
  });

  it("M1: an unknown secrets answer, credentials that do not open and the VERIFY tripwires are refusals too", async () => {
    const cases: [string, () => Promise<unknown> | unknown, string][] = [
      ["unknown result", ok({ result: "credentials_changed" }), "credentials_changed"],
      [
        "another store's tokens",
        async () => ({ data: { result: "ok", ...(await sealedFor(STORE_A)) }, error: null }),
        "credentials_changed",
      ],
      [
        "another terminal than the recorded one",
        async () => ({
          data: { result: "ok", ...(await sealedFor(STORE_B)), terminal_number: "0010090002" },
          error: null,
        }),
        "credentials_changed",
      ],
      [
        "live mode in DEMO",
        async () => ({
          data: { result: "ok", ...(await sealedFor(STORE_B)), mode: "live" },
          error: null,
        }),
        "mode_not_allowed",
      ],
    ];
    for (const [name, answer, reason] of cases) {
      h.calls.length = 0;
      h.hyp.length = 0;
      h.answers.set("max_attempt_record_return", received());
      await verifiable();
      h.answers.set("max_attempt_secrets", answer as never);
      let out: Awaited<ReturnType<typeof storeReturn>> | undefined;
      const alerts = await alertsDuring(async () => (out = await storeReturn()));
      expect(h.hyp, name).toHaveLength(0);
      expect(out?.review, name).toEqual({ tenantId: STORE_B, orderId: ORDER, reason });
      expect(alerts.length, name).toBeGreaterThan(0);
    }
  });

  it("M1: a DB that cannot be reached is not a refusal — no review, an error line, the kept return stays for the job", async () => {
    h.answers.set("max_attempt_record_return", received());
    await verifiable();
    h.answers.set("max_attempt_secrets", () => ({
      data: null,
      error: { message: "payments: database unavailable", code: null },
    }));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let out: Awaited<ReturnType<typeof storeReturn>> | undefined;
    try {
      out = await storeReturn();
      expect(
        errors.mock.calls.some((c) => String(c[0]).includes("verify_credentials_unavailable")),
      ).toBe(true);
      expect(errors.mock.calls.some((c) => String(c[0]).includes("ALERT"))).toBe(false);
    } finally {
      errors.mockRestore();
    }
    expect(out?.review).toBeNull();
    expect(callsOf("max_return_keep")).toHaveLength(1);
    expect(h.hyp).toHaveLength(0);
  });

  it("L6: a return while payments are off is recorded, cannot be kept or verified → review item + ALERT", async () => {
    h.answers.set("max_attempt_record_return", received());
    await verifiable();
    process.env["PAYMENTS_SECRETS_KEY"] = "";
    let out: Awaited<ReturnType<typeof storeReturn>> | undefined;
    let alerts: string[] = [];
    try {
      alerts = await alertsDuring(async () => (out = await storeReturn()));
    } finally {
      process.env["PAYMENTS_SECRETS_KEY"] = randomBytes(32).toString("hex");
    }
    expect(callsOf("max_attempt_record_return")).toHaveLength(1);
    expect(callsOf("max_return_keep")).toHaveLength(0);
    expect(callsOf("max_attempt_secrets")).toHaveLength(0);
    expect(h.hyp).toHaveLength(0);
    expect(out?.review).toEqual({ tenantId: STORE_B, orderId: ORDER, reason: "payments_off" });
    expect(alerts.some((line) => line.includes("ALERT return_not_verified"))).toBe(true);
  });

  it("a return that is neither settled nor kept (the DB refused to keep it) → an ALERT line", async () => {
    h.answers.set("max_attempt_record_return", received());
    await verifiable();
    h.answers.set("max_return_keep", ok(false));
    h.answers.set("max_attempt_mark_paid", ok({ result: "unverified" }));
    h.hypAnswer = () => ({ ok: false, error: "timeout" });
    const alerts = await alertsDuring(storeReturn);
    expect(alerts.some((line) => line.includes("ALERT return_not_retryable"))).toBe(true);

    // kept → the job retries it: no such line
    h.answers.set("max_return_keep", ok(true));
    expect(
      (await alertsDuring(storeReturn)).some((line) => line.includes("return_not_retryable")),
    ).toBe(false);
  });
});

describe("tenant jobs", () => {
  it("PAYMENTS_JOBS=off: nothing runs", async () => {
    const { runTenantPaymentJobs } = await import("@/platform/payments/server/tenant/jobs");
    process.env["PAYMENTS_JOBS"] = "off";
    try {
      expect(await runTenantPaymentJobs()).toEqual({ paid: [], review: [] });
      expect(h.calls).toHaveLength(0);
    } finally {
      delete process.env["PAYMENTS_JOBS"];
    }
  });

  it("re-VERIFYs a kept return, then expires attempts and purges raw returns", async () => {
    const { runTenantPaymentJobs } = await import("@/platform/payments/server/tenant/jobs");
    const { tenantSecretCipher } = await import("@/platform/payments/server/tenant-keys");
    const raw = returnQuery();
    const sealed = tenantSecretCipher("demo", "test").seal("raw_return", raw, {
      tenantId: STORE_B,
      accountId: ATTEMPT,
    });
    h.answers.set(
      "max_attempts_pending_verify",
      ok([
        {
          attempt_id: ATTEMPT,
          tenant_id: STORE_B,
          reference: REFERENCE,
          payload_sha256: sha256(raw),
          mode: "test",
        },
      ]),
    );
    h.answers.set("max_return_get", ok(sealed));
    h.answers.set("max_attempt_secrets", async () => ({
      data: { result: "ok", ...(await sealedFor(STORE_B)) },
      error: null,
    }));
    h.answers.set(
      "max_attempt_mark_paid",
      ok({ result: "test_paid", applied: true, order_id: ORDER }),
    );
    h.answers.set("max_attempts_expire", ok(2));
    h.answers.set("platform_payment_returns_purge", ok(1));
    h.hypAnswer = () => ({ ok: true, status: 200, body: "CCode=0", html: false });

    expect(await runTenantPaymentJobs()).toEqual({
      paid: [{ tenantId: STORE_B, orderId: ORDER }],
      review: [],
    });
    expect(h.calls.map((c) => c.fn)).toEqual([
      "max_attempts_pending_verify",
      "max_return_get",
      "max_attempt_secrets",
      "max_attempt_mark_paid",
      "max_attempts_expire",
      "platform_payment_returns_purge",
    ]);
    expect(h.hyp[0]?.query.endsWith(`&${raw}`)).toBe(true);
  });

  it("a kept return that does not match its record is not verified", async () => {
    const { runTenantPaymentJobs } = await import("@/platform/payments/server/tenant/jobs");
    const { tenantSecretCipher } = await import("@/platform/payments/server/tenant-keys");
    const sealed = tenantSecretCipher("demo", "test").seal("raw_return", returnQuery(), {
      tenantId: STORE_B,
      accountId: ATTEMPT,
    });
    h.answers.set(
      "max_attempts_pending_verify",
      ok([
        {
          attempt_id: ATTEMPT,
          tenant_id: STORE_B,
          reference: REFERENCE,
          payload_sha256: "0".repeat(64),
          mode: "test",
        },
      ]),
    );
    h.answers.set("max_return_get", ok(sealed));
    h.answers.set("max_attempts_expire", ok(0));
    h.answers.set("platform_payment_returns_purge", ok(0));
    expect(await runTenantPaymentJobs()).toEqual({ paid: [], review: [] });
    expect(h.hyp).toHaveLength(0);
    expect(callsOf("max_attempt_mark_paid")).toHaveLength(0);
  });

  it("R-T3 / M2: the job's re-VERIFY hitting 'exhausted' or refused credentials reports a review item", async () => {
    const { runTenantPaymentJobs } = await import("@/platform/payments/server/tenant/jobs");
    const { reverifyTenantReturn } = await import("@/platform/payments/server/tenant/return");
    const { tenantSecretCipher } = await import("@/platform/payments/server/tenant-keys");
    const raw = returnQuery();
    const sealed = tenantSecretCipher("demo", "test").seal("raw_return", raw, {
      tenantId: STORE_B,
      accountId: ATTEMPT,
    });
    const item = {
      tenantId: STORE_B,
      attemptId: ATTEMPT,
      reference: REFERENCE,
      payloadSha256: sha256(raw),
      mode: "test" as const,
    };
    h.answers.set("max_return_get", ok(sealed));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      h.answers.set("max_attempt_secrets", ok({ result: "exhausted" }));
      expect((await reverifyTenantReturn(item))?.review).toEqual({
        tenantId: STORE_B,
        orderId: null,
        reason: "verify_exhausted",
      });
      h.answers.set(
        "max_attempt_secrets",
        refused("online payment: the terminal of this attempt is no longer configured"),
      );
      expect((await reverifyTenantReturn(item))?.review?.reason).toBe("credentials_changed");

      h.answers.set(
        "max_attempts_pending_verify",
        ok([
          {
            attempt_id: ATTEMPT,
            tenant_id: STORE_B,
            reference: REFERENCE,
            payload_sha256: sha256(raw),
            mode: "test",
          },
        ]),
      );
      h.answers.set("max_attempt_secrets", ok({ result: "exhausted" }));
      h.answers.set("max_attempts_expire", ok(0));
      h.answers.set("platform_payment_returns_purge", ok(0));
      expect(await runTenantPaymentJobs()).toEqual({
        paid: [],
        review: [{ tenantId: STORE_B, orderId: null, reason: "verify_exhausted" }],
      });
    } finally {
      errors.mockRestore();
    }
    expect(h.hyp).toHaveLength(0);
  });
});

describe("store terminal admin (platform admin)", () => {
  const ADMIN = "e2e00000-0000-0000-0000-0000000000f0";

  it("seals KEY / PassP bound to the store, sends key_id, never the plain values", async () => {
    const { saveStoreTerminal } = await import("@/platform/payments/server/tenant/admin");
    h.answers.set(
      "platform_store_terminal_save",
      ok({ configured: true, status: "unverified", terminal_hint: "03", has_api_key: true }),
    );
    const view = await saveStoreTerminal(ADMIN, STORE_B, {
      terminalNumber: TERMINAL,
      apiKey: FAKE_KEY,
      apiPassword: FAKE_PASSP,
      enabled: true,
    });
    expect(view).toMatchObject({ configured: true, terminalHint: "03", demo: true });
    const args = callsOf("platform_store_terminal_save")[0]?.args;
    expect(args?.["_app_environment"]).toBe("demo");
    const patch = args?.["_patch"] as Record<string, unknown>;
    expect(JSON.stringify(patch)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(patch)).not.toContain(FAKE_PASSP);
    const { tenantSecretCipher } = await import("@/platform/payments/server/tenant-keys");
    const cipher = tenantSecretCipher("demo", "test");
    expect(patch).toMatchObject({
      mode: "test",
      terminal_number: TERMINAL,
      enabled: true,
      key_id: cipher.kid,
      terminal_max_installments: 1,
    });
    const ctx = { tenantId: STORE_B, accountId: STORE_B };
    expect(cipher.open("api_key", String(patch["api_key_enc"]), ctx)).toBe(FAKE_KEY);
    expect(cipher.open("api_password", String(patch["api_password_enc"]), ctx)).toBe(FAKE_PASSP);
    // bound to this store: another store's context cannot open it (DM-ENV-4)
    expect(() =>
      cipher.open("api_key", String(patch["api_key_enc"]), {
        tenantId: STORE_A,
        accountId: STORE_A,
      }),
    ).toThrow();
  });

  it("DM-ENV-3: in DEMO a terminal without the 00100 test prefix is refused before the DB", async () => {
    const { saveStoreTerminal } = await import("@/platform/payments/server/tenant/admin");
    await expect(
      saveStoreTerminal(ADMIN, STORE_B, { terminalNumber: "1234567890" }),
    ).rejects.toThrow("מספר המסוף לא מתאים לסביבה");
    expect(h.calls).toHaveLength(0);
  });

  it("the connection check signs a ₪1 page (nothing charged) and records the result", async () => {
    const { testStoreTerminal } = await import("@/platform/payments/server/tenant/admin");
    h.answers.set("platform_store_terminal_check_secrets", async () => ({
      data: await sealedFor(STORE_B),
      error: null,
    }));
    h.answers.set("platform_store_terminal_verified", ok({ configured: true, status: "verified" }));
    h.hypAnswer = (query) => {
      const order = new URLSearchParams(query).get("Order") ?? "";
      return {
        ok: true,
        status: 200,
        body: signBody("1.00").replace(REFERENCE, order),
        html: false,
      };
    };
    expect(await testStoreTerminal(ADMIN, STORE_B)).toEqual({ ok: true, code: "0" });
    expect(new URLSearchParams(h.hyp[0]?.query).get("Amount")).toBe("1.00");
    expect(callsOf("platform_store_terminal_verified")[0]?.args).toEqual({
      _actor: ADMIN,
      _tenant: STORE_B,
      _ok: true,
      _code: "0",
    });
  });
});

describe("browser-facing errors", () => {
  it("only fixed Hebrew texts reach a browser", async () => {
    const { paymentFnError } = await import("@/lib/online-payments.server");
    const { TenantPaymentError } = await import("@/platform/payments/server/tenant/db");
    expect(paymentFnError(new TenantPaymentError("ההזמנה לא נמצאה")).message).toBe(
      "ההזמנה לא נמצאה",
    );
    expect(
      paymentFnError(new Error("duplicate key value violates unique constraint")).message,
    ).toBe("הפעולה נכשלה. אפשר לנסות שוב.");
    expect(paymentFnError("x").message).toBe("הפעולה נכשלה. אפשר לנסות שוב.");
  });
});
