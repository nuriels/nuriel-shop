// P-5 (contract §7.2) — the production pilot keeps NURIEL's own terminal off. Every platform entry point refuses
// FIRST: zero DB calls, zero Hyp calls. Two layers are tested: the orchestrators with injected fakes (every
// dependency counts and must stay at zero), and the real server functions / return route with the shared DB and
// Hyp callers mocked (counted). The environment marker is mocked to "pilot" (server/env.ts is not changed here).
// Demo / production behaviour is covered, unchanged, by payments-platform.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  env: "pilot" as string | null,
  rpc: [] as string[],
  hyp: 0,
  other: [] as string[],
}));

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    inputValidator: (validate: (input: unknown) => unknown) => ({
      handler: (fn: (ctx: { data: unknown }) => unknown) => (ctx: { data: unknown }) =>
        fn({ data: validate(ctx.data) }),
    }),
    handler: (fn: unknown) => fn,
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
}));
vi.mock("@/platform/payments/server/env", async (original) => ({
  ...(await original<typeof import("@/platform/payments/server/env")>()),
  paymentsEnv: () => h.env,
}));
vi.mock("@/platform/payments/server/db", () => ({
  paymentsRpc: vi.fn(async (fn: string) => {
    h.rpc.push(fn);
    return { data: null, error: null };
  }),
  stepupRpc: vi.fn(async (fn: string) => {
    h.rpc.push(fn);
    return { data: null, error: null };
  }),
  accountEmail: vi.fn(async () => {
    h.other.push("accountEmail");
    return null;
  }),
}));
vi.mock("@/platform/payments/server/http", () => ({
  HYP_HTTP_DEFAULTS: { timeoutMs: 15_000, maxBytes: 64 * 1024 },
  hypRequest: vi.fn(async () => {
    h.hyp += 1;
    return { ok: false, error: "network" };
  }),
}));
vi.mock("@/platform/tenancy/current-site.server", () => ({
  isPlatformHost: vi.fn(async () => {
    h.other.push("isPlatformHost");
    return true;
  }),
  currentSite: vi.fn(async () => {
    h.other.push("currentSite");
    return null;
  }),
  currentSiteHosts: vi.fn(async () => {
    h.other.push("currentSiteHosts");
    return null;
  }),
}));
vi.mock("@/platform/billing/billing.server", () => ({
  ownerRpc: vi.fn(async (fn: string) => {
    h.rpc.push(fn);
    return null;
  }),
}));
vi.mock("@/platform/auth/session.server", () => ({
  sessionFromRequest: vi.fn(async () => {
    h.other.push("session");
    return { userId: "11111111-1111-4111-8111-111111111111" };
  }),
}));

import { PLATFORM_ERROR_TEXT, PlatformPaymentError } from "@/platform/payments/server/platform/db";
import { platformPilotOff } from "@/platform/payments/server/platform/pilot";
import {
  myPlatformPayments,
  platformPayOptions,
  startPlatformPayment,
  type PayDeps,
} from "@/platform/payments/server/platform/pay";
import {
  platformCardPaymentsList,
  platformTerminalStatus,
  platformUnreturnedList,
  requestTerminalSaveCode,
  resolvePlatformCardPayment,
  savePlatformTerminal,
  testPlatformTerminal,
  type TerminalDeps,
} from "@/platform/payments/server/platform/terminal";
import {
  handlePlatformReturn,
  reverifyPlatformReturn,
  type PlatformReturnDeps,
} from "@/platform/payments/server/platform/return";
import { runPlatformPaymentJobs } from "@/platform/payments/server/platform/jobs";
import * as payFns from "@/platform/billing/pay.functions";
import * as terminalFns from "@/platform/billing/pay-terminal.functions";
// loaded at run time only: the route file's types need the generated route tree, which the test tsconfig leaves out
const RETURN_ROUTE = "@/routes/platform_.payments_.return.$provider";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const ATTEMPT = "44444444-4444-4444-8444-444444444444";
const CHARGE = "33333333-3333-4333-8333-333333333333";
const CHALLENGE = "55555555-5555-4555-8555-555555555555";
const REFERENCE = "0123456789abcdef0123456789abcdef";
const SOON = "הסליקה בקרוב";
/** "pilot" as paymentsEnv() will return it once server/env.ts knows it (its type does not yet) */
const PILOT = (() => "pilot") as unknown as () => null;

/** a deps object whose every function records its name and fails: the gate must call none of them */
function untouchable<T extends object>(over: Partial<T> = {}): { deps: T; touched: string[] } {
  const touched: string[] = [];
  const deps = new Proxy(over as T, {
    get(target, name) {
      if (name in target) return (target as Record<string | symbol, unknown>)[name];
      return (..._args: unknown[]) => {
        touched.push(String(name));
        throw new Error(`touched ${String(name)}`);
      };
    },
  });
  return { deps, touched };
}

async function soonCode(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(PlatformPaymentError);
    expect((error as Error).message).toBe(SOON);
    return (error as PlatformPaymentError).code;
  }
  throw new Error("expected a refusal");
}

beforeEach(() => {
  h.env = "pilot";
  h.rpc.length = 0;
  h.hyp = 0;
  h.other.length = 0;
});
afterEach(() => {
  h.env = "pilot";
});

describe("P-5: the one helper", () => {
  it("platformPilotOff() is true only for the pilot marker; an unreadable marker is not the pilot", () => {
    expect(platformPilotOff(PILOT)).toBe(true);
    for (const env of ["demo", "production", null, "PILOT", " pilot"])
      expect(
        platformPilotOff(() => env),
        String(env),
      ).toBe(false);
    expect(
      platformPilotOff(() => {
        throw new Error("x");
      }),
    ).toBe(false);
    // the default reader is paymentsEnv() (mocked here)
    expect(platformPilotOff()).toBe(true);
    h.env = "demo";
    expect(platformPilotOff()).toBe(false);
  });

  it('the fixed text is "הסליקה בקרוב", the same on the server and in the pages', () => {
    expect(PLATFORM_ERROR_TEXT.soon).toBe(SOON);
    expect(payFns.PAYMENTS_SOON_TEXT).toBe(SOON);
  });
});

describe("P-5: orchestrators in the pilot — refused first, nothing else called", () => {
  it("pay.ts: start → soon; options → the soon answer; my payments → soon (no DB, no Hyp, no session)", async () => {
    const start = untouchable<PayDeps>({ paymentsEnv: PILOT });
    expect(await soonCode(() => startPlatformPayment({ chargeId: CHARGE }, start.deps))).toBe(
      "soon",
    );
    expect(start.touched).toEqual([]);

    const options = untouchable<PayDeps>({ paymentsEnv: PILOT });
    expect(await platformPayOptions(options.deps)).toEqual({
      available: false,
      soon: true,
      test: false,
      demo: false,
      testCapMinor: null,
      charges: [],
    });
    expect(options.touched).toEqual([]);

    const mine = untouchable<PayDeps>({ paymentsEnv: PILOT });
    expect(await soonCode(() => myPlatformPayments(mine.deps))).toBe("soon");
    expect(mine.touched).toEqual([]);
  });

  it("terminal.ts: status, code request, save, connection test, lists and resolve → soon, nothing called", async () => {
    const change = {
      terminalNumber: "0010090001",
      enabled: true,
      setApiKey: true,
      setApiPassword: true,
      clearCredentials: false,
      force: false,
      apiKey: "FAKE_KEY_pilot",
      apiPassword: "FAKE_PASSWORD_pilot",
    };
    const calls: [string, (deps: TerminalDeps) => Promise<unknown>][] = [
      ["status", (d) => platformTerminalStatus(d)],
      ["code", (d) => requestTerminalSaveCode(change, d)],
      [
        "save",
        (d) =>
          savePlatformTerminal(
            {
              terminalNumber: change.terminalNumber,
              enabled: true,
              apiKey: change.apiKey,
              apiPassword: change.apiPassword,
              clearCredentials: false,
              force: false,
              challengeId: CHALLENGE,
              code: "246813",
            },
            d,
          ),
      ],
      [
        "clear",
        (d) =>
          savePlatformTerminal(
            {
              terminalNumber: null,
              enabled: null,
              apiKey: null,
              apiPassword: null,
              clearCredentials: true,
              force: false,
              challengeId: CHALLENGE,
              code: "246813",
            },
            d,
          ),
      ],
      ["test", (d) => testPlatformTerminal(d)],
      ["payments", (d) => platformCardPaymentsList({ tenantId: null }, d)],
      ["unreturned", (d) => platformUnreturnedList(d)],
      ["resolve", (d) => resolvePlatformCardPayment({ attemptId: ATTEMPT, note: null }, d)],
    ];
    for (const [name, call] of calls) {
      const t = untouchable<TerminalDeps>({ paymentsEnv: PILOT });
      expect(await soonCode(() => call(t.deps)), name).toBe("soon");
      expect(t.touched, name).toEqual([]);
    }
  });

  it("return.ts: a platform return in the pilot is refused like on a non-platform host; the job's re-VERIFY is off", async () => {
    const r = untouchable<PlatformReturnDeps>({ paymentsEnv: PILOT });
    const raw = `Id=fake1&CCode=0&Amount=10&Order=${REFERENCE}&Sign=fake`;
    expect(
      await handlePlatformReturn({ provider: "max", raw, host: "platform.localhost" }, r.deps),
    ).toEqual({ location: "/", result: "refused", attemptId: null });
    expect(r.touched).toEqual([]);

    const again = untouchable<PlatformReturnDeps>({ paymentsEnv: PILOT });
    expect(
      await reverifyPlatformReturn(
        { attemptId: ATTEMPT, reference: REFERENCE, sha: "a".repeat(64), mode: "test" },
        again.deps,
      ),
    ).toEqual({ result: "off" });
    expect(again.touched).toEqual([]);
  });

  it("jobs.ts: in the pilot no VERIFY (even if the platform looked ready); the DB-only sweep, purge and claim run without error", async () => {
    const names: string[] = [];
    const reverify = vi.fn();
    const claimAlerts = vi.fn(async () => 0);
    const summary = await runPlatformPaymentJobs({
      jobsOn: () => true,
      ready: () => ({ ok: true, env: "demo" }),
      rpc: async (fn) => {
        names.push(fn);
        return { data: 0, error: null };
      },
      reverify,
      claimAlerts,
      log: { info: () => {}, warn: () => {}, error: () => {}, alert: () => {} },
      paymentsEnv: PILOT,
    });
    expect(names).toEqual(["platform_attempts_expire", "platform_payment_returns_purge"]);
    expect(reverify).not.toHaveBeenCalled();
    expect(claimAlerts).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({ pending: 0, paid: 0, review: 0, expired: 0, purged: 0, alerted: 0 });
  });
});

describe("P-5: the real server functions and the return route in the pilot — zero DB, zero Hyp", () => {
  type Fn = (ctx?: { data?: unknown }) => Promise<unknown>;
  const fn = (value: unknown) => value as Fn;

  it("pay.functions.ts: options answer 'soon'; payments and start are refused", async () => {
    expect(await fn(payFns.myBillingPayOptions)()).toMatchObject({ available: false, soon: true });
    expect(await soonCode(() => fn(payFns.myBillingPayments)())).toBe("soon");
    expect(await soonCode(() => fn(payFns.myBillingPayStart)({ data: { chargeId: CHARGE } }))).toBe(
      "soon",
    );
    expect(h.rpc).toEqual([]);
    expect(h.hyp).toBe(0);
    expect(h.other).toEqual([]);
  });

  it("pay-terminal.functions.ts: every server function is refused", async () => {
    const patch = {
      terminalNumber: "0010090001",
      apiKey: "FAKE_KEY_pilot",
      apiPassword: "FAKE_PASSWORD_pilot",
      enabled: true,
    };
    const cases: [string, () => Promise<unknown>][] = [
      ["status", () => fn(terminalFns.platformTerminalStatus)()],
      ["code", () => fn(terminalFns.platformTerminalRequestCode)({ data: { patch } })],
      [
        "save",
        () =>
          fn(terminalFns.platformTerminalSave)({
            data: { patch, challengeId: CHALLENGE, code: "246813" },
          }),
      ],
      [
        "clear",
        () =>
          fn(terminalFns.platformTerminalSave)({
            data: { patch: { clearCredentials: true }, challengeId: CHALLENGE, code: "246813" },
          }),
      ],
      ["test", () => fn(terminalFns.platformTerminalTest)()],
      ["payments", () => fn(terminalFns.platformCardPayments)({ data: { tenantId: null } })],
      ["unreturned", () => fn(terminalFns.platformUnreturnedAttempts)()],
      [
        "resolve",
        () =>
          fn(terminalFns.platformCardPaymentResolve)({ data: { attemptId: ATTEMPT, note: "x" } }),
      ],
    ];
    for (const [name, call] of cases) expect(await soonCode(call), name).toBe("soon");
    expect(h.rpc).toEqual([]);
    expect(h.hyp).toBe(0);
    expect(h.other).toEqual([]);
  });

  it("the return route: 404 like a non-platform host, before the host check — nothing recorded", async () => {
    const { Route: ReturnRoute } = (await import(/* @vite-ignore */ RETURN_ROUTE)) as {
      Route: unknown;
    };
    const route = ReturnRoute as unknown as {
      server: {
        handlers: {
          GET: (ctx: { request: Request; params: { provider: string } }) => Promise<Response>;
        };
      };
    };
    const response = await route.server.handlers.GET({
      request: new Request(
        `http://platform.localhost/platform/payments/return/max?Id=fake1&CCode=0&Order=${REFERENCE}&Sign=fake`,
      ),
      params: { provider: "max" },
    });
    expect(response.status).toBe(404);
    expect(h.rpc).toEqual([]);
    expect(h.hyp).toBe(0);
    expect(h.other).toEqual([]);
  });

  it("outside the pilot the same server functions are not gated (they reach the session / DB as before)", async () => {
    h.env = "demo";
    await fn(payFns.myBillingPayOptions)().catch(() => undefined);
    expect(h.rpc.length + h.other.length).toBeGreaterThan(0);
  });
});
