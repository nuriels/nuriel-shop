// MAX/Hyp DEMO — the environment guard (plan §6.1 ENV-1, ENV-3, ENV-7, ENV-9; Appendix D DM-ENV-1/3/7/9).
// Only fake values: random roots generated here, obviously fake host names, no Hyp request of any kind.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  HYP_ENDPOINT,
  PRODUCTION_PLATFORM_HOST,
  hypEndpoint,
  modeAllowed,
  paymentsEnv,
  paymentsReady,
  paymentsStartupLine,
  terminalAllowed,
} from "@/platform/payments/server/env";
import { platformSecretCipher, stepupKey } from "@/platform/payments/server/platform-keys";
import { tenantSecretCipher } from "@/platform/payments/server/tenant-keys";

const ROOT_VARS = ["PAYMENTS_SECRETS_KEY", "PLATFORM_TERMINAL_SECRETS_KEY"] as const;
/** the other secrets the app reads (env.ts compares the roots with each of them) */
const APP_SECRETS = [
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
/** every variable env.ts reads (NODE_ENV is not one of them; tests set it explicitly to prove it) */
const ALL_VARS = [
  "PAYMENTS_ENV",
  "PLATFORM_ADMIN_HOST",
  "MAX_PAY_TEST_URL",
  ...ROOT_VARS,
  ...APP_SECRETS,
];
const REASONS = [
  "env",
  "root_missing",
  "root_short",
  "root_placeholder",
  "roots_equal",
  "root_reused",
];
const LINE =
  /^\[payments\] env=(demo|production|off:(unset|invalid|host_mismatch)) endpoint=(hyp|local-mock) tenant=(ready|off:[a-z_]+) platform=(ready|off:[a-z_]+)$/;

/** what the DEMO host generates: 64 hex characters */
const root = () => randomBytes(32).toString("hex");
const DEMO_HOST = "panel.demo-box.example";
const MOCK = "http://127.0.0.1:4010/hyp/p/";

type Vars = Record<string, string | undefined>;

function setEnv(vars: Vars) {
  for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
}
/** a DEMO instance with both roots in place */
function demo(extra: Vars = {}) {
  setEnv({
    PAYMENTS_ENV: "demo",
    PLATFORM_ADMIN_HOST: DEMO_HOST,
    PAYMENTS_SECRETS_KEY: root(),
    PLATFORM_TERMINAL_SECRETS_KEY: root(),
    ...extra,
  });
}

beforeEach(() => {
  for (const name of ALL_VARS) vi.stubEnv(name, undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("DM-ENV-1: PAYMENTS_ENV is required; production only on the production host", () => {
  it("DM-ENV-1: unset → payments off (both scopes), whatever NODE_ENV says", () => {
    setEnv({ PAYMENTS_SECRETS_KEY: root(), PLATFORM_TERMINAL_SECRETS_KEY: root() });
    for (const nodeEnv of ["production", "test", "development"]) {
      vi.stubEnv("NODE_ENV", nodeEnv);
      expect(paymentsEnv()).toBeNull();
      expect(paymentsReady("tenant")).toEqual({ ok: false, reason: "env" });
      expect(paymentsReady("platform")).toEqual({ ok: false, reason: "env" });
    }
  });

  it("DM-ENV-1: only the exact values demo / production count", () => {
    setEnv({ PLATFORM_ADMIN_HOST: DEMO_HOST });
    for (const value of ["", " ", "DEMO", "Demo", "prod", "staging", "test", "live", "1", "true"]) {
      vi.stubEnv("PAYMENTS_ENV", value);
      expect(paymentsEnv(), value).toBeNull();
    }
    vi.stubEnv("PAYMENTS_ENV", " demo ");
    expect(paymentsEnv()).toBe("demo");
  });

  it("DM-ENV-1: demo on a non-production host; refused on the production host (any spelling of it)", () => {
    setEnv({ PAYMENTS_ENV: "demo" });
    for (const host of [DEMO_HOST, "localhost", "nuriel.localhost", "nuriel.nuri1.fit.example"]) {
      vi.stubEnv("PLATFORM_ADMIN_HOST", host);
      expect(paymentsEnv(), host).toBe("demo");
    }
    vi.stubEnv("PLATFORM_ADMIN_HOST", undefined);
    expect(paymentsEnv()).toBe("demo");
    for (const host of [PRODUCTION_PLATFORM_HOST, " NURIEL.NURI1.FIT ", "nuriel.nuri1.fit."]) {
      vi.stubEnv("PLATFORM_ADMIN_HOST", host);
      expect(paymentsEnv(), host).toBeNull();
    }
  });

  it("DM-ENV-1: production only when PLATFORM_ADMIN_HOST is the production constant", () => {
    expect(PRODUCTION_PLATFORM_HOST).toBe("nuriel.nuri1.fit");
    setEnv({ PAYMENTS_ENV: "production" });
    vi.stubEnv("PLATFORM_ADMIN_HOST", ` ${PRODUCTION_PLATFORM_HOST.toUpperCase()} `);
    expect(paymentsEnv()).toBe("production");
    for (const host of [undefined, "", DEMO_HOST, "localhost", "nuri1.fit", "x.nuriel.nuri1.fit"]) {
      vi.stubEnv("PLATFORM_ADMIN_HOST", host);
      expect(paymentsEnv(), String(host)).toBeNull();
    }
  });

  it("DM-ENV-1: paymentsReady carries the environment it checked", () => {
    demo();
    expect(paymentsReady("tenant")).toEqual({ ok: true, env: "demo" });
    expect(paymentsReady("platform")).toEqual({ ok: true, env: "demo" });
    setEnv({ PAYMENTS_ENV: "production", PLATFORM_ADMIN_HOST: PRODUCTION_PLATFORM_HOST });
    expect(paymentsReady("tenant")).toEqual({ ok: true, env: "production" });
  });
});

describe("DM-ENV-3 (environment part): DEMO = test with 00100…, production = live only", () => {
  // terminal numbers are built here from parts: no 10-digit terminal literal in the repository
  const demoTerminal = `00100${"00042"}`;
  const liveShaped = `${"77"}${"12345678"}`;

  it("DM-ENV-3: one mode per environment", () => {
    expect(modeAllowed("demo", "test")).toBe(true);
    expect(modeAllowed("demo", "live")).toBe(false);
    expect(modeAllowed("production", "live")).toBe(true);
    expect(modeAllowed("production", "test")).toBe(false);
  });

  it("DM-ENV-3: the 00100 tripwire in both directions (10 digits only)", () => {
    expect(terminalAllowed("demo", demoTerminal)).toBe(true);
    expect(terminalAllowed("demo", liveShaped)).toBe(false);
    expect(terminalAllowed("production", liveShaped)).toBe(true);
    expect(terminalAllowed("production", demoTerminal)).toBe(false);
    for (const bad of [
      "",
      "00100",
      `${demoTerminal}0`,
      `0${liveShaped.slice(1, 9)}`,
      "00100abcde",
    ]) {
      expect(terminalAllowed("demo", bad), bad).toBe(false);
      expect(terminalAllowed("production", bad), bad).toBe(false);
    }
  });

  it("DM-ENV-3: the key modules refuse a mode the environment does not allow (no key for live in DEMO)", () => {
    demo();
    expect(() => tenantSecretCipher("demo", "live")).toThrowError(
      "payments: tenant key unavailable",
    );
    expect(() => tenantSecretCipher("production", "test")).toThrowError(
      "payments: tenant key unavailable",
    );
    expect(() => platformSecretCipher("demo", "live")).toThrowError(
      "payments: platform key unavailable",
    );
    expect(() => platformSecretCipher("production", "test")).toThrowError(
      "payments: platform key unavailable",
    );
    expect(tenantSecretCipher("demo", "test").kid).toMatch(/^[0-9a-f]{8}$/);
    expect(platformSecretCipher("production", "live").kid).toMatch(/^[0-9a-f]{8}$/);
    // modeAllowed (env.ts) and the inline rule of the key modules agree on every pair
    for (const env of ["demo", "production"] as const) {
      for (const mode of ["test", "live"] as const) {
        let built = true;
        try {
          tenantSecretCipher(env, mode);
          platformSecretCipher(env, mode);
        } catch {
          built = false;
        }
        expect(built, `${env}/${mode}`).toBe(modeAllowed(env, mode));
      }
    }
  });
});

describe("DM-ENV-7: the Hyp address is a constant; the mock override is local-only", () => {
  it("DM-ENV-7: the constant, and no override by default", () => {
    expect(HYP_ENDPOINT).toBe("https://pay.hyp.co.il/p/");
    expect(hypEndpoint()).toBe(HYP_ENDPOINT);
    setEnv({ PLATFORM_ADMIN_HOST: "localhost" });
    expect(hypEndpoint()).toBe(HYP_ENDPOINT);
  });

  it("DM-ENV-7: honoured only for 127.0.0.1 / localhost on a localhost / *.localhost platform host", () => {
    setEnv({ MAX_PAY_TEST_URL: MOCK });
    for (const host of ["localhost", "nuriel.localhost", " NURIEL.LOCALHOST "]) {
      vi.stubEnv("PLATFORM_ADMIN_HOST", host);
      expect(hypEndpoint(), host).toBe(MOCK);
    }
    vi.stubEnv("MAX_PAY_TEST_URL", "http://localhost:4010");
    expect(hypEndpoint()).toBe("http://localhost:4010");
    vi.stubEnv("MAX_PAY_TEST_URL", "https://127.0.0.1:8443/p/");
    expect(hypEndpoint()).toBe("https://127.0.0.1:8443/p/");
    vi.stubEnv("MAX_PAY_TEST_URL", MOCK);
    for (const host of [
      undefined,
      DEMO_HOST,
      PRODUCTION_PLATFORM_HOST,
      "127.0.0.1",
      "localhost.example",
      "notlocalhost",
      "localhost.nuri1.fit",
    ]) {
      vi.stubEnv("PLATFORM_ADMIN_HOST", host);
      expect(hypEndpoint(), String(host)).toBe(HYP_ENDPOINT);
    }
  });

  it("DM-ENV-7: any other address is ignored, even on a local platform host", () => {
    setEnv({ PLATFORM_ADMIN_HOST: "localhost" });
    for (const url of [
      "http://10.0.0.5:4010/",
      "http://127.0.0.2/",
      "http://[::1]:4010/",
      "http://127.0.0.1.nip.io/",
      "http://localhost.example/",
      "http://localhost@evil.example/",
      "http://user:pw@127.0.0.1/",
      "http://evil.example/?h=127.0.0.1",
      "http://127.0.0.1:4010/p/?x=1",
      "http://127.0.0.1:4010/#frag",
      "http://127.0.0.1:99999/",
      "ftp://127.0.0.1/",
      "file:///etc/hosts",
      "javascript:alert(1)",
      HYP_ENDPOINT,
      "",
    ]) {
      vi.stubEnv("MAX_PAY_TEST_URL", url);
      expect(hypEndpoint(), url).toBe(HYP_ENDPOINT);
    }
  });

  it("DM-ENV-7: NODE_ENV plays no part, and the hook is never forwarded by docker-compose.yml", () => {
    setEnv({ MAX_PAY_TEST_URL: MOCK, PLATFORM_ADMIN_HOST: DEMO_HOST, NODE_ENV: "test" });
    expect(hypEndpoint()).toBe(HYP_ENDPOINT);
    vi.stubEnv("PLATFORM_ADMIN_HOST", "localhost");
    vi.stubEnv("NODE_ENV", "production");
    expect(hypEndpoint()).toBe(MOCK);
    const compose = readFileSync(join(process.cwd(), "docker-compose.yml"), "utf8");
    expect(compose).not.toMatch(/MAX_PAY_TEST_URL/);
  });
});

describe("DM-ENV-9: root secret sanity at start (length, placeholders, reuse, no fallback)", () => {
  it("DM-ENV-9: missing or shorter than 32 characters → refused; 32 random characters → ready", () => {
    demo({ PAYMENTS_SECRETS_KEY: undefined, PLATFORM_TERMINAL_SECRETS_KEY: "   " });
    expect(paymentsReady("tenant")).toEqual({ ok: false, reason: "root_missing" });
    expect(paymentsReady("platform")).toEqual({ ok: false, reason: "root_missing" });
    const r32 = randomBytes(24).toString("base64url");
    expect(r32).toHaveLength(32);
    vi.stubEnv("PAYMENTS_SECRETS_KEY", r32.slice(0, 31));
    expect(paymentsReady("tenant")).toEqual({ ok: false, reason: "root_short" });
    vi.stubEnv("PAYMENTS_SECRETS_KEY", r32);
    expect(paymentsReady("tenant")).toEqual({ ok: true, env: "demo" });
  });

  it("DM-ENV-9: placeholders and trivial values are refused", () => {
    demo();
    const placeholders = [
      "changeme-changeme-changeme-changeme",
      "please-replace-me-with-a-real-random-value",
      "your-secret-here-0123456789abcdef0123",
      "x".repeat(40),
      "0".repeat(64),
      "ab".repeat(20),
      "0123456789abcdef".repeat(4),
      "0123456789".repeat(4),
      "PAYMENTS-DEFAULT-KEY-2026-0000-1111-2222",
      `example-${root()}`,
    ];
    for (const value of placeholders) {
      vi.stubEnv("PAYMENTS_SECRETS_KEY", value);
      expect(paymentsReady("tenant").ok, value.slice(0, 12)).toBe(false);
      expect(paymentsReady("tenant")).toMatchObject({ reason: "root_placeholder" });
    }
  });

  it("DM-ENV-9: a fixed secret of e2e/scripts/app-up.sh is never accepted as a root (MX-19)", () => {
    const script = readFileSync(join(process.cwd(), "e2e/scripts/app-up.sh"), "utf8");
    const fixtures = [...APP_SECRETS, ...ROOT_VARS].flatMap((name) => {
      const m = new RegExp(`(?:^|\\s)${name}=([^\\s"'$\`]+)`, "m").exec(script);
      return m && m[1]!.length >= 32 ? [{ name, value: m[1]! }] : [];
    });
    expect(fixtures.length).toBeGreaterThanOrEqual(1); // LICENSE_KEYS_SECRET and GROW_SECRETS_KEY today
    for (const { name, value } of fixtures) {
      demo({ PAYMENTS_SECRETS_KEY: value });
      // refused by the deny-list itself (the variable is not set in this instance)
      expect(paymentsReady("tenant"), name).toEqual({ ok: false, reason: "root_placeholder" });
    }
  });

  it("DM-ENV-9: the two roots must differ (both scopes refuse)", () => {
    const shared = root();
    demo({ PAYMENTS_SECRETS_KEY: shared, PLATFORM_TERMINAL_SECRETS_KEY: ` ${shared} ` });
    expect(paymentsReady("tenant")).toEqual({ ok: false, reason: "roots_equal" });
    expect(paymentsReady("platform")).toEqual({ ok: false, reason: "roots_equal" });
  });

  it("DM-ENV-9: a root equal to any other secret of the app is refused", () => {
    for (const name of APP_SECRETS) {
      vi.unstubAllEnvs();
      for (const v of ALL_VARS) vi.stubEnv(v, undefined);
      const value = root();
      demo({ PAYMENTS_SECRETS_KEY: value, [name]: value });
      expect(paymentsReady("tenant"), name).toEqual({ ok: false, reason: "root_reused" });
      expect(paymentsReady("platform"), name).toEqual({ ok: true, env: "demo" });
      vi.stubEnv("PLATFORM_TERMINAL_SECRETS_KEY", value);
      vi.stubEnv("PAYMENTS_SECRETS_KEY", root());
      expect(paymentsReady("platform"), name).toEqual({ ok: false, reason: "root_reused" });
    }
  });

  it("DM-ENV-9: no fallback — other secrets never stand in for a missing root", () => {
    demo({ PAYMENTS_SECRETS_KEY: undefined, PLATFORM_TERMINAL_SECRETS_KEY: undefined });
    for (const name of APP_SECRETS) vi.stubEnv(name, root());
    expect(paymentsReady("tenant")).toEqual({ ok: false, reason: "root_missing" });
    expect(paymentsReady("platform")).toEqual({ ok: false, reason: "root_missing" });
    expect(() => tenantSecretCipher("demo", "test")).toThrowError(
      "payments: tenant key unavailable",
    );
    expect(() => platformSecretCipher("demo", "test")).toThrowError(
      "payments: platform key unavailable",
    );
    expect(() => stepupKey("demo")).toThrowError("payments: platform key unavailable");
  });

  it("DM-ENV-9: every refusal is a fixed lower-case code", () => {
    const seen = new Set<string>();
    const scenarios: Vars[] = [
      {},
      { PAYMENTS_ENV: "demo", PLATFORM_ADMIN_HOST: DEMO_HOST },
      { PAYMENTS_ENV: "demo", PAYMENTS_SECRETS_KEY: "short" },
      { PAYMENTS_ENV: "demo", PAYMENTS_SECRETS_KEY: "y".repeat(40) },
      { PAYMENTS_ENV: "demo", PAYMENTS_SECRETS_KEY: "a1b2c3d4".repeat(5) },
    ];
    for (const s of scenarios) {
      vi.unstubAllEnvs();
      for (const v of ALL_VARS) vi.stubEnv(v, undefined);
      setEnv(s);
      for (const scope of ["tenant", "platform"] as const) {
        const r = paymentsReady(scope);
        if (!r.ok) seen.add(r.reason);
      }
    }
    for (const reason of seen) expect(REASONS).toContain(reason);
    expect([...seen].sort()).toEqual(["env", "root_missing", "root_placeholder", "root_short"]);
  });
});

describe("paymentsStartupLine (DM-ENV-1 / DM-ENV-7 / DM-ENV-9): one value-free line", () => {
  it("DM-ENV-1: the env part for every case", () => {
    expect(paymentsStartupLine()).toBe(
      "[payments] env=off:unset endpoint=hyp tenant=off:env platform=off:env",
    );
    setEnv({ PAYMENTS_ENV: "staging", PLATFORM_ADMIN_HOST: DEMO_HOST });
    expect(paymentsStartupLine()).toBe(
      "[payments] env=off:invalid endpoint=hyp tenant=off:env platform=off:env",
    );
    vi.stubEnv("PAYMENTS_ENV", "production");
    expect(paymentsStartupLine()).toBe(
      "[payments] env=off:host_mismatch endpoint=hyp tenant=off:env platform=off:env",
    );
    setEnv({ PAYMENTS_ENV: "demo", PLATFORM_ADMIN_HOST: PRODUCTION_PLATFORM_HOST });
    expect(paymentsStartupLine()).toBe(
      "[payments] env=off:host_mismatch endpoint=hyp tenant=off:env platform=off:env",
    );
    demo({ PLATFORM_TERMINAL_SECRETS_KEY: undefined });
    expect(paymentsStartupLine()).toBe(
      "[payments] env=demo endpoint=hyp tenant=ready platform=off:root_missing",
    );
    setEnv({ PAYMENTS_ENV: "production", PLATFORM_ADMIN_HOST: PRODUCTION_PLATFORM_HOST });
    vi.stubEnv("PLATFORM_TERMINAL_SECRETS_KEY", root());
    expect(paymentsStartupLine()).toBe(
      "[payments] env=production endpoint=hyp tenant=ready platform=ready",
    );
    expect(paymentsStartupLine()).toMatch(LINE);
  });

  it("DM-ENV-7: endpoint=local-mock only when the override is honoured (local platform host)", () => {
    demo({ MAX_PAY_TEST_URL: MOCK });
    expect(paymentsStartupLine()).toContain(" endpoint=hyp ");
    vi.stubEnv("PLATFORM_ADMIN_HOST", "nuriel.localhost");
    expect(paymentsStartupLine()).toBe(
      "[payments] env=demo endpoint=local-mock tenant=ready platform=ready",
    );
    vi.stubEnv("MAX_PAY_TEST_URL", "http://10.0.0.5:4010/");
    expect(paymentsStartupLine()).toContain(" endpoint=hyp ");
  });

  it("DM-ENV-9: the scope parts use the paymentsReady codes", () => {
    const shared = root();
    demo({ PAYMENTS_SECRETS_KEY: shared, PLATFORM_TERMINAL_SECRETS_KEY: shared });
    expect(paymentsStartupLine()).toBe(
      "[payments] env=demo endpoint=hyp tenant=off:roots_equal platform=off:roots_equal",
    );
    demo({ PAYMENTS_SECRETS_KEY: "short", SUPABASE_SERVICE_ROLE_KEY: shared });
    vi.stubEnv("PLATFORM_TERMINAL_SECRETS_KEY", shared);
    expect(paymentsStartupLine()).toBe(
      "[payments] env=demo endpoint=hyp tenant=off:root_short platform=off:root_reused",
    );
  });

  it("DM-ENV-9: no value of any variable ever appears in the line (canaries in every variable)", () => {
    const tag = () => `cnry${randomBytes(10).toString("hex")}`;
    const scenarios = [
      // everything a canary (PAYMENTS_ENV invalid)
      () => Object.fromEntries(ALL_VARS.map((v) => [v, tag()])),
      // a working DEMO with canary roots, a canary local host and a canary mock path
      () => ({
        PAYMENTS_ENV: "demo",
        PLATFORM_ADMIN_HOST: `${tag()}.localhost`,
        MAX_PAY_TEST_URL: `http://127.0.0.1:4010/${tag()}`,
        PAYMENTS_SECRETS_KEY: `${tag()}${root()}`,
        PLATFORM_TERMINAL_SECRETS_KEY: `${tag()}${root()}`,
        ...Object.fromEntries(APP_SECRETS.map((v) => [v, tag()])),
      }),
      // production on a canary host; roots equal to another secret
      () => {
        const reused = `${tag()}${root()}`;
        return {
          PAYMENTS_ENV: "production",
          PLATFORM_ADMIN_HOST: `${tag()}.example`,
          PAYMENTS_SECRETS_KEY: reused,
          SUPABASE_SERVICE_ROLE_KEY: reused,
          PLATFORM_TERMINAL_SECRETS_KEY: tag(),
        };
      },
    ];
    for (const make of scenarios) {
      vi.unstubAllEnvs();
      for (const v of ALL_VARS) vi.stubEnv(v, undefined);
      const vars: Vars = make();
      setEnv(vars);
      const line = paymentsStartupLine();
      expect(line).toMatch(LINE);
      const canaries = Object.values(vars).filter((v): v is string => !!v && v.includes("cnry"));
      expect(canaries.length).toBeGreaterThanOrEqual(3);
      for (const value of canaries) {
        expect(line.includes(value)).toBe(false);
        // not even a fragment: every 8-character slice of every value
        for (let i = 0; i + 8 <= value.length; i += 4) {
          expect(line.includes(value.slice(i, i + 8))).toBe(false);
        }
      }
      expect(line).not.toMatch(/cnry|127\.0\.0\.1|localhost|example|nuri1/);
    }
  });
});
