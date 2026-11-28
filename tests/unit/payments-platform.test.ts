// MAX/Hyp DEMO — D5, the PLATFORM payment flow (a store owner pays NURIEL an open charge on NURIEL's terminal):
// the orchestrators under src/platform/payments/server/platform/ with injected fakes — a fake DB caller, a fake
// Hyp (built from the protocol module itself), a fake cipher and a fake step-up service. No network, no DB, no
// Docker. Every value is an obvious fake (declared fake terminal numbers, placeholder credentials).
import { describe, expect, it, vi } from "vitest";
import type { HypHttpResult } from "@/platform/payments/server/http";
import type { PaymentMode } from "@/platform/payments/provider";
import { buildVerifyQuery, encodeParams, parseReturnQuery } from "@/platform/payments/max/protocol";
import {
  PlatformPaymentError,
  dbFailure,
  type PlatformRpc,
} from "@/platform/payments/server/platform/db";
import { platformLine, type PlatformLogger } from "@/platform/payments/server/platform/log";
import type {
  PlatformCipher,
  TerminalSecrets,
} from "@/platform/payments/server/platform/credentials";
import {
  platformAttemptCredentials,
  platformTerminalCheckCredentials,
} from "@/platform/payments/server/platform/credentials";
import {
  myPlatformPayments,
  platformPayOptions,
  startPlatformPayment,
  storeOriginOf,
  type PayDeps,
} from "@/platform/payments/server/platform/pay";
import {
  handlePlatformReturn,
  returnLocation,
  reverifyPlatformReturn,
  sha256Hex,
  verifyCodeForDb,
  type PlatformReturnDeps,
} from "@/platform/payments/server/platform/return";
import { runPlatformPaymentJobs } from "@/platform/payments/server/platform/jobs";
import {
  intentOf,
  platformCardPaymentsList,
  platformTerminalStatus,
  platformUnreturnedList,
  requestTerminalSaveCode,
  resolvePlatformCardPayment,
  savePlatformTerminal,
  testPlatformTerminal,
  type TerminalDeps,
} from "@/platform/payments/server/platform/terminal";
import { alertPlatformAdmins } from "@/platform/payments/server/platform/alerts";

// ------------------------------------------------------------------------------------------ fixtures

const ACTOR = "11111111-1111-4111-8111-111111111111";
const STORE = "22222222-2222-4222-8222-222222222222";
const CHARGE = "33333333-3333-4333-8333-333333333333";
const ATTEMPT = "44444444-4444-4444-8444-444444444444";
const CHALLENGE = "55555555-5555-4555-8555-555555555555";
const REFERENCE = "0123456789abcdef0123456789abcdef";
const TERMINAL = "0010090001"; // declared fake (scripts/security/declared-fakes.json)
const FAKE_KEY = "FAKE_KEY_platform";
const FAKE_PASSWORD = "FAKE_PASSWORD_platform";
const ENDPOINT = "http://127.0.0.1:9/hyp/p/";
const ORIGIN = "https://store-a.shop.example.invalid";
const SIGNATURE = "ab".repeat(32);

type Call = { fn: string; args: Record<string, unknown> };
type Answer = { data?: unknown; error?: { message: string; code: string | null } };

function fakeRpc(handlers: Record<string, (args: Record<string, unknown>) => Answer>) {
  const calls: Call[] = [];
  const rpc: PlatformRpc = async (fn, args) => {
    calls.push({ fn, args });
    const handler = handlers[fn];
    if (!handler) return { data: null, error: { message: `no fake for ${fn}`, code: null } };
    const answer = handler(args);
    return { data: answer.data ?? null, error: answer.error ?? null };
  };
  return {
    rpc,
    calls,
    names: () => calls.map((c) => c.fn),
    args: (fn: string) => calls.find((c) => c.fn === fn)?.args,
  };
}

function fakeLog() {
  const lines: string[] = [];
  const log: PlatformLogger = {
    info: (event, fields) => void lines.push(platformLine(event, fields)),
    warn: (event, fields) => void lines.push(platformLine(event, fields)),
    error: (event, fields) => void lines.push(platformLine(event, fields)),
    alert: (event, fields) => void lines.push(platformLine(event, fields, true)),
  };
  return { log, lines };
}

/** a reversible fake cipher that records the AAD parts it is given (env, mode, accountId, field) */
const fakeCipher = (env: string, mode: PaymentMode): PlatformCipher => ({
  kid: "0a1b2c3d",
  seal: (field, value, ctx) =>
    `sealed:${env}:${mode}:${ctx.accountId}:${field}:${Buffer.from(value).toString("base64url")}`,
  open: (field, token, ctx) => {
    const [tag, e, m, account, f, value] = token.split(":");
    if (tag !== "sealed" || e !== env || m !== mode || account !== ctx.accountId || f !== field)
      throw new Error("payments: decrypt failed");
    return Buffer.from(value ?? "", "base64url").toString();
  },
});
const sealed = (accountId: string, field: string, value: string) =>
  fakeCipher("demo", "test").seal(field, value, { accountId });

/** Hyp's SIGN answer for a SIGN query: the parameters minus credentials, action=pay, a signature */
function hypSignAnswer(query: string): string {
  const pairs = [...new URLSearchParams(query)].filter(([k]) => k !== "KEY" && k !== "PassP");
  const map = new Map(pairs);
  map.set("action", "pay");
  return encodeParams([...map.entries(), ["signature", SIGNATURE]]);
}

function fakeHttp(answer: (query: string) => HypHttpResult) {
  const queries: string[] = [];
  const http = vi.fn(async (_endpoint: string, query: string) => {
    queries.push(query);
    return answer(query);
  });
  return { http, queries };
}
const ok = (body: string): HypHttpResult => ({ ok: true, status: 200, body, html: false });

const terminalSecrets = (masof = TERMINAL): TerminalSecrets => ({
  creds: { masof, key: FAKE_KEY, passp: FAKE_PASSWORD },
  mode: "test",
});

const thrown = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (e) {
    return e;
  }
  return null;
};
const codeOf = async (run: () => Promise<unknown>) => {
  const e = await thrown(run);
  expect(e).toBeInstanceOf(PlatformPaymentError);
  return (e as PlatformPaymentError).code;
};

// ------------------------------------------------------------------------------------------ start

function payDeps(
  over: Partial<PayDeps> = {},
  rpcHandlers: Record<string, (a: Record<string, unknown>) => Answer> = {},
) {
  const db = fakeRpc({
    platform_attempt_open: () => ({
      data: {
        attempt_id: ATTEMPT,
        reference: REFERENCE,
        amount_minor: 2500,
        currency: "ILS",
        terminal_number: TERMINAL,
        mode: "test",
        return_origin: ORIGIN,
        reused: false,
      },
    }),
    platform_attempt_signed: (a) => ({ data: { result: a["_ok"] ? "redirected" : "failed" } }),
    ...rpcHandlers,
  });
  const hyp = fakeHttp((q) => ok(hypSignAnswer(q)));
  const { log, lines } = fakeLog();
  const alerts: [string, string | null][] = [];
  const deps: PayDeps = {
    ready: () => ({ ok: true, env: "demo" }),
    paymentsEnv: () => "demo",
    endpoint: () => ENDPOINT,
    session: async () => ({ userId: ACTOR }),
    site: async () => ({ id: STORE }),
    storeOrigin: async () => ORIGIN,
    allow: () => true,
    ip: async () => "192.0.2.10",
    rpc: db.rpc,
    credentials: async () => ({ result: "ok", ...terminalSecrets() }),
    http: hyp.http,
    alert: async (reason, attempt) => void alerts.push([reason, attempt]),
    ownerRpc: async () => {
      throw new Error("not used");
    },
    log,
    ...over,
  };
  return { deps, db, hyp, lines, alerts };
}

describe("D5 start — the store owner opens a payment of one open charge (DM-PLAT-1, DM-PLAT-2)", () => {
  it("DM-PLAT-2: only the charge id comes from the browser; actor, store, amount and terminal come from the session and the DB", async () => {
    const { deps, db, hyp, lines } = payDeps();
    const out = await startPlatformPayment({ chargeId: CHARGE.toUpperCase() }, deps);
    expect(db.names()).toEqual(["platform_attempt_open", "platform_attempt_signed"]);
    expect(db.args("platform_attempt_open")).toEqual({
      _actor: ACTOR,
      _tenant: STORE,
      _target_kind: "ledger_charge",
      _target_id: CHARGE,
      _return_origin: ORIGIN,
      _app_environment: "demo",
    });
    // SIGN on NURIEL's terminal: the DB's amount (agorot → 2 decimals) and reference, MoreData, nothing else
    const sent = new URLSearchParams(hyp.queries[0]);
    expect([...sent.keys()]).toEqual([
      "action",
      "What",
      "Masof",
      "KEY",
      "PassP",
      "Amount",
      "Coin",
      "Order",
      "Sign",
      "MoreData",
      "hideBtns",
      "PageLang",
    ]);
    expect(sent.get("Amount")).toBe("25.00");
    expect(sent.get("Order")).toBe(REFERENCE);
    expect(sent.get("Masof")).toBe(TERMINAL);
    expect(db.args("platform_attempt_signed")).toEqual({
      _attempt: ATTEMPT,
      _ok: true,
      _code: null,
    });
    expect(out).toEqual({ url: `${ENDPOINT}?${hypSignAnswer(hyp.queries[0]!)}`, demo: true });
    // the log never carries the URL, a credential or the reference
    for (const line of lines)
      for (const leak of [FAKE_KEY, FAKE_PASSWORD, REFERENCE, SIGNATURE, ENDPOINT])
        expect(line).not.toContain(leak);
  });

  it("DM-PLAT-1: no session, the platform host (no store), payments off or a bad id → refused before any DB call", async () => {
    for (const [over, code] of [
      [{ session: async () => null }, "login"],
      [{ site: async () => null }, "store_only"],
      [{ ready: () => ({ ok: false, reason: "env" }) }, "unavailable"],
      [{ allow: () => false }, "rate_limited"],
    ] as [Partial<PayDeps>, string][]) {
      const { deps, db, hyp } = payDeps(over);
      expect(await codeOf(() => startPlatformPayment({ chargeId: CHARGE }, deps))).toBe(code);
      expect(db.calls).toEqual([]);
      expect(hyp.http).not.toHaveBeenCalled();
    }
    const { deps, db } = payDeps();
    expect(await codeOf(() => startPlatformPayment({ chargeId: "not-a-uuid" }, deps))).toBe(
      "invalid",
    );
    expect(db.calls).toEqual([]);
  });

  it("DM-PLAT-1: the DB refuses a platform admin (or anyone but the store's owner) — fixed Hebrew, no SIGN", async () => {
    const { deps, hyp } = payDeps(
      {},
      {
        platform_attempt_open: () => ({
          error: { message: "only the owner of the business pays NURIEL online", code: "42501" },
        }),
      },
    );
    const e = (await thrown(() =>
      startPlatformPayment({ chargeId: CHARGE }, deps),
    )) as PlatformPaymentError;
    expect(e.code).toBe("not_owner");
    expect(e.message).toBe("רק בעלי העסק יכולים לשלם כאן");
    expect(e.stack).toBe("");
    expect(hyp.http).not.toHaveBeenCalled();
  });

  it("DB refusals map to fixed texts: already paid, verifying, too many, test cap, unavailable; environment mismatch alerts", async () => {
    const cases: [string, string][] = [
      ["this charge is already covered", "already_paid"],
      ["this item is already paid", "already_paid"],
      ["the payment of this item is being verified", "verifying"],
      ["too many payment attempts for this item", "too_many"],
      ["test payments are limited to 50 ILS", "test_cap"],
      ["online payment to NURIEL is not available right now", "unavailable"],
      ["this charge cannot be paid online", "not_payable"],
      ["online payment: application and database environments differ", "unavailable"],
    ];
    for (const [message, code] of cases) {
      const { deps, alerts } = payDeps(
        {},
        {
          platform_attempt_open: () => ({ error: { message, code: "23514" } }),
        },
      );
      expect(await codeOf(() => startPlatformPayment({ chargeId: CHARGE }, deps)), message).toBe(
        code,
      );
      expect(alerts.length, message).toBe(/environments differ/.test(message) ? 1 : 0);
    }
  });

  it("DM-ENV-3 tripwire: a terminal that is not 00100 in DEMO, or another terminal than the attempt's → no SIGN, attempt failed, alert", async () => {
    for (const masof of ["9999999901", "0010090002"]) {
      const { deps, db, hyp, lines } = payDeps({
        credentials: async () => ({ result: "ok", ...terminalSecrets(masof) }),
      });
      expect(await codeOf(() => startPlatformPayment({ chargeId: CHARGE }, deps))).toBe(
        "unavailable",
      );
      expect(hyp.http).not.toHaveBeenCalled();
      expect(db.args("platform_attempt_signed")).toEqual({
        _attempt: ATTEMPT,
        _ok: false,
        _code: null,
      });
      expect(lines.some((l) => l.includes("ALERT terminal_not_allowed"))).toBe(true);
    }
  });

  it("SIGN failures: 902 records the code and alerts (credentials), a timeout records no code; the owner sees one text", async () => {
    const creds = payDeps({ http: fakeHttp(() => ok("CCode=902")).http });
    expect(await codeOf(() => startPlatformPayment({ chargeId: CHARGE }, creds.deps))).toBe(
      "sign_failed",
    );
    expect(creds.db.args("platform_attempt_signed")).toEqual({
      _attempt: ATTEMPT,
      _ok: false,
      _code: "902",
    });
    expect(creds.alerts).toEqual([["credentials", ATTEMPT]]);

    const timeout = payDeps({ http: fakeHttp(() => ({ ok: false, error: "timeout" })).http });
    expect(await codeOf(() => startPlatformPayment({ chargeId: CHARGE }, timeout.deps))).toBe(
      "sign_failed",
    );
    expect(timeout.db.args("platform_attempt_signed")).toEqual({
      _attempt: ATTEMPT,
      _ok: false,
      _code: null,
    });
    expect(timeout.alerts).toEqual([]);

    // an answer that echoes a credential is never turned into a URL
    const echo = payDeps({ http: fakeHttp((q) => ok(`${hypSignAnswer(q)}&PassP=fake`)).http });
    expect(await codeOf(() => startPlatformPayment({ chargeId: CHARGE }, echo.deps))).toBe(
      "sign_failed",
    );
  });

  it("the owner's views: options are available only when the server is ready; payments keep only known states and 4 digits", async () => {
    const options = {
      available: true,
      test: true,
      test_amount_cap_minor: 5000,
      charges: [
        {
          id: CHARGE,
          no: 7,
          amount_minor: 2500,
          description: "מנוי",
          occurred_on: "2026-11-01",
          payable: true,
          paid_online: false,
        },
        { id: "bad", amount_minor: 1 },
      ],
    };
    const { deps } = payDeps({ ownerRpc: (async () => options) as PayDeps["ownerRpc"] });
    expect(await platformPayOptions(deps)).toEqual({
      available: true,
      test: true,
      demo: true,
      testCapMinor: 5000,
      charges: [
        {
          id: CHARGE,
          no: 7,
          amountMinor: 2500,
          description: "מנוי",
          occurredOn: "2026-11-01",
          payable: true,
          paidOnline: false,
        },
      ],
    });
    const off = payDeps({
      ready: () => ({ ok: false, reason: "env" }),
      ownerRpc: (async () => options) as PayDeps["ownerRpc"],
    });
    const offOptions = await platformPayOptions(off.deps);
    expect(offOptions.available).toBe(false);
    expect(offOptions.charges.every((c) => !c.payable)).toBe(true);
    // the DEMO notice follows the environment marker, not the key check
    expect(offOptions.demo).toBe(true);

    const payments = payDeps({
      ownerRpc: (async () => [
        {
          id: ATTEMPT,
          state: "test_paid",
          amount_minor: 2500,
          test: true,
          card_last4: "4242",
          target_label: "מנוי",
        },
        { id: CHARGE, state: "weird", amount_minor: 1 },
        { id: STORE, state: "in_progress", amount_minor: 2500, card_last4: "12345" },
      ]) as PayDeps["ownerRpc"],
    });
    const list = await myPlatformPayments(payments.deps);
    expect(list.map((p) => [p.id, p.state, p.cardLast4])).toEqual([
      [ATTEMPT, "test_paid", "4242"],
      [STORE, "in_progress", null],
    ]);
  });

  it("storeOriginOf: the request host only when it is one of this store's hosts; http + port only on *.localhost", () => {
    const hosts = {
      slugHost: "store-a.shop.example.invalid",
      canonicalOrigin: "https://www.store-a.invalid",
      customDomain: "www.store-a.invalid",
    };
    const h = (host: string, extra: Record<string, string> = {}) => new Headers({ host, ...extra });
    expect(storeOriginOf(h("store-a.shop.example.invalid"), "http://x/", hosts)).toBe(ORIGIN);
    expect(storeOriginOf(h("www.store-a.invalid:443"), "http://x/", hosts)).toBe(
      "https://www.store-a.invalid",
    );
    expect(
      storeOriginOf(h("x", { "x-forwarded-host": "WWW.Store-A.invalid" }), "http://x/", hosts),
    ).toBe("https://www.store-a.invalid");
    // a foreign or forged host never becomes the return address: the store's own subdomain instead
    expect(storeOriginOf(h("evil.example.invalid"), "http://x/", hosts)).toBe(ORIGIN);
    expect(storeOriginOf(h("store-a.shop.example.invalid/@evil"), "http://x/", hosts)).toBe(ORIGIN);
    const local = { slugHost: "kobi.shop.localhost", canonicalOrigin: null, customDomain: null };
    expect(storeOriginOf(h("kobi.shop.localhost:3100"), "http://x/", local)).toBe(
      "http://kobi.shop.localhost:3100",
    );
    expect(storeOriginOf(h("other.shop.localhost:3100"), "http://x/", local)).toBe(
      "http://kobi.shop.localhost:3100",
    );
    expect(storeOriginOf(h("kobi.shop.localhost"), "http://x/", null)).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------ return + VERIFY + settle

const RETURN_PAIRS: [string, string][] = [
  ["Id", "12345"],
  ["CCode", "0"],
  ["Amount", "25.00"],
  ["ACode", "0000001"],
  ["Order", REFERENCE],
  ["Fild1", ""],
  ["Fild2", ""],
  ["Fild3", ""],
  ["Sign", SIGNATURE],
  ["Payments", "1"],
  ["Coin", "1"],
  ["L4digit", "4242"],
  ["Hesh", "0"],
];
const rawOf = (pairs: [string, string][]) => pairs.map(([k, v]) => `${k}=${v}`).join("&");
const RAW = rawOf(RETURN_PAIRS);

function returnDeps(
  rpcHandlers: Record<string, (a: Record<string, unknown>) => Answer> = {},
  over: Partial<PlatformReturnDeps> = {},
  verifyBody = "CCode=0",
) {
  const db = fakeRpc({
    platform_attempt_record_return: () => ({
      data: {
        result: "received",
        attempt_id: ATTEMPT,
        payer_tenant_id: STORE,
        state: "returned",
        terminal_number: TERMINAL,
        mode: "test",
        return_origin: ORIGIN,
      },
    }),
    platform_return_keep: () => ({ data: true }),
    platform_attempt_mark_paid: () => ({
      data: {
        result: "test_paid",
        applied: true,
        mode: "test",
        attempt_id: ATTEMPT,
        payer_tenant_id: STORE,
        return_origin: ORIGIN,
      },
    }),
    platform_payment_returns_purge: () => ({ data: 0 }),
    platform_payment_unknown_return: () => ({ data: true }),
    ...rpcHandlers,
  });
  const hyp = fakeHttp(() => ok(verifyBody));
  const { log, lines } = fakeLog();
  const alerts: [string, string | null][] = [];
  const secretsCalls: string[] = [];
  const deps: PlatformReturnDeps = {
    isPlatformHost: async () => true,
    ready: () => ({ ok: true, env: "demo" }),
    endpoint: () => ENDPOINT,
    rpc: db.rpc,
    credentials: async (attemptId, purpose) => {
      secretsCalls.push(`${attemptId}:${purpose}`);
      return { result: "ok", ...terminalSecrets() };
    },
    cipher: (env, mode) => fakeCipher(env, mode),
    http: hyp.http,
    alert: async (reason, attempt) => void alerts.push([reason, attempt]),
    log,
    ...over,
  };
  return { deps, db, hyp, lines, alerts, secretsCalls };
}

const input = (raw = RAW) => ({ provider: "max", raw, host: "platform.example.invalid" });

describe("D5 return — platform host only, unknown references never verified (DM-SEP-4)", () => {
  it("DM-SEP-4: a store host, another provider, or payments off → nothing written, nothing verified", async () => {
    for (const [over, provider, result] of [
      [{ isPlatformHost: async () => false }, "max", "refused"],
      [{}, "grow", "refused"],
      [{ ready: () => ({ ok: false, reason: "root_missing" }) }, "max", "off"],
    ] as [Partial<PlatformReturnDeps>, string, string][]) {
      const { deps, db, hyp } = returnDeps({}, over);
      const out = await handlePlatformReturn({ ...input(), provider }, deps);
      expect(out).toEqual({ location: "/", result, attemptId: null });
      expect(db.calls).toEqual([]);
      expect(hyp.http).not.toHaveBeenCalled();
    }
  });

  it("DM-PAY-3: a refused query (duplicate, reserved, no order) writes nothing", async () => {
    for (const raw of [
      `${RAW}&Amount=1.00`,
      `${RAW}&PassP=fake`,
      `${RAW}&masof=${TERMINAL}`,
      rawOf(RETURN_PAIRS.filter(([k]) => k !== "Order")),
      "",
    ]) {
      const { deps, db, hyp } = returnDeps();
      expect((await handlePlatformReturn(input(raw), deps)).result).toBe("refused");
      expect(db.calls).toEqual([]);
      expect(hyp.http).not.toHaveBeenCalled();
    }
  });

  it("DM-SEP-4 / DM-PAY-10: a reference this table does not know (a store's, or forged) is recorded as unknown and never verified", async () => {
    const { deps, db, hyp, secretsCalls } = returnDeps({
      platform_attempt_record_return: () => ({ data: { result: "unknown" } }),
    });
    const out = await handlePlatformReturn(input(), deps);
    expect(out).toEqual({ location: "/", result: "unknown", attemptId: null });
    expect(db.names()).toEqual([
      "platform_attempt_record_return",
      "platform_payment_unknown_return",
    ]);
    expect(db.args("platform_payment_unknown_return")).toEqual({
      _scope: "platform",
      _host: "platform.example.invalid",
      _payload_sha256: sha256Hex(RAW),
    });
    expect(secretsCalls).toEqual([]);
    expect(hyp.http).not.toHaveBeenCalled();
  });

  it("M06/M08: an EXACT replay (same payload hash) of a concluded attempt is not verified again", async () => {
    for (const state of ["paid", "test_paid", "needs_review", "failed"]) {
      const { deps, db, hyp } = returnDeps({
        platform_attempt_record_return: () => ({
          data: {
            result: "replay",
            attempt_id: ATTEMPT,
            state,
            mode: "test",
            return_origin: ORIGIN,
          },
        }),
      });
      const out = await handlePlatformReturn(input(), deps);
      expect(out).toEqual({
        location: `${ORIGIN}/admin?tab=billing&pay=return`,
        result: "concluded",
        attemptId: ATTEMPT,
      });
      expect(db.names()).toEqual(["platform_attempt_record_return"]);
      expect(hyp.http).not.toHaveBeenCalled();
    }
  });

  it("M06: a DIFFERENT return for a concluded attempt is verified with its own terminal and settled (→ duplicate_charge + alert)", async () => {
    for (const state of ["paid", "test_paid", "needs_review", "failed"]) {
      const { deps, db, hyp, alerts, secretsCalls } = returnDeps({
        platform_attempt_record_return: () => ({
          data: {
            result: "received",
            attempt_id: ATTEMPT,
            state,
            mode: "test",
            return_origin: ORIGIN,
          },
        }),
        platform_attempt_mark_paid: () => ({
          data: { result: "duplicate_charge", attempt_id: ATTEMPT, return_origin: ORIGIN },
        }),
      });
      const out = await handlePlatformReturn(input(), deps);
      expect(out.result, state).toBe("review");
      expect(secretsCalls).toEqual([`${ATTEMPT}:verify`]);
      expect(hyp.http).toHaveBeenCalledTimes(1);
      expect(db.names()).toContain("platform_attempt_mark_paid");
      expect(alerts).toEqual([["duplicate_charge", ATTEMPT]]);
    }
  });

  it("a return without a non-empty Sign is recorded but never verified (no secrets, no VERIFY, no settle)", async () => {
    for (const raw of [
      rawOf(RETURN_PAIRS.filter(([k]) => k !== "Sign")),
      rawOf(RETURN_PAIRS.map(([k, v]): [string, string] => [k, k === "Sign" ? "" : v])),
    ]) {
      const { deps, db, hyp, alerts, secretsCalls } = returnDeps();
      const out = await handlePlatformReturn(input(raw), deps);
      expect(out).toEqual({
        location: `${ORIGIN}/admin?tab=billing&pay=return`,
        result: "refused",
        attemptId: ATTEMPT,
      });
      expect(db.names()).toEqual(["platform_attempt_record_return"]);
      expect(secretsCalls).toEqual([]);
      expect(hyp.http).not.toHaveBeenCalled();
      expect(alerts).toEqual([["unsigned_return", ATTEMPT]]);
    }
  });
});

describe("D5 return — VERIFY with NURIEL's terminal of that attempt, then the one settle function (DM-PLAT-3, DM-PAY-4/6/7)", () => {
  it("DM-PLAT-3: a verified approved return settles once; the raw return is sealed under the attempt id; no store e-mail, no activation", async () => {
    const { deps, db, hyp, alerts, secretsCalls } = returnDeps();
    const out = await handlePlatformReturn(input(), deps);
    expect(out).toEqual({
      location: `${ORIGIN}/admin?tab=billing&pay=return`,
      result: "paid",
      attemptId: ATTEMPT,
    });
    expect(db.names()).toEqual([
      "platform_attempt_record_return",
      "platform_return_keep",
      "platform_attempt_mark_paid",
      "platform_payment_returns_purge",
    ]);
    expect(db.args("platform_attempt_record_return")).toEqual({
      _reference: REFERENCE,
      _payload_sha256: sha256Hex(RAW),
      _ccode: "0",
      _txn_id: "12345",
      _amount_minor: 2500,
      _installments: 1,
    });
    // decision 14: sealed under the ATTEMPT's id (a copy into another attempt does not open)
    expect(db.args("platform_return_keep")).toEqual({
      _attempt: ATTEMPT,
      _payload_sha256: sha256Hex(RAW),
      _return_enc: sealed(ATTEMPT, "raw_return", RAW),
    });
    expect(secretsCalls).toEqual([`${ATTEMPT}:verify`]);
    // VERIFY: the five fixed parameters, then the raw return unchanged
    expect(hyp.queries).toEqual([buildVerifyQuery(terminalSecrets().creds, RAW)]);
    expect(db.args("platform_attempt_mark_paid")).toEqual({
      _reference: REFERENCE,
      _payload_sha256: sha256Hex(RAW),
      _verify_ccode: "0",
      _ccode: "0",
      _terminal: TERMINAL,
      _txn_id: "12345",
      _amount_minor: 2500,
      _currency: "ILS",
      _installments: 1,
      _approval_code: "0000001",
      _card_brand: null,
      _card_last4: "4242",
      _return_flags: [],
      _app_environment: "demo",
    });
    expect(alerts).toEqual([]);
    // nothing but payment functions: no renew / activate / add-on / e-mail path
    expect(db.names().every((n) => /^platform_(attempt|return|payment)_/.test(n))).toBe(true);
  });

  it('DM-PAY-4: only an exactly verified answer reaches the DB as "0" — extra keys, HTML, transport failures do not', async () => {
    const cases: [string | null, string | null][] = [
      ["CCode=0", "0"],
      ["CCode=0\r\n", "0"],
      ["CCode=0&Id=1", null],
      ["CCode=00", "00"],
      ["CCode=902", "902"],
      ["<html>CCode=0</html>", null],
      [null, null],
    ];
    for (const [body, expected] of cases) {
      const { deps, db } = returnDeps(
        {},
        body === null ? { http: fakeHttp(() => ({ ok: false, error: "timeout" })).http } : {},
        body ?? "",
      );
      await handlePlatformReturn(input(), deps);
      expect(db.args("platform_attempt_mark_paid")?.["_verify_ccode"], String(body)).toBe(expected);
    }
    expect(verifyCodeForDb(null)).toBeNull();
    expect(verifyCodeForDb({ verified: false, ccode: "0", html: false })).toBeNull();
    expect(verifyCodeForDb({ verified: true, ccode: "0", html: false })).toBe("0");
    expect(verifyCodeForDb({ verified: false, ccode: "0\r\nX", html: false })).toBeNull();
  });

  it("DM-PAY-6/7: return flags reach the settle function; a review, a duplicate charge or an environment mismatch alerts the platform team", async () => {
    const flagged = rawOf([
      ...RETURN_PAIRS.filter(([k]) => k !== "Hesh"),
      ["Hesh", "EZ"],
      ["HKId", "7"],
    ]);
    const { deps, db, alerts } = returnDeps({
      platform_attempt_mark_paid: () => ({
        data: {
          result: "needs_review",
          reason: "document_issued",
          attempt_id: ATTEMPT,
          return_origin: ORIGIN,
        },
      }),
    });
    const out = await handlePlatformReturn(input(flagged), deps);
    expect(db.args("platform_attempt_mark_paid")?.["_return_flags"]).toEqual(["document", "hk"]);
    expect(out.result).toBe("review");
    expect(alerts).toEqual([["document_issued", ATTEMPT]]);

    for (const result of ["duplicate_charge", "environment_mismatch"]) {
      const r = returnDeps({
        platform_attempt_mark_paid: () => ({ data: { result, attempt_id: ATTEMPT } }),
      });
      await handlePlatformReturn(input(), r.deps);
      expect(r.alerts, result).toEqual([[result, ATTEMPT]]);
    }
    const declined = returnDeps({
      platform_attempt_mark_paid: () => ({ data: { result: "not_paid", attempt_id: ATTEMPT } }),
    });
    expect((await handlePlatformReturn(input(), declined.deps)).result).toBe("not_paid");
    expect(declined.alerts).toEqual([]);
  });

  it("a VERIFY already in flight (busy) waits; exhausted VERIFY alerts; neither calls Hyp", async () => {
    const busy = returnDeps(
      {},
      { credentials: async () => ({ result: "busy", retryAfterSeconds: 30 }) },
    );
    expect((await handlePlatformReturn(input(), busy.deps)).result).toBe("pending");
    expect(busy.hyp.http).not.toHaveBeenCalled();
    expect(busy.db.names()).not.toContain("platform_attempt_mark_paid");

    const exhausted = returnDeps({}, { credentials: async () => ({ result: "exhausted" }) });
    expect((await handlePlatformReturn(input(), exhausted.deps)).result).toBe("review");
    expect(exhausted.alerts).toEqual([["verify_exhausted", ATTEMPT]]);
    expect(exhausted.hyp.http).not.toHaveBeenCalled();
  });

  it("a soft state (failed / expired / cancelled) is still verified: money may have moved", async () => {
    for (const state of ["failed", "expired", "cancelled"]) {
      const { deps, hyp } = returnDeps({
        platform_attempt_record_return: () => ({
          data: {
            result: "received",
            attempt_id: ATTEMPT,
            state,
            mode: "test",
            return_origin: ORIGIN,
          },
        }),
      });
      expect((await handlePlatformReturn(input(), deps)).result, state).toBe("paid");
      expect(hyp.http).toHaveBeenCalledTimes(1);
    }
  });

  it("the 303 target is the saved store origin, validated again; anything else is the platform start page", () => {
    expect(returnLocation(ORIGIN)).toBe(`${ORIGIN}/admin?tab=billing&pay=return`);
    expect(returnLocation("http://kobi.shop.localhost:3100")).toBe(
      "http://kobi.shop.localhost:3100/admin?tab=billing&pay=return",
    );
    for (const bad of [
      null,
      "",
      "javascript:alert(1)",
      "https://evil.invalid/path",
      "http://evil.invalid",
      "https://x.invalid?y",
      "//evil.invalid",
      "https://a.invalid:8443",
    ])
      expect(returnLocation(bad), String(bad)).toBe("/");
  });
});

describe("D5 re-VERIFY job (platform_attempts_pending_verify)", () => {
  it("off with PAYMENTS_JOBS=off or when payments are off: no DB call", async () => {
    for (const over of [
      { jobsOn: () => false },
      { ready: () => ({ ok: false as const, reason: "env" }) },
    ]) {
      const db = fakeRpc({});
      const reverify = vi.fn();
      const { log } = fakeLog();
      const summary = await runPlatformPaymentJobs({
        jobsOn: () => true,
        ready: () => ({ ok: true, env: "demo" }),
        rpc: db.rpc,
        reverify,
        log,
        ...over,
      });
      expect(summary).toEqual({ pending: 0, paid: 0, review: 0, expired: 0, purged: 0 });
      expect(db.calls).toEqual([]);
    }
  });

  it("re-verifies each well-formed pending return, then expires and purges", async () => {
    const sha = sha256Hex(RAW);
    const db = fakeRpc({
      platform_attempts_pending_verify: () => ({
        data: [
          { attempt_id: ATTEMPT, reference: REFERENCE, payload_sha256: sha, mode: "test" },
          { attempt_id: "bad", reference: REFERENCE, payload_sha256: sha, mode: "test" },
          { attempt_id: CHARGE, reference: REFERENCE, payload_sha256: "nope", mode: "test" },
        ],
      }),
      platform_attempts_expire: () => ({ data: 2 }),
      platform_payment_returns_purge: () => ({ data: 1 }),
    });
    const reverify = vi.fn(async () => ({ result: "paid" as const }));
    const { log } = fakeLog();
    const summary = await runPlatformPaymentJobs({
      jobsOn: () => true,
      ready: () => ({ ok: true, env: "demo" }),
      rpc: db.rpc,
      reverify,
      log,
    });
    expect(reverify).toHaveBeenCalledTimes(1);
    expect(reverify).toHaveBeenCalledWith({
      attemptId: ATTEMPT,
      reference: REFERENCE,
      sha,
      mode: "test",
    });
    expect(db.names()).toEqual([
      "platform_attempts_pending_verify",
      "platform_attempts_expire",
      "platform_payment_returns_purge",
    ]);
    expect(summary).toEqual({ pending: 1, paid: 1, review: 0, expired: 2, purged: 1 });
  });

  it("reverifyPlatformReturn opens the kept raw return (attempt id), checks it is the same one, and settles", async () => {
    const token = sealed(ATTEMPT, "raw_return", RAW);
    const { deps, db, hyp } = returnDeps({ platform_return_get: () => ({ data: token }) });
    const out = await reverifyPlatformReturn(
      { attemptId: ATTEMPT, reference: REFERENCE, sha: sha256Hex(RAW), mode: "test" },
      deps,
    );
    expect(out.result).toBe("paid");
    expect(hyp.queries).toEqual([buildVerifyQuery(terminalSecrets().creds, RAW)]);
    expect(db.names()).toEqual(["platform_return_get", "platform_attempt_mark_paid"]);

    const gone = returnDeps({ platform_return_get: () => ({ data: null }) });
    expect(
      (
        await reverifyPlatformReturn(
          { attemptId: ATTEMPT, reference: REFERENCE, sha: sha256Hex(RAW), mode: "test" },
          gone.deps,
        )
      ).result,
    ).toBe("gone");

    // a token sealed for ANOTHER attempt does not open; a raw return that is not the recorded one is refused
    for (const [data, sha] of [
      [sealed(CHARGE, "raw_return", RAW), sha256Hex(RAW)],
      [token, sha256Hex(`${RAW}&x=1`)],
    ] as [string, string][]) {
      const r = returnDeps({ platform_return_get: () => ({ data }) });
      expect(
        (
          await reverifyPlatformReturn(
            { attemptId: ATTEMPT, reference: REFERENCE, sha, mode: "test" },
            r.deps,
          )
        ).result,
      ).toBe("error");
      expect(r.hyp.http).not.toHaveBeenCalled();
    }
  });
});

// ------------------------------------------------------------------------------------------ credentials

describe("D5 credentials — NURIEL's terminal opens only under PLATFORM_ACCOUNT_ID and its field names", () => {
  const row = {
    result: "ok",
    terminal_number: TERMINAL,
    mode: "test",
    api_key_enc: sealed("platform", "api_key", FAKE_KEY),
    api_password_enc: sealed("platform", "api_password", FAKE_PASSWORD),
  };
  const deps = (data: unknown) => ({
    rpc: fakeRpc({
      platform_attempt_secrets: () => ({ data }),
      platform_terminal_check_secrets: () => ({ data }),
    }).rpc,
    cipher: fakeCipher,
    log: fakeLog().log,
  });

  it("opens the two tokens for one call", async () => {
    expect(await platformAttemptCredentials(ATTEMPT, "sign", "demo", deps(row))).toEqual({
      result: "ok",
      creds: { masof: TERMINAL, key: FAKE_KEY, passp: FAKE_PASSWORD },
      mode: "test",
    });
    expect((await platformTerminalCheckCredentials(ACTOR, "demo", deps(row))).creds.passp).toBe(
      FAKE_PASSWORD,
    );
  });

  it("DM-ENV-4: a token sealed for another account or field does not open → one fixed error, an alert line", async () => {
    for (const bad of [
      { ...row, api_key_enc: sealed(STORE, "api_key", FAKE_KEY) },
      { ...row, api_password_enc: sealed("platform", "api_key", FAKE_PASSWORD) },
      { ...row, terminal_number: "123" },
    ]) {
      const e = await thrown(() => platformAttemptCredentials(ATTEMPT, "sign", "demo", deps(bad)));
      expect((e as PlatformPaymentError).code).toBe("credentials");
      expect(String((e as Error).message)).not.toContain(FAKE_KEY);
    }
    // a live terminal on a DEMO server: refused (DM-ENV-3)
    expect(
      (await thrown(() =>
        platformAttemptCredentials(ATTEMPT, "sign", "demo", deps({ ...row, mode: "live" })),
      )) instanceof PlatformPaymentError,
    ).toBe(true);
    expect(
      await platformAttemptCredentials(
        ATTEMPT,
        "verify",
        "demo",
        deps({ result: "busy", retry_after_seconds: 12 }),
      ),
    ).toEqual({ result: "busy", retryAfterSeconds: 12 });
    expect(
      await platformAttemptCredentials(ATTEMPT, "verify", "demo", deps({ result: "exhausted" })),
    ).toEqual({ result: "exhausted" });
  });
});

// ------------------------------------------------------------------------------------------ terminal + step-up

function terminalDeps(
  over: Partial<TerminalDeps> = {},
  rpcHandlers: Record<string, (a: Record<string, unknown>) => Answer> = {},
) {
  const status = {
    configured: true,
    environment: "demo",
    flag: true,
    enabled: true,
    mode: "test",
    status: "verified",
    terminal_hint: "01",
    has_api_key: true,
    has_api_password: true,
    unknown_returns: { platform_24h: 1, tenant_24h: 0 },
  };
  const db = fakeRpc({
    platform_terminal_status: () => ({ data: status }),
    platform_terminal_save: () => ({ data: status }),
    platform_terminal_verified: (a) => ({
      data: { ...status, status: a["_ok"] ? "verified" : "failed" },
    }),
    platform_card_payments: () => ({ data: [] }),
    platform_unreturned_attempts: () => ({ data: [] }),
    platform_card_payment_resolve: () => ({ data: true }),
    ...rpcHandlers,
  });
  const order: string[] = [];
  const issued: { actor: string; hash: string }[] = [];
  const consumed: { actor: string; challenge: string; hash: string; code: string }[] = [];
  let issuedHash = "";
  const stepup = () => ({
    issue: async (actor: string, hash: string) => {
      order.push("issue");
      issued.push({ actor, hash });
      issuedHash = hash;
      return { challengeId: CHALLENGE, code: "246813", expiresAt: "2026-11-28T10:10:00.000Z" };
    },
    consume: async (actor: string, challenge: string, hash: string, code: string) => {
      order.push("consume");
      consumed.push({ actor, challenge, hash, code });
      if (code !== "246813") return { ok: false, reason: "wrong_code" };
      if (hash !== issuedHash) return { ok: false, reason: "purpose_mismatch" };
      return { ok: true };
    },
  });
  const sent: Record<string, unknown>[] = [];
  const hyp = fakeHttp((q) => ok(hypSignAnswer(q)));
  const { log, lines } = fakeLog();
  const deps: TerminalDeps = {
    isPlatformHost: async () => true,
    session: async () => ({ userId: ACTOR }),
    platformOrigin: async () => "https://platform.example.invalid",
    ready: () => ({ ok: true, env: "demo" }),
    paymentsEnv: () => "demo",
    endpoint: () => ENDPOINT,
    allow: () => true,
    rpc: db.rpc,
    stepup,
    purposeHash: (actor, intent) => sha256Hex(`${actor}|${JSON.stringify(intent)}`),
    cipher: fakeCipher,
    checkCredentials: async () => terminalSecrets(),
    accountEmail: async () => "admin@example.invalid",
    sendEmail: async (email) => {
      sent.push(email as unknown as Record<string, unknown>);
      return { sent: true, skipped: false, id: "fake", reason: null };
    },
    http: hyp.http,
    randomReference: () => "f".repeat(32),
    log: {
      ...log,
      info: (e, f) => {
        order.push(e);
        log.info(e, f);
      },
    },
    ...over,
  };
  const wrapped: PlatformRpc = async (fn, args) => {
    order.push(fn);
    return db.rpc(fn, args);
  };
  deps.rpc = over.rpc ?? wrapped;
  return { deps, db, order, issued, consumed, sent, hyp, lines };
}

const CHANGE = {
  terminalNumber: TERMINAL,
  enabled: true,
  setApiKey: true,
  setApiPassword: true,
  clearCredentials: false,
  force: false,
};
const SAVE = {
  terminalNumber: TERMINAL,
  enabled: true,
  apiKey: FAKE_KEY,
  apiPassword: FAKE_PASSWORD,
  clearCredentials: false,
  force: false,
  challengeId: CHALLENGE,
  code: "246813",
};

describe("D5 terminal — saving NURIEL's terminal needs a consumed step-up code first (DM-SEP-6)", () => {
  it("DM-SEP-6: the code request is platform-host only, bound to the change set, e-mailed — never returned or logged", async () => {
    for (const [over, code] of [
      [{ isPlatformHost: async () => false }, "platform_only"],
      [{ session: async () => null }, "login"],
      [{ ready: () => ({ ok: false, reason: "env" }) }, "unavailable"],
    ] as [Partial<TerminalDeps>, string][]) {
      const t = terminalDeps(over);
      expect(await codeOf(() => requestTerminalSaveCode(CHANGE, t.deps))).toBe(code);
      expect(t.issued).toEqual([]);
    }
    const t = terminalDeps();
    const out = await requestTerminalSaveCode(CHANGE, t.deps);
    expect(out).toEqual({
      challengeId: CHALLENGE,
      expiresAt: "2026-11-28T10:10:00.000Z",
      maskedEmail: "a***@example.invalid",
    });
    expect(JSON.stringify(out)).not.toContain("246813");
    expect(t.issued).toEqual([
      { actor: ACTOR, hash: sha256Hex(`${ACTOR}|${JSON.stringify(intentOf(CHANGE, "demo"))}`) },
    ]);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toMatchObject({
      to: "admin@example.invalid",
      idempotencyKey: `stepup:${CHALLENGE}`,
      senderName: "NURIEL",
      replyTo: null,
    });
    expect(String(t.sent[0]!["html"])).toContain("246813");
    for (const line of t.lines) expect(line).not.toContain("246813");
    // the intent names WHICH secrets change, never their values
    expect(JSON.stringify(intentOf(CHANGE, "demo"))).not.toMatch(/FAKE_/);
    expect(intentOf(CHANGE, "demo")).toEqual({
      mode: "test",
      terminal_number: TERMINAL,
      enabled: true,
      set_api_key: true,
      set_api_password: true,
      clear_credentials: false,
      force: false,
      max_installments: 1,
    });
  });

  it("DM-SEP-6: the save consumes the code, then seals the secrets under PLATFORM_ACCOUNT_ID, then saves — the patch carries no plaintext", async () => {
    const t = terminalDeps();
    await requestTerminalSaveCode(CHANGE, t.deps);
    const view = await savePlatformTerminal(SAVE, t.deps);
    expect(t.order.indexOf("consume")).toBeLessThan(t.order.indexOf("platform_terminal_save"));
    const saved = t.db.args("platform_terminal_save")!;
    expect(saved["_actor"]).toBe(ACTOR);
    expect(saved["_app_environment"]).toBe("demo");
    expect(saved["_patch"]).toEqual({
      mode: "test",
      terminal_max_installments: 1,
      max_installments: 1,
      terminal_number: TERMINAL,
      enabled: true,
      api_key_enc: sealed("platform", "api_key", FAKE_KEY),
      api_password_enc: sealed("platform", "api_password", FAKE_PASSWORD),
      key_id: "0a1b2c3d",
    });
    expect(JSON.stringify(saved)).not.toContain(FAKE_KEY);
    expect(JSON.stringify(view)).not.toMatch(/FAKE_|sealed:/);
    expect(view).toMatchObject({
      configured: true,
      status: "verified",
      terminalHint: "••01",
      successUrl: "https://platform.example.invalid/platform/payments/return/max",
    });
    for (const line of t.lines)
      for (const leak of [FAKE_KEY, FAKE_PASSWORD, "246813"]) expect(line).not.toContain(leak);
  });

  it("DM-SEP-6: a wrong code, a code for another change, or no code → no save at all", async () => {
    const wrong = terminalDeps();
    await requestTerminalSaveCode(CHANGE, wrong.deps);
    expect(await codeOf(() => savePlatformTerminal({ ...SAVE, code: "111111" }, wrong.deps))).toBe(
      "stepup_wrong",
    );
    expect(wrong.db.names()).not.toContain("platform_terminal_save");

    // the code was issued for "enable + new credentials"; saving "disable" with it is refused
    const other = terminalDeps();
    await requestTerminalSaveCode(CHANGE, other.deps);
    expect(await codeOf(() => savePlatformTerminal({ ...SAVE, enabled: false }, other.deps))).toBe(
      "stepup_mismatch",
    );
    expect(other.db.names()).not.toContain("platform_terminal_save");

    const none = terminalDeps();
    expect(await codeOf(() => savePlatformTerminal({ ...SAVE, code: "12" }, none.deps))).toBe(
      "stepup_failed",
    );
    expect(none.consumed).toEqual([]);
  });

  it("input rules before the step-up: DEMO needs a 00100… terminal; clear and replace together is refused; an empty change is refused", async () => {
    const t = terminalDeps();
    expect(
      await codeOf(() => savePlatformTerminal({ ...SAVE, terminalNumber: "9999999901" }, t.deps)),
    ).toBe("terminal_invalid");
    expect(
      await codeOf(() => requestTerminalSaveCode({ ...CHANGE, clearCredentials: true }, t.deps)),
    ).toBe("invalid");
    expect(
      await codeOf(() =>
        requestTerminalSaveCode(
          {
            terminalNumber: null,
            enabled: null,
            setApiKey: false,
            setApiPassword: false,
            clearCredentials: false,
            force: false,
          },
          t.deps,
        ),
      ),
    ).toBe("invalid");
    expect(await codeOf(() => savePlatformTerminal({ ...SAVE, apiKey: "bad\nkey" }, t.deps))).toBe(
      "invalid",
    );
    expect(t.consumed).toEqual([]);
  });

  it("the DB's own refusals map to fixed texts (force needed, terminal taken, step-up proof missing)", async () => {
    for (const [message, code] of [
      [
        "a payment to NURIEL is being verified; save again with force to park it for review",
        "force_needed",
      ],
      ["this terminal number is already registered to tenant", "terminal_taken"],
      ["confirm with the verification code sent by email first (step-up)", "stepup_required"],
      [
        "DEMO database: only test terminals (mode test, terminal number 00100…) can be saved",
        "terminal_invalid",
      ],
    ] as [string, string][]) {
      const t = terminalDeps(
        {},
        { platform_terminal_save: () => ({ error: { message, code: "23514" } }) },
      );
      await requestTerminalSaveCode(CHANGE, t.deps);
      expect(await codeOf(() => savePlatformTerminal(SAVE, t.deps)), message).toBe(code);
    }
  });

  it("test connection: SIGN of ₪1 with a random reference, recorded as verified / failed; a non-00100 terminal is never sent", async () => {
    const t = terminalDeps();
    const out = await testPlatformTerminal(t.deps);
    expect(out.ok).toBe(true);
    const sent = new URLSearchParams(t.hyp.queries[0]);
    expect(sent.get("Amount")).toBe("1.00");
    expect(sent.get("Order")).toBe("f".repeat(32));
    expect(t.db.args("platform_terminal_verified")).toEqual({
      _actor: ACTOR,
      _ok: true,
      _code: null,
    });

    const refused = terminalDeps({ http: fakeHttp(() => ok("CCode=902")).http });
    expect(await testPlatformTerminal(refused.deps)).toMatchObject({ ok: false, code: "902" });
    expect(refused.db.args("platform_terminal_verified")).toEqual({
      _actor: ACTOR,
      _ok: false,
      _code: "902",
    });

    const live = terminalDeps({ checkCredentials: async () => terminalSecrets("9999999901") });
    expect(await testPlatformTerminal(live.deps)).toMatchObject({
      ok: false,
      code: "bad_terminal",
    });
    expect(live.hyp.http).not.toHaveBeenCalled();
  });

  it("status and lists: platform host only; no secret or full terminal number; review rows can be resolved", async () => {
    const off = terminalDeps({ isPlatformHost: async () => false });
    expect(await codeOf(() => platformTerminalStatus(off.deps))).toBe("platform_only");
    const t = terminalDeps(
      {},
      {
        platform_card_payments: () => ({
          data: [
            {
              id: ATTEMPT,
              state: "needs_review",
              review_reason: "amount_mismatch",
              amount_minor: 2500,
              mode: "test",
              terminal_hint: TERMINAL,
              card_last4: "4242",
              return_flags: ["document"],
            },
          ],
        }),
        platform_unreturned_attempts: () => ({
          data: [
            {
              id: ATTEMPT,
              reference: REFERENCE,
              amount_minor: 2500,
              state: "expired",
              terminal_hint: "01",
            },
          ],
        }),
      },
    );
    const status = await platformTerminalStatus(t.deps);
    expect(status).toMatchObject({
      configured: true,
      demo: true,
      paymentsReady: true,
      unknownReturns24h: { platform: 1, tenant: 0, lastAt: null },
    });
    const payments = await platformCardPaymentsList({ tenantId: null }, t.deps);
    expect(payments[0]).toMatchObject({
      id: ATTEMPT,
      state: "needs_review",
      reviewReason: "amount_mismatch",
      terminalHint: "••01",
      returnFlags: ["document"],
    });
    expect(JSON.stringify(payments)).not.toContain(TERMINAL);
    expect((await platformUnreturnedList(t.deps))[0]).toMatchObject({
      reference: REFERENCE,
      state: "expired",
    });
    // a DEMO server whose root key is missing: the page still loads, says DEMO, and says it cannot save or test
    const noKey = terminalDeps({ ready: () => ({ ok: false, reason: "root_missing" }) });
    expect(await platformTerminalStatus(noKey.deps)).toMatchObject({
      demo: true,
      paymentsReady: false,
    });
    expect(await codeOf(() => testPlatformTerminal(noKey.deps))).toBe("unavailable");
    expect(await resolvePlatformCardPayment({ attemptId: ATTEMPT, note: "נבדק" }, t.deps)).toEqual({
      resolved: true,
    });
    expect(t.db.args("platform_card_payment_resolve")).toEqual({
      _actor: ACTOR,
      _attempt: ATTEMPT,
      _note: "נבדק",
    });
  });
});

// ------------------------------------------------------------------------------------------ log, alerts, DB errors

describe("D5 log, alerts and DB errors (DM-SEC-7)", () => {
  it("DM-SEC-7: every line goes through the redactor; values are single tokens (no injection)", () => {
    expect(platformLine("sign", { attempt: "44444444", ok: true })).toBe(
      "[pay:platform] sign attempt=44444444 ok=true",
    );
    // an embedded credential is masked before the value is flattened into one token
    expect(platformLine("x", { note: "a b\nPassP=secret" })).toBe(
      "[pay:platform] x note=a_b_PassP____",
    );
    // a terminal number keeps its last 2 digits, by name or as a bare long number
    for (const line of [
      platformLine("x", { q: `Masof=${TERMINAL}` }),
      platformLine("x", { masof: TERMINAL }),
      platformLine("x", { n: TERMINAL }),
    ]) {
      expect(line).not.toContain(TERMINAL);
      expect(line).toMatch(/01$/);
    }
    expect(platformLine("review", { reason: "amount_mismatch" }, true)).toBe(
      "[pay:platform] ALERT review reason=amount_mismatch",
    );
    expect(platformLine("Bad Event", { "Bad-Name": 1 })).toBe("[pay:platform] event");
  });

  it("alerts: always a log line; one e-mail per recipient with a stable key; no amount or customer data; never throws", async () => {
    const sent: Record<string, unknown>[] = [];
    const { log, lines } = fakeLog();
    await alertPlatformAdmins("document_issued", ATTEMPT, {
      send: async (email) => {
        sent.push(email as unknown as Record<string, unknown>);
        return { sent: true, skipped: false, id: "x", reason: null };
      },
      recipients: () => ["ops1@example.invalid", "ops2@example.invalid"],
      panelUrl: () => "https://platform.example.invalid/platform/payments",
      log,
    });
    expect(lines).toEqual(["[pay:platform] ALERT review reason=document_issued attempt=44444444"]);
    expect(sent.map((s) => s["to"])).toEqual(["ops1@example.invalid", "ops2@example.invalid"]);
    const keys = sent.map((s) => String(s["idempotencyKey"]));
    expect(new Set(keys).size).toBe(2);
    expect(keys.every((k) => k.startsWith(`pay-review:${ATTEMPT}:document_issued:`))).toBe(true);
    expect(String(sent[0]!["html"])).toContain("ייתכן שהופק מסמך");
    expect(String(sent[0]!["html"])).not.toMatch(/₪|[0-9]{3,}\.[0-9]{2}|4242/);
    await expect(
      alertPlatformAdmins("x y", null, {
        send: async () => {
          throw new Error("down");
        },
        recipients: () => ["a@example.invalid"],
        panelUrl: () => null,
        log,
      }),
    ).resolves.toBeUndefined();
  });

  it("an unknown DB failure is generic and logged with the function and SQLSTATE only", () => {
    const { log, lines } = fakeLog();
    const e = dbFailure(
      { message: `relation "payments.platform_accounts" … ${FAKE_KEY}`, code: "42P01" },
      "platform_terminal_status",
      log,
    );
    expect(e.code).toBe("generic");
    expect(lines).toEqual(["[pay:platform] db fn=platform_terminal_status sqlstate=42P01"]);
    expect(e.message).not.toContain(FAKE_KEY);
  });
});

// sanity: the protocol module parses the fixture return (keeps the tests honest)
it("fixture return parses", () => {
  expect(parseReturnQuery(RAW).ok).toBe(true);
});
