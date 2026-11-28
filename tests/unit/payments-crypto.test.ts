// MAX/Hyp DEMO — encryption of the terminal credentials (plan §6.1 ENV-4; Appendix D DM-ENV-4).
// HKDF per environment / scope / mode; AAD per environment, scope, store, provider, mode, account, field and kid.
// Only fake values: random roots and ids generated here.
import { createHmac, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hkdfKey,
  joinAad,
  keyIdOf,
  open,
  safeEqual,
  seal,
} from "@/platform/payments/server/crypto";
import { platformSecretCipher, stepupKey } from "@/platform/payments/server/platform-keys";
import { tenantSecretCipher } from "@/platform/payments/server/tenant-keys";

const root = () => randomBytes(32).toString("hex");
/** exactly the CHECK of migration 208 on every *_enc column (and key_id = split_part(token, ':', 2)) */
const TOKEN = /^v1:[0-9a-f]{8}:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]+$/;
const DECRYPT_FAILED = "payments: decrypt failed";

/** the open() failure is always the same fixed Error, with no cause and nothing attached */
function expectDecryptFailure(fn: () => unknown) {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Error);
  const error = caught as Error;
  expect(error.message).toBe(DECRYPT_FAILED);
  expect(error.cause).toBeUndefined();
  expect(Object.keys(error)).toEqual([]);
}

let tenantRoot: string;
let platformRoot: string;
beforeEach(() => {
  tenantRoot = root();
  platformRoot = root();
  vi.stubEnv("PAYMENTS_SECRETS_KEY", tenantRoot);
  vi.stubEnv("PLATFORM_TERMINAL_SECRETS_KEY", platformRoot);
});
afterEach(() => vi.unstubAllEnvs());

describe("crypto primitives", () => {
  it("DM-ENV-4: hkdfKey is HKDF-SHA256 with salt nuriel-payments, 32 bytes, one key per label", () => {
    const r = root();
    const key = hkdfKey(r, "nuriel/payments/v1/demo/tenant/test");
    expect(key).toHaveLength(32);
    const expected = Buffer.from(
      hkdfSync("sha256", r, "nuriel-payments", "nuriel/payments/v1/demo/tenant/test", 32),
    );
    expect(key.equals(expected)).toBe(true);
    expect(hkdfKey(r, "nuriel/payments/v1/demo/tenant/live").equals(key)).toBe(false);
    expect(hkdfKey(root(), "nuriel/payments/v1/demo/tenant/test").equals(key)).toBe(false);
    expect(() => hkdfKey("", "x")).toThrowError("payments: key derivation failed");
    expect(() => hkdfKey(r, "")).toThrowError("payments: key derivation failed");
  });

  it("DM-ENV-4: seal → v1:<kid>:<iv>:<tag>:<ct>, a fresh IV every time, open restores it", () => {
    const key = randomBytes(32);
    const a = seal(key, "fake-terminal-password", "aad", "0a1b2c3d");
    const b = seal(key, "fake-terminal-password", "aad", "0a1b2c3d");
    expect(a).toMatch(TOKEN);
    expect(a).not.toBe(b);
    expect(a.split(":")[1]).toBe("0a1b2c3d");
    expect(open(key, a, "aad")).toBe("fake-terminal-password");
    expect(open(key, b, "aad")).toBe("fake-terminal-password");
    expect(open(key, seal(key, "שלום ✓", "aad", "ffff0000"), "aad")).toBe("שלום ✓");
    expect(a).not.toContain("fake-terminal-password");
  });

  it("DM-ENV-4: every failure of open is the same fixed Error without a cause", () => {
    const key = randomBytes(32);
    const token = seal(key, "fake-key-value", "env|scope", "0a1b2c3d");
    const [v, kid, iv, tag, ct] = token.split(":") as [string, string, string, string, string];
    const flip = (part: string) =>
      Buffer.from(Buffer.from(part, "base64url").map((x, i) => (i === 0 ? x ^ 1 : x))).toString(
        "base64url",
      );
    const variants = [
      "",
      "garbage",
      token.slice(0, -2),
      `${token}:extra`,
      [v, kid, iv, tag].join(":"),
      ["v2", kid, iv, tag, ct].join(":"),
      [v, "ffffffff", iv, tag, ct].join(":"), // kid edited: the header is authenticated
      [v, "", iv, tag, ct].join(":"),
      [v, kid, flip(iv), tag, ct].join(":"),
      [v, kid, iv, flip(tag), ct].join(":"), // tampered tag
      [v, kid, iv, tag, flip(ct)].join(":"),
      [v, kid, iv, tag.slice(0, -1), ct].join(":"),
      [v, kid, `${iv}==`, tag, ct].join(":"), // not canonical base64url
      [v, kid, iv, tag, ""].join(":"),
      [v, kid, iv.replace(/./, "+"), tag, ct].join(":"),
    ];
    for (const bad of variants) expectDecryptFailure(() => open(key, bad, "env|scope"));
    expectDecryptFailure(() => open(key, token, "env|scope2")); // wrong AAD
    expectDecryptFailure(() => open(randomBytes(32), token, "env|scope")); // wrong key
    expectDecryptFailure(() => open(randomBytes(16), token, "env|scope"));
    expectDecryptFailure(() => open(key, "x".repeat(100_000), "env|scope"));
    expectDecryptFailure(() => open(key, undefined as unknown as string, "env|scope"));
    expect(open(key, token, "env|scope")).toBe("fake-key-value");
  });

  it("DM-ENV-4: seal refuses a bad key, kid or empty / oversized plaintext (fixed message)", () => {
    const key = randomBytes(32);
    for (const call of [
      () => seal(randomBytes(31), "x", "a", "0a1b2c3d"),
      () => seal(key, "x", "a", "bad:kid"),
      () => seal(key, "x", "a", ""),
      // the kid is exactly 8 lower-case hex (the DB key_id CHECK)
      () => seal(key, "x", "a", "0A1B2C3D"),
      () => seal(key, "x", "a", "0a1b2c3"),
      () => seal(key, "x", "a", "0a1b2c3d4"),
      () => seal(key, "x", "a", "kid-0001"),
      () => seal(key, "", "a", "0a1b2c3d"),
      () => seal(key, "x".repeat(64 * 1024 + 1), "a", "0a1b2c3d"),
    ]) {
      expect(call).toThrowError(/^payments: encrypt failed$/);
    }
  });

  it("DM-ENV-4: AAD parts cannot shift boundaries; safeEqual compares in constant time", () => {
    expect(joinAad(["demo", "tenant", "max"])).toBe("demo|tenant|max");
    for (const bad of [["a|b"], [""], ["a b"], ["a\nb"]]) {
      expect(() => joinAad(bad)).toThrowError("payments: encrypt failed");
    }
    expect(safeEqual("same-value", "same-value")).toBe(true);
    expect(safeEqual("same-value", "same-valuf")).toBe(false);
    expect(safeEqual("short", "a much longer value")).toBe(false);
  });

  it("DM-ENV-4: kid = the first 8 hex of HMAC-SHA256(root, 'kid'), always 8 lower-case hex", () => {
    const r = root();
    expect(keyIdOf(r)).toBe(createHmac("sha256", r).update("kid").digest("hex").slice(0, 8));
    expect(keyIdOf(r)).not.toBe(keyIdOf(root()));
    for (let i = 0; i < 300; i++) {
      const any = randomBytes(24 + (i % 40)).toString(i % 2 ? "base64" : "latin1");
      expect(keyIdOf(any)).toMatch(/^[0-9a-f]{8}$/);
    }
  });
});

describe("DM-ENV-4: ciphertext is bound to environment, scope, store, mode, account, field and kid", () => {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const account = randomUUID();
  const other = randomUUID();

  it("DM-ENV-4: the exact contract formulas (HKDF info and AAD) open a tenant token", () => {
    const cipher = tenantSecretCipher("demo", "test");
    const token = cipher.seal("api_password", "fake-passp-1", {
      tenantId: tenantA,
      accountId: account,
    });
    expect(token).toMatch(TOKEN);
    const kid = createHmac("sha256", tenantRoot).update("kid").digest("hex").slice(0, 8);
    expect(cipher.kid).toBe(kid);
    expect(token.split(":")[1]).toBe(kid);
    const key = hkdfKey(tenantRoot, "nuriel/payments/v1/demo/tenant/test");
    const aad = `demo|tenant|${tenantA}|max|test|${account}|api_password|${kid}`;
    expect(open(key, token, aad)).toBe("fake-passp-1");
    expect(cipher.open("api_password", token, { tenantId: tenantA, accountId: account })).toBe(
      "fake-passp-1",
    );
  });

  it("DM-ENV-4: the exact contract formulas open a platform token; the step-up key has its own label", () => {
    const cipher = platformSecretCipher("demo", "test");
    const token = cipher.seal("api_key", "fake-key-1", { accountId: account });
    const kid = createHmac("sha256", platformRoot).update("kid").digest("hex").slice(0, 8);
    const key = hkdfKey(platformRoot, "nuriel/payments/v1/demo/platform/test");
    expect(open(key, token, `demo|platform|platform|max|test|${account}|api_key|${kid}`)).toBe(
      "fake-key-1",
    );
    const step = stepupKey("demo");
    expect(step.equals(hkdfKey(platformRoot, "nuriel/payments/v1/demo/platform/stepup"))).toBe(
      true,
    );
    expect(step.equals(key)).toBe(false);
    expect(step.equals(stepupKey("production"))).toBe(false);
  });

  it("DM-ENV-4: swapping any AAD part (env, scope, store, mode, account, field, kid) fails", () => {
    const key = randomBytes(32);
    const parts = ["demo", "tenant", tenantA, "max", "test", account, "api_key", "0a1b2c3d"];
    const token = seal(key, "fake-key-2", joinAad(parts), "0a1b2c3d");
    const swaps: Record<number, string> = {
      0: "production",
      1: "platform",
      2: tenantB,
      3: "other",
      4: "live",
      5: other,
      6: "api_password",
      7: "ffffffff",
    };
    for (const [index, value] of Object.entries(swaps)) {
      const changed = [...parts];
      changed[Number(index)] = value;
      expectDecryptFailure(() => open(key, token, joinAad(changed)));
    }
    expect(open(key, token, joinAad(parts))).toBe("fake-key-2");
  });

  it("DM-ENV-4: a token copied to another store, account or field does not open", () => {
    const cipher = tenantSecretCipher("demo", "test");
    const token = cipher.seal("api_key", "fake-key-3", { tenantId: tenantA, accountId: account });
    expectDecryptFailure(() =>
      cipher.open("api_key", token, { tenantId: tenantB, accountId: account }),
    );
    expectDecryptFailure(() =>
      cipher.open("api_key", token, { tenantId: tenantA, accountId: other }),
    );
    expectDecryptFailure(() =>
      cipher.open("api_password", token, { tenantId: tenantA, accountId: account }),
    );
    // UUIDs are compared in their canonical lower-case form
    expect(
      cipher.open("api_key", token, { tenantId: tenantA.toUpperCase(), accountId: account }),
    ).toBe("fake-key-3");
    expect(() =>
      cipher.seal("api_key", "x", { tenantId: "not-a-uuid", accountId: account }),
    ).toThrowError("payments: encrypt failed");
    expectDecryptFailure(() =>
      cipher.open("API KEY", token, { tenantId: tenantA, accountId: account }),
    );
  });

  it("DM-ENV-4: different roots per scope — a token never opens in the other scope", () => {
    const tenant = tenantSecretCipher("demo", "test");
    const platform = platformSecretCipher("demo", "test");
    expect(tenant.kid).not.toBe(platform.kid);
    const t = tenant.seal("api_key", "fake-key-4", { tenantId: tenantA, accountId: account });
    const p = platform.seal("api_key", "fake-key-4", { accountId: account });
    expectDecryptFailure(() => platform.open("api_key", t, { accountId: account }));
    expectDecryptFailure(() =>
      tenant.open("api_key", p, { tenantId: tenantA, accountId: account }),
    );
    // even with one shared root (refused by paymentsReady), the scope label keeps the keys apart
    vi.stubEnv("PLATFORM_TERMINAL_SECRETS_KEY", tenantRoot);
    const sameRoot = platformSecretCipher("demo", "test");
    expect(sameRoot.kid).toBe(tenant.kid);
    expectDecryptFailure(() => sameRoot.open("api_key", t, { accountId: account }));
  });

  it("DM-ENV-4: production ciphertext never opens with DEMO keys (not even with the same root)", () => {
    const production = tenantSecretCipher("production", "live");
    const token = production.seal("api_key", "fake-live-key", {
      tenantId: tenantA,
      accountId: account,
    });
    const demo = tenantSecretCipher("demo", "test");
    expectDecryptFailure(() =>
      demo.open("api_key", token, { tenantId: tenantA, accountId: account }),
    );
    const platformLive = platformSecretCipher("production", "live").seal(
      "api_key",
      "fake-live-key",
      {
        accountId: account,
      },
    );
    expectDecryptFailure(() =>
      platformSecretCipher("demo", "test").open("api_key", platformLive, { accountId: account }),
    );
    // and a different (DEMO) root: neither the key nor the kid match
    vi.stubEnv("PAYMENTS_SECRETS_KEY", root());
    const otherRoot = tenantSecretCipher("production", "live");
    expect(otherRoot.kid).not.toBe(production.kid);
    expectDecryptFailure(() =>
      otherRoot.open("api_key", token, { tenantId: tenantA, accountId: account }),
    );
  });

  it("DM-ENV-4: after a root rotation the old token fails with the same fixed error", () => {
    const before = tenantSecretCipher("demo", "test");
    const token = before.seal("api_key", "fake-key-5", { tenantId: tenantA, accountId: account });
    vi.stubEnv("PAYMENTS_SECRETS_KEY", root());
    const after = tenantSecretCipher("demo", "test");
    expect(after.kid).not.toBe(before.kid);
    expectDecryptFailure(() =>
      after.open("api_key", token, { tenantId: tenantA, accountId: account }),
    );
  });

  it("DM-ENV-4: the root is trimmed (a stray newline in the env file changes nothing)", () => {
    const token = tenantSecretCipher("demo", "test").seal("api_key", "fake-key-6", {
      tenantId: tenantA,
      accountId: account,
    });
    vi.stubEnv("PAYMENTS_SECRETS_KEY", ` ${tenantRoot}\n`);
    expect(
      tenantSecretCipher("demo", "test").open("api_key", token, {
        tenantId: tenantA,
        accountId: account,
      }),
    ).toBe("fake-key-6");
  });

  it("DM-ENV-4: every token of both ciphers matches the DB CHECK; key_id = part 2 = cipher.kid", () => {
    const tenant = tenantSecretCipher("demo", "test");
    const platform = platformSecretCipher("demo", "test");
    expect(tenant.kid).toBe(keyIdOf(tenantRoot));
    expect(platform.kid).toBe(keyIdOf(platformRoot));
    for (let length = 1; length <= 400; length += 7) {
      const value = randomBytes(length).toString("latin1").slice(0, length) || "x";
      const t = tenant.seal("api_key", value, { tenantId: tenantA, accountId: tenantA });
      const p = platform.seal("api_password", value, { accountId: "platform" });
      for (const [token, kid] of [
        [t, tenant.kid],
        [p, platform.kid],
      ] as const) {
        expect(token).toMatch(TOKEN);
        expect(token.split(":")[1]).toBe(kid);
      }
      expect(tenant.open("api_key", t, { tenantId: tenantA, accountId: tenantA })).toBe(value);
      expect(platform.open("api_password", p, { accountId: "platform" })).toBe(value);
    }
  });

  it("DM-ENV-4: accountId — the store id (store terminal), 'platform' (NURIEL's terminal), the attempt id (raw return)", () => {
    const tenant = tenantSecretCipher("demo", "test");
    const platform = platformSecretCipher("demo", "test");
    const attempt = randomUUID();
    // store terminal: accountId = the store's id; a raw return: accountId = the attempt's id
    const terminal = tenant.seal("api_key", "fake-key-7", {
      tenantId: tenantA,
      accountId: tenantA,
    });
    const raw = tenant.seal("raw_return", "Id=1&CCode=0", {
      tenantId: tenantA,
      accountId: attempt,
    });
    expectDecryptFailure(() =>
      tenant.open("api_key", terminal, { tenantId: tenantA, accountId: attempt }),
    );
    expectDecryptFailure(() =>
      tenant.open("raw_return", raw, { tenantId: tenantA, accountId: tenantA }),
    );
    expect(tenant.open("raw_return", raw, { tenantId: tenantA, accountId: attempt })).toBe(
      "Id=1&CCode=0",
    );
    // the tenant scope never takes the literal "platform"
    expect(() =>
      tenant.seal("api_key", "x", { tenantId: tenantA, accountId: "platform" }),
    ).toThrowError("payments: encrypt failed");
    // NURIEL's terminal: accountId = "platform" (exact), raw returns: the attempt id
    const own = platform.seal("api_key", "fake-key-8", { accountId: "platform" });
    expect(platform.open("api_key", own, { accountId: "platform" })).toBe("fake-key-8");
    expectDecryptFailure(() => platform.open("api_key", own, { accountId: attempt }));
    const platformRaw = platform.seal("raw_return", "Id=2&CCode=0", { accountId: attempt });
    expectDecryptFailure(() => platform.open("raw_return", platformRaw, { accountId: "platform" }));
    expectDecryptFailure(() =>
      platform.open("raw_return", platformRaw, { accountId: randomUUID() }),
    );
    for (const bad of ["PLATFORM", "Platform", " platform", "tenant", ""]) {
      expect(() => platform.seal("api_key", "x", { accountId: bad }), bad).toThrowError(
        "payments: encrypt failed",
      );
    }
  });

  it("DM-ENV-4: no root, a short root or another app secret never stand in (no fallback)", () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", root());
    vi.stubEnv("LOGIN_CODE_SECRET", root());
    vi.stubEnv("PAYMENTS_SECRETS_KEY", undefined);
    expect(() => tenantSecretCipher("demo", "test")).toThrowError(
      "payments: tenant key unavailable",
    );
    vi.stubEnv("PAYMENTS_SECRETS_KEY", "x".repeat(31));
    expect(() => tenantSecretCipher("demo", "test")).toThrowError(
      "payments: tenant key unavailable",
    );
    vi.stubEnv("PLATFORM_TERMINAL_SECRETS_KEY", "");
    expect(() => platformSecretCipher("demo", "test")).toThrowError(
      "payments: platform key unavailable",
    );
    expect(() => stepupKey("demo")).toThrowError("payments: platform key unavailable");
  });
});
