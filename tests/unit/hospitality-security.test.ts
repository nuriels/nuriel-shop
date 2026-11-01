// אבטחה לפני פתיחה לציבור (D1): כתובת ה-IP רק ממקור אמין, מגבלות הקצב, אתגר ה-CAPTCHA (הוכחת
// עבודה — הנפקה, פתרון, בדיקה), שכבת ההגנה של בקשת הזמנה (מלכודת → אתגר → מונה משותף במסד),
// וכותרות האבטחה של העמודים.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  clientIp,
  expandIpv6,
  ipNetwork,
  ipSubject,
  normalizeIp,
} from "@/engines/hospitality/security/client-ip";
import { LIMITS, tooManyMessage } from "@/engines/hospitality/security/limits";
import { BOT_REJECTED, CAPTCHA_RETRY } from "@/engines/hospitality/security/messages";
import {
  isPowChallenge,
  parsePowSolution,
  parseSalt,
  solvePow,
  type PowSolution,
} from "@/engines/hospitality/security/pow";
import {
  issuePow,
  POW_MIN_SECONDS,
  POW_TTL_SECONDS,
  verifyPow,
} from "@/engines/hospitality/security/captcha.server";
import { hmac, safeEqual } from "@/engines/hospitality/security/secret.server";
import {
  MANAGE_SECURITY_HEADERS,
  SITE_SECURITY_HEADERS,
} from "@/engines/hospitality/security/headers";

const SITE = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const T0 = Date.UTC(2026, 10, 1, 10, 0, 0);

beforeAll(() => {
  process.env["HOSPITALITY_SECRET"] = "unit-test-hospitality-secret-0123456789abcdef";
  process.env["HOSPITALITY_POW_MAX"] = "2000";
});

const headers = (h: Record<string, string>) => new Headers(h);

describe("client IP: only from a source our proxy controls", () => {
  it("prefers X-Real-IP (rewritten by Nginx on every request)", () => {
    expect(
      clientIp(
        headers({ "x-real-ip": "198.51.100.7", "x-forwarded-for": "1.1.1.1, 198.51.100.7" }),
      ),
    ).toBe("198.51.100.7");
  });

  it("without X-Real-IP: the LAST X-Forwarded-For hop — a spoofed first value is ignored", () => {
    expect(clientIp(headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(headers({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("garbage is never an address", () => {
    expect(clientIp(headers({ "x-real-ip": "evil.example" }))).toBe("unknown");
    expect(clientIp(headers({ "x-forwarded-for": "1.2.3.4, not-an-ip" }))).toBe("unknown");
    expect(clientIp(headers({}))).toBe("unknown");
    expect(normalizeIp("999.1.1.1")).toBeNull();
    expect(normalizeIp("1.2.3")).toBeNull();
    expect(normalizeIp("1:2:3:4:5:6:7:8:9")).toBeNull();
    expect(normalizeIp("1::2::3")).toBeNull();
  });

  it("normalises ports, brackets, IPv4-mapped IPv6 and IPv6 spelling", () => {
    expect(normalizeIp("203.0.113.9:51234")).toBe("203.0.113.9");
    expect(normalizeIp("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(normalizeIp("[2001:DB8::1]:443")).toBe("2001:0db8:0000:0000:0000:0000:0000:0001");
    expect(expandIpv6("::")).toEqual(Array(8).fill("0000"));
    expect(normalizeIp("2001:db8:0:0:0:0:0:1")).toBe(normalizeIp("2001:db8::1"));
  });

  it("IPv6 is limited per /64 (one customer's whole prefix), IPv4 per address; networks /24 and /64", () => {
    const a = normalizeIp("2001:db8:abcd:12::1")!;
    const b = normalizeIp("2001:db8:abcd:12:ffff::9")!;
    expect(ipSubject(a)).toBe(ipSubject(b));
    expect(ipSubject(a)).toBe("2001:0db8:abcd:0012::/64");
    expect(ipSubject("203.0.113.9")).toBe("203.0.113.9");
    expect(ipNetwork("203.0.113.9")).toBe("203.0.113.0/24");
    expect(ipNetwork("unknown")).toBe("unknown");
  });
});

describe("rate limits (shared by all app servers)", () => {
  it("every rule is valid for the database (1–1,000,000 hits, window up to a day)", () => {
    for (const [action, rules] of Object.entries(LIMITS)) {
      expect(rules.length, action).toBeGreaterThan(0);
      expect(rules.length, action).toBeLessThanOrEqual(7); // + "challenge already used" ≤ 8
      for (const r of rules) {
        expect(r.limit, action).toBeGreaterThanOrEqual(1);
        expect(r.window, action).toBeGreaterThanOrEqual(1);
        expect(r.window, action).toBeLessThanOrEqual(86400);
      }
    }
  });

  it("a booking request is limited per address, network and the whole business", () => {
    const per = LIMITS.request.map((r) => r.per);
    expect(per).toEqual(expect.arrayContaining(["ip", "net", "tenant"]));
    expect(
      Math.min(...LIMITS.request.filter((r) => r.per === "ip").map((r) => r.limit)),
    ).toBeLessThanOrEqual(6);
  });

  it("the message says when to try again, without details", () => {
    expect(tooManyMessage(30)).toContain("דקה");
    expect(tooManyMessage(600)).toContain("10 דקות");
    expect(tooManyMessage(7200)).toBe("יותר מדי בקשות — נסו שוב מאוחר יותר");
  });
});

describe("secrets", () => {
  it("HMAC per purpose: stable, different between labels, never the raw input", async () => {
    const a = await hmac("rate", "request|ip|600|203.0.113.9");
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await hmac("rate", "request|ip|600|203.0.113.9")).toBe(a);
    expect(await hmac("pow", "request|ip|600|203.0.113.9")).not.toBe(a);
    expect(a).not.toContain("203");
    expect(safeEqual(a, a)).toBe(true);
    expect(safeEqual(a, `${a.slice(0, -1)}x`)).toBe(false);
    expect(safeEqual(a, a.slice(1))).toBe(false);
  });
});

describe("CAPTCHA: proof of work (no third party, no cookie, nothing to solve for a person)", () => {
  async function solved(tenant = SITE, now = T0): Promise<PowSolution> {
    const challenge = await issuePow(tenant, "request", { now });
    expect(isPowChallenge(challenge)).toBe(true);
    expect(challenge.maxnumber).toBe(2000);
    const solution = await solvePow(challenge, { batch: 250 });
    expect(solution).not.toBeNull();
    return solution!;
  }
  const later = (s: number) => T0 + s * 1000;

  it("a solved challenge passes — after the minimum time, before it expires", async () => {
    const s = await solved();
    expect(await verifyPow(s, SITE, "request", { now: later(POW_MIN_SECONDS + 1) })).toBe("ok");
    expect(await verifyPow(s, SITE, "request", { now: later(POW_TTL_SECONDS - 5) })).toBe("ok");
  });

  it("refuses: too fast (a script), expired, another business, a wrong number, a forged signature", async () => {
    const s = await solved();
    const ok = later(10);
    expect(await verifyPow(s, SITE, "request", { now: later(0) })).toBe("too-fast");
    expect(await verifyPow(s, SITE, "request", { now: later(POW_TTL_SECONDS + 1) })).toBe(
      "expired",
    );
    expect(await verifyPow(s, OTHER, "request", { now: ok })).toBe("invalid");
    expect(await verifyPow({ ...s, number: s.number + 1 }, SITE, "request", { now: ok })).toBe(
      "invalid",
    );
    const forged = `${s.signature.slice(0, -2)}${s.signature.endsWith("AA") ? "BB" : "AA"}`;
    expect(await verifyPow({ ...s, signature: forged }, SITE, "request", { now: ok })).toBe(
      "invalid",
    );
    expect(await verifyPow(null, SITE, "request", { now: ok })).toBe("missing");
  });

  it("a longer validity written into the salt breaks the signed hash", async () => {
    const s = await solved();
    const info = parseSalt(s.salt)!;
    const longer = s.salt.replace(`.${info.expires}.`, `.${info.expires + 86400}.`);
    expect(await verifyPow({ ...s, salt: longer }, SITE, "request", { now: later(10) })).toBe(
      "invalid",
    );
  });

  it("a signature from another secret (another installation) is refused", async () => {
    const s = await solved();
    process.env["HOSPITALITY_SECRET"] = "another-installation-secret-0123456789";
    try {
      expect(await verifyPow(s, SITE, "request", { now: later(10) })).toBe("invalid");
    } finally {
      process.env["HOSPITALITY_SECRET"] = "unit-test-hospitality-secret-0123456789abcdef";
    }
  });

  it("the difficulty grows for an address that asks for many challenges (capped)", async () => {
    expect((await issuePow(SITE, "request", { difficulty: 4 })).maxnumber).toBe(8000);
    expect((await issuePow(SITE, "request", { difficulty: 1e9 })).maxnumber).toBe(2_000_000);
  });

  it("the browser's answer is shape-checked before anything else", () => {
    expect(parsePowSolution(null)).toBeNull();
    expect(parsePowSolution({ algorithm: "MD5" })).toBeNull();
    expect(
      parsePowSolution({
        algorithm: "SHA-256",
        challenge: "a".repeat(64),
        salt: "v1.x",
        number: 1,
        signature: "s".repeat(43),
      }),
    ).toBeNull();
    expect(
      parsePowSolution({
        algorithm: "SHA-256",
        challenge: "a".repeat(64),
        salt: `v1.${"0".repeat(32)}.1793527200.1793529000.request.abcdefgh12345678`,
        number: -1,
        signature: "s".repeat(43),
      }),
    ).toBeNull();
  });

  it("a stopped search returns nothing (the form was left)", async () => {
    const c = await issuePow(SITE, "request", { now: T0, secretNumber: 1999 });
    const ac = new AbortController();
    ac.abort();
    expect(await solvePow(c, { signal: ac.signal })).toBeNull();
  });
});

describe("booking request guard: trap → challenge → one shared database call", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockRateCheck(
    reply: (rules: { key: string; limit: number; window: number }[]) => unknown,
  ) {
    const calls: { key: string; limit: number; window: number }[][] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      expect(String(url)).toContain("/rest/v1/rpc/rate_check");
      const rules = JSON.parse(String(init?.body))._rules;
      calls.push(rules);
      return new Response(JSON.stringify(reply(rules)), { status: 200 });
    });
    return calls;
  }

  async function freshSolution(): Promise<PowSolution> {
    // the guard checks against the real clock: a challenge issued 10 seconds ago
    const c = await issuePow(SITE, "request", { now: Date.now() - 10_000 });
    return (await solvePow(c))!;
  }

  it("the trap field (filled by bots) is refused before anything reaches the database", async () => {
    const { guardBookingRequest } = await import("@/engines/hospitality/security/guard.server");
    const calls = mockRateCheck(() => ({ allowed: true, retry_after: 0, hits: [] }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      guardBookingRequest(SITE, { captcha: await freshSolution(), trap: "http://spam.example" }),
    ).rejects.toThrow(BOT_REJECTED);
    expect(calls).toHaveLength(0);
  });

  it("no / bad challenge → 'try again' (the form fetches a new one), nothing counted", async () => {
    const { guardBookingRequest } = await import("@/engines/hospitality/security/guard.server");
    const calls = mockRateCheck(() => ({ allowed: true, retry_after: 0, hits: [] }));
    await expect(guardBookingRequest(SITE, { captcha: null, trap: "" })).rejects.toThrow(
      CAPTCHA_RETRY,
    );
    const s = await freshSolution();
    await expect(guardBookingRequest(OTHER, { captcha: s, trap: "" })).rejects.toThrow(
      CAPTCHA_RETRY,
    );
    expect(calls).toHaveLength(0);
  });

  it("a valid request: the business limits + 'challenge used once' in ONE call; then allowed", async () => {
    const { guardBookingRequest } = await import("@/engines/hospitality/security/guard.server");
    const calls = mockRateCheck((rules) => ({
      allowed: true,
      retry_after: 0,
      hits: rules.map(() => 1),
    }));
    await expect(
      guardBookingRequest(SITE, { captcha: await freshSolution(), trap: "" }),
    ).resolves.toEqual(expect.objectContaining({ ip: "unknown" }));
    expect(calls).toHaveLength(1);
    const rules = calls[0]!;
    // without a request (unit test) there is no IP: only the business rules + the one-time challenge
    expect(rules).toHaveLength(LIMITS.request.filter((r) => r.per === "tenant").length + 1);
    expect(rules.at(-1)!.limit).toBe(1);
    for (const r of rules) expect(r.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(rules)).not.toContain(SITE);
  });

  it("the same solved challenge twice → refused as 'try again'", async () => {
    const { guardBookingRequest } = await import("@/engines/hospitality/security/guard.server");
    mockRateCheck((rules) => ({
      allowed: false,
      retry_after: 1700,
      hits: rules.map((_, i) => (i === rules.length - 1 ? 2 : 1)),
    }));
    await expect(
      guardBookingRequest(SITE, { captcha: await freshSolution(), trap: "" }),
    ).rejects.toThrow(CAPTCHA_RETRY);
  });

  it("over the limit → 'too many requests' with the wait time", async () => {
    const { guardBookingRequest } = await import("@/engines/hospitality/security/guard.server");
    mockRateCheck((rules) => ({
      allowed: false,
      retry_after: 600,
      hits: rules.map((r, i) => (i === rules.length - 1 ? 1 : r.limit + 1)),
    }));
    await expect(
      guardBookingRequest(SITE, { captcha: await freshSolution(), trap: "" }),
    ).rejects.toThrow("יותר מדי בקשות — נסו שוב בעוד 10 דקות");
  });

  it("the database unreachable → the local (per-server) limit still applies", async () => {
    const { checkRules } = await import("@/engines/hospitality/security/rate-limit.server");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rule = { key: "x".repeat(43), limit: 2, window: 60 };
    expect((await checkRules([rule])).ok).toBe(true);
    expect((await checkRules([rule])).ok).toBe(true);
    expect((await checkRules([rule])).ok).toBe(false);
  });
});

describe("security headers on Hospitality pages", () => {
  it("public site: HSTS, nosniff, framing by the same site only, a safe CSP base", () => {
    expect(SITE_SECURITY_HEADERS["Strict-Transport-Security"]).toMatch(/max-age=\d{7,}/);
    expect(SITE_SECURITY_HEADERS["Strict-Transport-Security"]).not.toContain("includeSubDomains");
    expect(SITE_SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
    expect(SITE_SECURITY_HEADERS["X-Frame-Options"]).toBe("SAMEORIGIN");
    expect(SITE_SECURITY_HEADERS["Content-Security-Policy"]).toContain("frame-ancestors 'self'");
    expect(SITE_SECURITY_HEADERS["Content-Security-Policy"]).toContain("object-src 'none'");
    expect(SITE_SECURITY_HEADERS["Permissions-Policy"]).toContain("camera=()");
  });

  it("management: also no caching and no referrer to other sites", () => {
    expect(MANAGE_SECURITY_HEADERS["Cache-Control"]).toBe("private, no-store");
    expect(MANAGE_SECURITY_HEADERS["Referrer-Policy"]).toBe("same-origin");
    expect(MANAGE_SECURITY_HEADERS["Content-Security-Policy"]).toContain("frame-ancestors 'self'");
  });
});
