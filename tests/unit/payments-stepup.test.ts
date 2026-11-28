// MAX/Hyp DEMO — step-up for editing NURIEL's terminal (plan §4.3; Appendix D DM-SEP-6, the code part).
// The DB functions (platform_stepup_issue / platform_stepup_consume, migration 208) are emulated by a fake rpc
// that follows the contract: 10 minutes, at most 5 tries, single use, compares only HMACs (in constant time).
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createStepupService,
  stepupCodeHmac,
  stepupPurposeHash,
  type StepupRpc,
} from "@/platform/payments/server/stepup";

const key = () => randomBytes(32);
const HEX64 = /^[0-9a-f]{64}$/;

type Challenge = {
  actor: string;
  purpose: string;
  codeHmac: string;
  expires: number;
  tries: number;
  used: boolean;
};

/** a stand-in for migration 208's two functions; it stores only what the app sends (HMACs) */
function fakeDb(now = () => Date.now()) {
  const challenges = new Map<string, Challenge>();
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const equal = (a: string, b: string) =>
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const rpc: StepupRpc = async (fn, args) => {
    calls.push({ fn, args });
    if (fn === "platform_stepup_issue") {
      const id = randomUUID();
      const expires = now() + 10 * 60 * 1000;
      challenges.set(id, {
        actor: String(args["_actor"]),
        purpose: String(args["_purpose_hash"]),
        codeHmac: String(args["_code_hmac"]),
        expires,
        tries: 0,
        used: false,
      });
      return {
        data: { challenge_id: id, expires_at: new Date(expires).toISOString() },
        error: null,
      };
    }
    const c = challenges.get(String(args["_challenge"]));
    if (!c || !equal(c.actor, String(args["_actor"]))) {
      return { data: { ok: false, reason: "not_found" }, error: null };
    }
    if (c.used) return { data: { ok: false, reason: "used" }, error: null };
    if (now() > c.expires) return { data: { ok: false, reason: "expired" }, error: null };
    if (c.tries >= 5) return { data: { ok: false, reason: "too_many_tries" }, error: null };
    if (!equal(c.purpose, String(args["_purpose_hash"]))) {
      c.tries += 1;
      return { data: { ok: false, reason: "purpose_mismatch" }, error: null };
    }
    if (!equal(c.codeHmac, String(args["_code_hmac"]))) {
      c.tries += 1;
      return { data: { ok: false, reason: "wrong_code" }, error: null };
    }
    c.used = true;
    return { data: { ok: true, reason: null }, error: null };
  };
  return { rpc, calls, challenges };
}

const actor = randomUUID();
const change = {
  terminal: "fake-terminal",
  mode: "test",
  enabled: true,
  apiKey: "fake-k",
  apiPassword: "fake-p",
};

describe("stepupPurposeHash: one code approves exactly one change", () => {
  it("DM-SEP-6: hex HMAC, independent of key order, different for any other actor, purpose or value", () => {
    const h = stepupPurposeHash(actor, "platform_terminal_change", change);
    expect(h).toMatch(HEX64);
    const reordered = Object.fromEntries(Object.entries(change).reverse());
    expect(stepupPurposeHash(actor, "platform_terminal_change", reordered)).toBe(h);
    expect(stepupPurposeHash(actor.toUpperCase(), "platform_terminal_change", change)).toBe(h);
    expect(stepupPurposeHash(randomUUID(), "platform_terminal_change", change)).not.toBe(h);
    for (const variant of [
      { ...change, apiPassword: "fake-q" },
      { ...change, enabled: false },
      { ...change, mode: "live" },
      { ...change, extra: 1 },
      { terminal: change.terminal },
      { ...change, nested: { a: [1, 2] } },
    ]) {
      expect(stepupPurposeHash(actor, "platform_terminal_change", variant)).not.toBe(h);
    }
    const arr = stepupPurposeHash(actor, "platform_terminal_change", { a: [1, 2] });
    expect(stepupPurposeHash(actor, "platform_terminal_change", { a: [2, 1] })).not.toBe(arr);
    // undefined properties are dropped, as in JSON
    expect(
      stepupPurposeHash(actor, "platform_terminal_change", { ...change, gone: undefined }),
    ).toBe(h);
  });

  it("DM-SEP-6: refuses what is not plain JSON, an unknown purpose and a non-UUID actor", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    const bad: unknown[] = [
      undefined,
      new Date(0),
      new Map(),
      [undefined],
      Number.NaN,
      Infinity,
      BigInt(1),
      () => 1,
      Symbol("x"),
      cyclic,
      { big: "x".repeat(300 * 1024) },
    ];
    for (const payload of bad) {
      expect(() => stepupPurposeHash(actor, "platform_terminal_change", payload)).toThrowError(
        "payments: step-up input refused",
      );
    }
    expect(() =>
      stepupPurposeHash(actor, "refund" as unknown as "platform_terminal_change", change),
    ).toThrowError("payments: step-up input refused");
    expect(() => stepupPurposeHash("admin", "platform_terminal_change", change)).toThrowError(
      "payments: step-up input refused",
    );
  });
});

describe("stepupCodeHmac", () => {
  it("DM-SEP-6: HMAC-SHA256 of the seed and the 6-digit code with the step-up key", () => {
    const k = key();
    const mac = stepupCodeHmac(k, "seed", "012345");
    expect(mac).toMatch(HEX64);
    expect(stepupCodeHmac(k, "seed", "012345")).toBe(mac);
    expect(stepupCodeHmac(key(), "seed", "012345")).not.toBe(mac);
    expect(stepupCodeHmac(k, "seed2", "012345")).not.toBe(mac);
    expect(stepupCodeHmac(k, "seed", "012346")).not.toBe(mac);
    expect(mac).toBe(
      createHmac("sha256", k).update("nuriel/payments/v1/stepup/code\nseed\n012345").digest("hex"),
    );
    for (const code of ["12345", "1234567", "abcdef", " 12345", "12345 ", ""]) {
      expect(() => stepupCodeHmac(k, "seed", code), code).toThrowError(
        "payments: step-up input refused",
      );
    }
    expect(() => stepupCodeHmac(randomBytes(16), "seed", "012345")).toThrowError(
      "payments: step-up input refused",
    );
    expect(() => stepupCodeHmac(k, "", "012345")).toThrowError("payments: step-up input refused");
  });
});

describe("createStepupService through a fake DB caller", () => {
  it("DM-SEP-6: issue — a 6-digit code; the DB receives only keyed HMACs (never the code or the raw hash)", async () => {
    const db = fakeDb();
    const service = createStepupService(db.rpc, key());
    const purpose = stepupPurposeHash(actor, "platform_terminal_change", change);
    const issued = await service.issue(actor, purpose);
    expect(issued.code).toMatch(/^[0-9]{6}$/);
    expect(issued.challengeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(issued.expiresAt) - Date.now()).toBeGreaterThan(9 * 60 * 1000);
    expect(db.calls).toHaveLength(1);
    const { fn, args } = db.calls[0]!;
    expect(fn).toBe("platform_stepup_issue");
    expect(Object.keys(args).sort()).toEqual(["_actor", "_code_hmac", "_purpose_hash"]);
    expect(args["_actor"]).toBe(actor);
    expect(args["_code_hmac"]).toMatch(HEX64);
    expect(args["_purpose_hash"]).toMatch(HEX64);
    expect(args["_purpose_hash"]).not.toBe(purpose);
    for (const value of Object.values(args)) expect(value).not.toBe(issued.code);
    const stored = JSON.stringify([...db.challenges.values()]);
    expect(stored).not.toContain(purpose);
    expect(stored).not.toContain("fake-p");
  });

  it("DM-SEP-6: the right code approves once; a second use is refused (single use)", async () => {
    const db = fakeDb();
    const service = createStepupService(db.rpc, key());
    const purpose = stepupPurposeHash(actor, "platform_terminal_change", change);
    const { challengeId, code } = await service.issue(actor, purpose);
    expect(await service.consume(actor, challengeId, purpose, code)).toEqual({ ok: true });
    expect(await service.consume(actor, challengeId, purpose, code)).toEqual({
      ok: false,
      reason: "used",
    });
  });

  it("DM-SEP-6: purpose binding — the code does not approve another change, another admin or another key", async () => {
    const db = fakeDb();
    const k = key();
    const service = createStepupService(db.rpc, k);
    const purpose = stepupPurposeHash(actor, "platform_terminal_change", change);
    const { challengeId, code } = await service.issue(actor, purpose);
    const otherChange = stepupPurposeHash(actor, "platform_terminal_change", {
      ...change,
      apiKey: "fake-x",
    });
    expect(await service.consume(actor, challengeId, otherChange, code)).toEqual({
      ok: false,
      reason: "purpose_mismatch",
    });
    const otherAdmin = randomUUID();
    expect(
      await service.consume(
        otherAdmin,
        challengeId,
        stepupPurposeHash(otherAdmin, "platform_terminal_change", change),
        code,
      ),
    ).toEqual({ ok: false, reason: "not_found" });
    // another key (another environment or a rotated root): the HMACs no longer match
    const elsewhere = createStepupService(db.rpc, key());
    expect((await elsewhere.consume(actor, challengeId, purpose, code)).ok).toBe(false);
    // the code HMAC itself is bound to the purpose: same code, another purpose → another HMAC
    const seedA = `${actor}|${purpose}`;
    const seedB = `${actor}|${otherChange}`;
    expect(stepupCodeHmac(k, seedA, code)).not.toBe(stepupCodeHmac(k, seedB, code));
    // the untouched challenge still works with the right change and code
    expect(await service.consume(actor, challengeId, purpose, code)).toEqual({ ok: true });
  });

  it("DM-SEP-6: wrong codes count as tries; after 5 the right code is refused too", async () => {
    const db = fakeDb();
    const service = createStepupService(db.rpc, key());
    const purpose = stepupPurposeHash(actor, "platform_terminal_change", change);
    const { challengeId, code } = await service.issue(actor, purpose);
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, "0");
    for (let i = 0; i < 5; i++) {
      expect(await service.consume(actor, challengeId, purpose, wrong)).toEqual({
        ok: false,
        reason: "wrong_code",
      });
    }
    expect(await service.consume(actor, challengeId, purpose, code)).toEqual({
      ok: false,
      reason: "too_many_tries",
    });
  });

  it("DM-SEP-6: an expired challenge is refused", async () => {
    let clock = Date.now();
    const db = fakeDb(() => clock);
    const service = createStepupService(db.rpc, key());
    const purpose = stepupPurposeHash(actor, "platform_terminal_change", change);
    const { challengeId, code } = await service.issue(actor, purpose);
    clock += 10 * 60 * 1000 + 1;
    expect(await service.consume(actor, challengeId, purpose, code)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("DM-SEP-6: malformed input is refused without calling the DB", async () => {
    const db = fakeDb();
    const service = createStepupService(db.rpc, key());
    const purpose = stepupPurposeHash(actor, "platform_terminal_change", change);
    const challenge = randomUUID();
    for (const [a, c, p, code] of [
      ["admin", challenge, purpose, "123456"],
      [actor, "x", purpose, "123456"],
      [actor, challenge, "abc", "123456"],
      [actor, challenge, purpose, "12345"],
      [actor, challenge, purpose, "12345a"],
      [actor, challenge, purpose, ""],
    ] as const) {
      expect(await service.consume(a, c, p, code)).toEqual({ ok: false, reason: "invalid" });
    }
    await expect(service.issue("admin", purpose)).rejects.toThrowError(
      "payments: step-up input refused",
    );
    await expect(service.issue(actor, "not-a-hash")).rejects.toThrowError(
      "payments: step-up input refused",
    );
    expect(db.calls).toHaveLength(0);
    expect(() => createStepupService(db.rpc, randomBytes(8))).toThrowError(
      "payments: step-up input refused",
    );
  });

  it("DM-SEP-6: DB errors — issue throws one fixed error (no cause, no code); consume fails closed", async () => {
    const purpose = stepupPurposeHash(actor, "platform_terminal_change", change);
    const failing: StepupRpc[] = [
      async () => ({ data: null, error: { message: "permission denied for function" } }),
      async () => {
        throw new Error("network down");
      },
      async () => ({ data: { challenge_id: "nope", expires_at: "later" }, error: null }),
      async () => ({ data: "not json", error: null }),
    ];
    for (const rpc of failing) {
      const service = createStepupService(rpc, key());
      const error = await service.issue(actor, purpose).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("payments: step-up issue failed");
      expect((error as Error).cause).toBeUndefined();
      const result = await service.consume(actor, randomUUID(), purpose, "123456");
      expect(result.ok).toBe(false);
    }
    const unavailable = createStepupService(failing[0]!, key());
    expect(await unavailable.consume(actor, randomUUID(), purpose, "123456")).toEqual({
      ok: false,
      reason: "unavailable",
    });
    // a DB reason is passed on only as a short lower-case code
    const odd = createStepupService(
      async () => ({ data: { ok: false, reason: "Wrong code!" }, error: null }),
      key(),
    );
    expect(await odd.consume(actor, randomUUID(), purpose, "123456")).toEqual({
      ok: false,
      reason: "refused",
    });
    const truthy = createStepupService(async () => ({ data: { ok: "true" }, error: null }), key());
    expect((await truthy.consume(actor, randomUUID(), purpose, "123456")).ok).toBe(false);
  });

  it("DM-SEP-6: codes are uniform 6-digit strings (randomInt, leading zeros kept)", async () => {
    const db = fakeDb();
    const service = createStepupService(db.rpc, key());
    const purpose = stepupPurposeHash(actor, "platform_terminal_change", change);
    const codes: string[] = [];
    for (let i = 0; i < 300; i++) codes.push((await service.issue(actor, purpose)).code);
    for (const c of codes) expect(c).toMatch(/^[0-9]{6}$/);
    expect(codes.some((c) => c.startsWith("0"))).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(250);
  });
});

describe("constant-time comparisons only", () => {
  const SERVER = ["env", "crypto", "tenant-keys", "platform-keys", "stepup"].map((f) =>
    readFileSync(join(process.cwd(), `src/platform/payments/server/${f}.ts`), "utf8"),
  );
  const strip = (code: string) =>
    code
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
      .replace(/typeof\s+[\w.?[\]"']+\s*[!=]==\s*"[a-z]+"/g, "");

  it("DM-SEP-6: no === / !== on a code, HMAC, hash, digest, secret or root value; safeEqual uses timingSafeEqual", () => {
    const risky =
      /\b\w*(?:code|hmac|hash|digest|secret|root)\w*\s*[!=]==|[!=]==\s*\w*(?:code|hmac|hash|digest|secret|root)\w*/i;
    for (const code of SERVER) {
      for (const line of strip(code).split("\n")) expect(line).not.toMatch(risky);
    }
    const crypto = strip(SERVER[1]!);
    expect(crypto).toMatch(/export function safeEqual[\s\S]*?timingSafeEqual\(left, right\)/);
    // the roots are compared with the other secrets only through safeEqual
    expect(strip(SERVER[0]!)).toMatch(/safeEqual\(own, other\)/);
    expect(strip(SERVER[0]!)).toMatch(/safeEqual\(root, value\)/);
  });
});
