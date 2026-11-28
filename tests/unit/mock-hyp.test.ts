// Self-test of the mock Hyp Pay server used by E2E (e2e/scripts/mock-hyp.mjs, evidence 05 §1).
// The mock runs in-process on a random 127.0.0.1 port; no request leaves the machine, none goes to Hyp.
// Randomness lives in this test only (run id, order references); the mock itself is deterministic.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  HYP_FAKE_TERMINALS,
  HYP_HEBREW_TEXT,
  HYP_MOCK_CODES,
  HYP_PAGE_TESTIDS,
  HYP_SENTINELS,
  HYP_TEST_PREFIX,
  HYP_UNKNOWN_MASOF,
  hypCanaries,
  hypFakeCredentials,
} from "../../e2e/fixtures/hyp-fake.mjs";
import { createHypMockServer } from "../../e2e/scripts/mock-hyp.mjs";

type Term = { label: string; masof: string; key: string; passp: string; successUrl: string };
type Call = {
  seq: number;
  method: string;
  path: string;
  action: string;
  what: string | null;
  query_keys: string[];
  body_keys: string[];
  content_type: string | null;
  masof: string | null;
  order: string | null;
  choice: string | null;
  result: string | null;
};

const RUN = `unit${randomBytes(4).toString("hex")}`;
const BASE_SET = ["Id", "CCode", "Amount", "ACode", "Order", "Fild1", "Fild2", "Fild3"];
const MOREDATA_SET = [
  "Bank",
  "TransType",
  "Payments",
  "UserId",
  "Brand",
  "Issuer",
  "L4digit",
  "Coin",
  "Tmonth",
  "Tyear",
  "UID",
  "bincard",
];
const FORM = { "content-type": "application/x-www-form-urlencoded" };

const external: Array<Record<string, unknown>> = [];
const made = createHypMockServer({ runId: RUN, externalCalls: external, hangMs: 1_500 });
const server: Server = made.server;
const terminals = made.mock.terminals;
const storeA: Term = terminals.storeA;
const storeB: Term = terminals.storeB;
const platform: Term = terminals.platform;
let origin = "";
let base = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  base = `${origin}/hyp/p/`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(async () => {
  expect((await fetch(`${origin}/__hyp/reset`, { method: "POST" })).status).toBe(200);
  external.length = 0;
});

const newOrder = () => randomBytes(16).toString("hex");
const enc = (pairs: [string, string][]) =>
  pairs.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
const signPairs = (
  t: Term,
  order: string,
  extra: [string, string][] = [],
  amount = "10.50",
): [string, string][] => [
  ["action", "APISign"],
  ["What", "SIGN"],
  ["Masof", t.masof],
  ["KEY", t.key],
  ["PassP", t.passp],
  ["Amount", amount],
  ["Coin", "1"],
  ["Order", order],
  ["Sign", "True"],
  ["MoreData", "True"],
  ["ClientName", "Dana"],
  ["email", "dana+e2e@e2e.test"],
  ...extra,
];
const keysOf = (raw: string) => raw.split("&").map((seg) => seg.slice(0, seg.indexOf("=")));
const valueIn = (raw: string, key: string) =>
  raw
    .split("&")
    .find((seg) => seg.startsWith(`${key}=`))
    ?.slice(key.length + 1);
const rawOf = (location: string) => location.slice(location.indexOf("?") + 1);

async function signGet(t: Term, order: string, extra: [string, string][] = []) {
  const res = await fetch(`${base}?${enc(signPairs(t, order, extra))}`);
  return res.text();
}
/** SIGN, then the page with `__choice` (API style); the 302 Location is the browser's return */
async function pay(t: Term, order = newOrder(), choice = "approve") {
  const signed = await signGet(t, order);
  const res = await fetch(`${base}?${signed}&__choice=${choice}`, { redirect: "manual" });
  return { order, signed, res, location: res.headers.get("location") ?? "" };
}
const verifyQuery = (t: Term, raw: string) =>
  `action=APISign&What=VERIFY&Masof=${t.masof}&KEY=${encodeURIComponent(t.key)}&PassP=${encodeURIComponent(t.passp)}&${raw}`;
async function verify(t: Term, raw: string, method: "GET" | "POST" = "GET") {
  const res =
    method === "GET"
      ? await fetch(`${base}?${verifyQuery(t, raw)}`)
      : await fetch(base, { method: "POST", headers: FORM, body: verifyQuery(t, raw) });
  return res.text();
}
async function scenario(spec: Record<string, unknown>) {
  const res = await fetch(`${origin}/__hyp/scenario`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(spec),
  });
  return res;
}
async function calls(query = ""): Promise<Call[]> {
  return (await fetch(`${origin}/__hyp/calls${query}`)).json() as Promise<Call[]>;
}

describe("mock Hyp — the fake terminal registry (e2e/fixtures/hyp-fake.mjs)", () => {
  it("DM-SEC-6: fake terminals are 10 digits; three carry the test prefix, one is live-shaped", () => {
    const all = Object.values(HYP_FAKE_TERMINALS);
    expect(all.map((t) => t.label).sort()).toEqual(["liveShaped", "platform", "storeA", "storeB"]);
    for (const t of all) expect(t.masof).toMatch(/^\d{10}$/);
    expect(new Set(all.map((t) => t.masof)).size).toBe(4);
    expect(
      all
        .filter((t) => t.masof.startsWith(HYP_TEST_PREFIX))
        .map((t) => t.label)
        .sort(),
    ).toEqual(["platform", "storeA", "storeB"]);
    expect(HYP_FAKE_TERMINALS.platform.successUrl).toBe(
      "http://platform.shop.localhost:3100/platform/payments/return/max",
    );
    expect(HYP_FAKE_TERMINALS.storeA.successUrl).toBe(
      "http://kobi.shop.localhost:3100/payments/return/max",
    );
    expect(HYP_FAKE_TERMINALS.storeB.successUrl).toBe(
      "http://store-b.shop.localhost:3100/payments/return/max",
    );
  });

  it("KEY/PassP canaries are unique per terminal and per run, and none contains another", () => {
    const one = hypCanaries(RUN);
    const two = hypCanaries(`${RUN}x`);
    expect(one).toHaveLength(8);
    expect(new Set(one).size).toBe(8);
    expect(one.filter((c) => two.includes(c))).toEqual([]);
    for (const a of one) for (const b of one) if (a !== b) expect(a.includes(b)).toBe(false);
    expect(hypFakeCredentials(RUN).storeB.key).toContain(RUN);
    expect(() => hypFakeCredentials("BAD RUN")).toThrow();
  });
});

describe("mock Hyp — SIGN", () => {
  it("DM-PAY-2 (mock): echoes every parameter except KEY/PassP, action→pay, 64-hex signature last (GET and POST)", async () => {
    const order = newOrder();
    for (const method of ["GET", "POST"] as const) {
      const query = enc(signPairs(storeB, order));
      const res =
        method === "GET"
          ? await fetch(`${base}?${query}`)
          : await fetch(base, { method: "POST", headers: FORM, body: query });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
      const body = await res.text();
      const keys = keysOf(body);
      expect(keys.at(-1)).toBe("signature");
      expect(valueIn(body, "signature")).toMatch(/^[0-9a-f]{64}$/);
      expect(keys).not.toContain("KEY");
      expect(keys).not.toContain("PassP");
      expect(body).not.toContain(storeB.key);
      expect(body).not.toContain(storeB.passp);
      expect(valueIn(body, "action")).toBe("pay");
      expect(keys.slice(0, -1)).toEqual([...keys.slice(0, -1)].sort());
      expect(valueIn(body, "Masof")).toBe(storeB.masof);
      expect(valueIn(body, "Amount")).toBe("10.50");
      expect(valueIn(body, "Order")).toBe(order);
      expect(valueIn(body, "email")).toBe("dana%2Be2e%40e2e.test");
    }
    const log = await calls(`?order=${order}&action=SIGN`);
    expect(log.map((c) => [c.method, c.masof, c.result])).toEqual([
      ["GET", storeB.masof, "ok"],
      ["POST", storeB.masof, "ok"],
    ]);
    expect(log[1]?.content_type).toBe("application/x-www-form-urlencoded");
    expect(log[1]?.body_keys).toContain("PassP");
  });

  it("902 for a wrong PassP, a wrong KEY or an unknown Masof; 904 without What", async () => {
    const order = newOrder();
    const wrong = (key: string, value: string) =>
      enc(signPairs(storeB, order).map(([k, v]) => [k, k === key ? value : v]));
    expect(await (await fetch(`${base}?${wrong("PassP", "nope")}`)).text()).toBe("CCode=902");
    expect(await (await fetch(`${base}?${wrong("KEY", storeA.key)}`)).text()).toBe("CCode=902");
    expect(await (await fetch(`${base}?${wrong("Masof", HYP_UNKNOWN_MASOF)}`)).text()).toBe(
      "CCode=902",
    );
    const noWhat = enc(signPairs(storeB, order).filter(([k]) => k !== "What"));
    expect(await (await fetch(`${base}?${noWhat}`)).text()).toBe("CCode=904");
  });

  it.each([
    "SendHesh",
    "sendHeshSMS",
    "Pritim",
    "heshDesc",
    "EZ.title",
    "sendemail",
    "Tash",
    "FixTash",
    "tashType",
    "J5",
    "Postpone",
    "HK",
    "freq",
    "OnlyOnApprove",
    "UserId",
    "tOwner",
  ])(
    "DM-PAY-1 (mock): a SIGN with %s gets the mock-only code, so a test catches it",
    async (name) => {
      const body = await signGet(storeB, newOrder(), [[name, "1"]]);
      expect(body).toBe(
        `CCode=${HYP_MOCK_CODES.forbiddenParam}&mockError=forbidden_param&mockParam=${encodeURIComponent(name)}`,
      );
    },
  );

  it("refund, cancel, token and unknown actions get the mock-only 'unsupported' code", async () => {
    for (const q of [
      "action=zikoyAPI&Masof=1",
      "action=CancelTrans&Masof=1",
      "action=soft&Masof=1",
      "action=getToken&Masof=1",
      "action=APISign&What=LIST",
      "",
    ]) {
      const text = await (await fetch(`${base}?${q}`)).text();
      expect(text.startsWith(`CCode=${HYP_MOCK_CODES.unsupported}&mockError=unsupported`)).toBe(
        true,
      );
    }
  });
});

describe("mock Hyp — hosted page and the return", () => {
  it("the page has approve / decline / cancel buttons and no card field; changed or unknown parameters → error", async () => {
    const signed = await signGet(storeB, newOrder());
    const page = await fetch(`${base}?${signed}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    for (const id of ["page", "approve", "decline", "cancel"] as const)
      expect(html).toContain(`data-testid="${HYP_PAGE_TESTIDS[id]}"`);
    expect(html).not.toMatch(/<input|<select|<textarea/i);
    expect(html).toContain('dir="rtl"');
    expect(html).not.toContain(storeB.key);

    const changed = await (
      await fetch(`${base}?${signed.replace("Amount=10.50", "Amount=0.10")}`)
    ).text();
    expect(changed).toContain(`data-testid="${HYP_PAGE_TESTIDS.error}"`);
    expect(changed).not.toContain(HYP_PAGE_TESTIDS.approve);
    const forged = signed.replace(/signature=[0-9a-f]{64}/, `signature=${"0".repeat(64)}`);
    const unknown = await fetch(`${base}?${forged}&__choice=approve`, { redirect: "manual" });
    expect(unknown.status).toBe(200);
    expect(unknown.headers.get("location")).toBeNull();
    expect((await calls("?action=PAGE")).map((c) => c.result)).toEqual([
      "page",
      "error:changed",
      "error:unknown_signature",
    ]);
  });

  it("approve → 302 to the terminal's success URL: documented base set, MoreData sentinels, Sign last; single use", async () => {
    const { res, location, signed } = await pay(storeB);
    expect(res.status).toBe(302);
    expect(location.startsWith(`${storeB.successUrl}?`)).toBe(true);
    const raw = rawOf(location);
    const keys = keysOf(raw);
    expect(keys.slice(0, 8)).toEqual(BASE_SET);
    expect(keys.slice(8, -1)).toEqual(MOREDATA_SET);
    expect(keys.at(-1)).toBe("Sign");
    expect(valueIn(raw, "Sign")).toMatch(/^[0-9a-f]{64}$/);
    expect(valueIn(raw, "Id")).toMatch(/^\d{12}$/);
    expect(valueIn(raw, "CCode")).toBe("0");
    expect(valueIn(raw, "Amount")).toBe("10.50");
    expect(valueIn(raw, "ACode")).toBe(HYP_SENTINELS.ACode);
    expect(valueIn(raw, "Fild1")).toBe("Dana");
    expect(valueIn(raw, "Fild2")).toBe("dana%2Be2e%40e2e.test");
    expect(valueIn(raw, "Fild3")).toBe("");
    for (const k of ["UID", "UserId", "bincard", "L4digit", "Tmonth", "Tyear"] as const)
      expect(valueIn(raw, k)).toBe(HYP_SENTINELS[k]);
    expect(raw).not.toContain(storeB.passp);

    const again = await fetch(`${base}?${signed}&__choice=approve`, { redirect: "manual" });
    expect(again.status).toBe(200);
    expect(await again.text()).toContain(`data-testid="${HYP_PAGE_TESTIDS.error}"`);

    const p = await pay(platform);
    expect(p.location.startsWith(`${platform.successUrl}?`)).toBe(true);
  });

  it("the same (terminal, Order) gives the same Id and Sign after a reset — no randomness", async () => {
    const order = newOrder();
    const first = (await pay(storeB, order)).location;
    await fetch(`${origin}/__hyp/reset`, { method: "POST" });
    expect((await pay(storeB, order)).location).toBe(first);
    const source = readFileSync(join(process.cwd(), "e2e/scripts/mock-hyp.mjs"), "utf8");
    expect(source).not.toMatch(
      /Math\.random|randomBytes|randomUUID|getRandomValues|Date\.now\(\)\s*[%*+]/,
    );
  });

  it("decline without an error URL stays on the page; cancel never redirects; decline_redirect returns a non-zero CCode", async () => {
    const declined = await pay(storeB, newOrder(), "decline");
    expect(declined.res.status).toBe(200);
    expect(declined.location).toBe("");
    const html = await declined.res.text();
    expect(html).toContain(`data-testid="${HYP_PAGE_TESTIDS.status}"`);
    expect(html).toContain(`data-testid="${HYP_PAGE_TESTIDS.approve}"`);
    // the declined page can still be paid (a decline does not use the page up)
    const retry = await fetch(`${base}?${declined.signed}&__choice=approve`, {
      redirect: "manual",
    });
    expect(retry.status).toBe(302);

    const cancelled = await pay(storeB, newOrder(), "cancel");
    expect(cancelled.res.status).toBe(200);
    expect(cancelled.location).toBe("");
    expect(await cancelled.res.text()).not.toContain(HYP_PAGE_TESTIDS.approve);

    const order = newOrder();
    expect((await scenario({ target: `order:${order}`, page: "decline_redirect" })).status).toBe(
      200,
    );
    const redirected = await pay(storeB, order, "decline");
    expect(redirected.res.status).toBe(302);
    const raw = rawOf(redirected.location);
    expect(valueIn(raw, "CCode")).toBe("4");
    expect(valueIn(raw, "ACode")).toBe("");
    // MA-9: an authentic decline verifies; the app decides on the return CCode
    expect(await verify(storeB, raw)).toBe("CCode=0");
    const o2 = newOrder();
    await scenario({ target: `order:${o2}`, page: "decline_redirect:33" });
    expect(valueIn(rawOf((await pay(storeB, o2, "decline")).location), "CCode")).toBe("33");
  });

  it("page switches: auto approve, moredata_off, and the order of precedence", async () => {
    const order = newOrder();
    await scenario({ target: `order:${order}`, page: "approve,moredata_off" });
    const signed = await signGet(storeB, order);
    const auto = await fetch(`${base}?${signed}`, { redirect: "manual" });
    expect(auto.status).toBe(302);
    expect(keysOf(rawOf(auto.headers.get("location") ?? ""))).toEqual([...BASE_SET, "Sign"]);
  });
});

describe("mock Hyp — VERIFY", () => {
  it("DM-PAY-4 (mock): CCode=0 only for the exact raw return with the issuing terminal's credentials (GET and POST)", async () => {
    const { location, order } = await pay(storeB);
    const raw = rawOf(location);
    expect(await verify(storeB, raw)).toBe("CCode=0");
    expect(await verify(storeB, raw, "POST")).toBe("CCode=0");
    const log = await calls(`?order=${order}&action=VERIFY`);
    expect(log.map((c) => [c.method, c.masof, c.result])).toEqual([
      ["GET", storeB.masof, "0"],
      ["POST", storeB.masof, "0"],
    ]);
    expect(log[1]?.body_keys.slice(0, 6)).toEqual([
      "action",
      "What",
      "Masof",
      "KEY",
      "PassP",
      "Id",
    ]);
  });

  it("E4 (mock): a changed, reordered, re-encoded or extended return fails; a missing parameter → 200", async () => {
    const { location } = await pay(storeB);
    const raw = rawOf(location);
    const segs = raw.split("&");
    const fail = `CCode=${HYP_MOCK_CODES.verifyMismatch}`;
    expect(await verify(storeB, raw.replace("Amount=10.50", "Amount=1.50"))).toBe(fail);
    expect(await verify(storeB, raw.replace(/Order=[0-9a-f]{32}/, `Order=${newOrder()}`))).toBe(
      fail,
    );
    expect(await verify(storeB, raw.replace("Coin=1", "Coin=2"))).toBe(fail);
    expect(await verify(storeB, [segs[1], segs[0], ...segs.slice(2)].join("&"))).toBe(fail);
    expect(await verify(storeB, raw.replace("dana%2Be2e%40e2e.test", "dana+e2e@e2e.test"))).toBe(
      fail,
    );
    expect(await verify(storeB, `${raw}&Extra=1`)).toBe(fail);
    expect(await verify(storeB, raw.replace("&Fild3=", ""))).toBe("CCode=200");
    expect(await verify(storeB, raw.replace(/&Sign=[0-9a-f]{64}/, ""))).toBe("CCode=200");
    expect(await verify(storeB, raw.replace("&Bank=6", ""))).toBe("CCode=200");
  });

  it("DM-SEP-4 (mock): a return checked with another terminal's credentials fails; wrong credentials → 902", async () => {
    const { location } = await pay(storeB);
    const raw = rawOf(location);
    const fail = `CCode=${HYP_MOCK_CODES.verifyMismatch}`;
    expect(await verify(storeA, raw)).toBe(fail);
    expect(await verify(platform, raw)).toBe(fail);
    expect(await verify({ ...storeB, passp: "nope" }, raw)).toBe("CCode=902");
    expect(await verify({ ...storeB, key: storeA.key }, raw)).toBe("CCode=902");
    // a return signed by store A's terminal for store B's order and amount (the cross-terminal forgery)
    const order = newOrder();
    const forged = rawOf((await pay(storeA, order)).location);
    expect(await verify(storeB, forged)).toBe(fail);
    expect(await verify(storeA, forged)).toBe("CCode=0");
  });

  it.each(["600", "700", "800"])(
    "DM-PAY-6 (mock): a %s hold returns to the success URL and verifies as authentic",
    async (code) => {
      const order = newOrder();
      await scenario({ target: `order:${order}`, page: `hold_${code}` });
      const { res, location } = await pay(storeB, order);
      expect(res.status).toBe(302);
      expect(location.startsWith(`${storeB.successUrl}?`)).toBe(true);
      expect(valueIn(rawOf(location), "CCode")).toBe(code);
      expect(await verify(storeB, rawOf(location))).toBe("CCode=0");
    },
  );

  it("DM-PAY-6 / DM-PAY-7 (mock): HKId, MULTI, Hesh, HeshASM, Hesh=0 and an empty Hesh", async () => {
    const cases: [string, Record<string, string>][] = [
      ["hkid,multi", { HKId: HYP_SENTINELS.HKId, MULTI: HYP_SENTINELS.MULTI }],
      ["hesh", { Hesh: HYP_SENTINELS.Hesh }],
      ["heshasm", { HeshASM: HYP_SENTINELS.HeshASM }],
      ["hesh_zero", { Hesh: "0" }],
      ["hesh_empty", { Hesh: "" }],
    ];
    for (const [page, expected] of cases) {
      const order = newOrder();
      await scenario({ target: `order:${order}`, page });
      const raw = rawOf((await pay(storeB, order)).location);
      for (const [k, v] of Object.entries(expected))
        expect(valueIn(raw, k), `${page} ${k}`).toBe(v);
      expect(keysOf(raw).at(-1)).toBe("Sign");
      expect(await verify(storeB, raw)).toBe("CCode=0");
    }
  });

  it("NEW-E-LENIENT: verify=lenient answers 0 even for a changed Amount/Order/Coin, but still 902 for wrong credentials", async () => {
    const { location } = await pay(storeB);
    const raw = rawOf(location);
    await scenario({ verify: "lenient" });
    expect(await verify(storeB, raw.replace("Amount=10.50", "Amount=0.01"))).toBe("CCode=0");
    expect(await verify(storeB, raw.replace("Coin=1", "Coin=2"))).toBe("CCode=0");
    expect(await verify(storeA, raw)).toBe("CCode=0");
    expect(await verify({ ...storeB, passp: "nope" }, raw)).toBe("CCode=902");
  });

  it("response-format switches: trailing_crlf, ccode_00, ccode_space, ccode_dup, fail_code, fail_200, creds", async () => {
    const { location } = await pay(storeB);
    const raw = rawOf(location);
    const expected: [string, string][] = [
      ["trailing_crlf", "CCode=0\r\n"],
      ["ccode_00", "CCode=00"],
      ["ccode_space", " CCode=0"],
      ["ccode_dup", "CCode=0&CCode=1"],
      ["fail_code", `CCode=${HYP_MOCK_CODES.verifyMismatch}`],
      ["fail_200", "CCode=200"],
      ["creds", "CCode=902"],
    ];
    for (const [sw, body] of expected) {
      await scenario({ target: `terminal:${storeB.masof}`, verify: sw, times: 1 });
      expect(await verify(storeB, raw), sw).toBe(body);
    }
    expect(await verify(storeB, raw)).toBe("CCode=0");
  });

  it("encoding switches: Windows-1255 and UTF-8 Hebrew in Fild1/Info verify only byte for byte", async () => {
    const o1 = newOrder();
    await scenario({ target: `order:${o1}`, page: "win1255" });
    const w = rawOf((await pay(storeB, o1)).location);
    expect(valueIn(w, "Fild1")).toBe("%EC%F7%E5%E7%20%E1%E3%E9%F7%E4");
    expect(valueIn(w, "Info")).toBe(valueIn(w, "Fild1"));
    expect(await verify(storeB, w)).toBe("CCode=0");
    const reencoded = w.replaceAll(
      "%EC%F7%E5%E7%20%E1%E3%E9%F7%E4",
      encodeURIComponent(HYP_HEBREW_TEXT),
    );
    expect(await verify(storeB, reencoded)).toBe(`CCode=${HYP_MOCK_CODES.verifyMismatch}`);

    const o2 = newOrder();
    await scenario({ target: `order:${o2}`, page: "utf8" });
    const u = rawOf((await pay(storeB, o2)).location);
    expect(valueIn(u, "Fild1")).toBe(encodeURIComponent(HYP_HEBREW_TEXT));
    expect(await verify(storeB, u)).toBe("CCode=0");
  });

  it("attack switches: a duplicate Amount or an appended PassP is delivered but never verifies", async () => {
    const o1 = newOrder();
    await scenario({ target: `order:${o1}`, page: "dup_param" });
    const dup = rawOf((await pay(storeB, o1)).location);
    expect(keysOf(dup).filter((k) => k === "Amount")).toHaveLength(2);
    expect(await verify(storeB, dup)).toBe(`CCode=${HYP_MOCK_CODES.verifyMismatch}`);
    expect(await verify(storeB, dup.replace("&Amount=1&", "&"))).toBe("CCode=0");

    const o2 = newOrder();
    await scenario({ target: `order:${o2}`, page: "extra_secret_param" });
    const extra = rawOf((await pay(storeB, o2)).location);
    expect(valueIn(extra, "PassP")).toBe(HYP_SENTINELS.injectedPassP);
    expect(extra).not.toContain(storeB.passp);
    expect(await verify(storeB, extra)).not.toBe("CCode=0");
  });
});

describe("mock Hyp — transport faults and scenario rules", () => {
  it("timeout holds a request past a short client timeout; slow:<ms> answers late; reset drops the socket", async () => {
    const order = newOrder();
    await scenario({ target: `order:${order}`, sign: "timeout", times: 1 });
    const started = Date.now();
    await expect(
      fetch(`${base}?${enc(signPairs(storeB, order))}`, { signal: AbortSignal.timeout(300) }),
    ).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1_400);

    await scenario({ target: `order:${order}`, sign: "slow:250", times: 1 });
    const t0 = Date.now();
    const slow = await fetch(`${base}?${enc(signPairs(storeB, order))}`, {
      signal: AbortSignal.timeout(3_000),
    });
    expect(await slow.text()).toMatch(/&signature=[0-9a-f]{64}$/);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(240);

    await scenario({ target: `order:${order}`, sign: "reset", times: 1 });
    await expect(fetch(`${base}?${enc(signPairs(storeB, order))}`)).rejects.toThrow();

    const { location } = await pay(storeB);
    await scenario({ verify: "timeout", times: 1 });
    await expect(
      fetch(`${base}?${verifyQuery(storeB, rawOf(location))}`, {
        signal: AbortSignal.timeout(300),
      }),
    ).rejects.toThrow();
    expect(await verify(storeB, rawOf(location))).toBe("CCode=0");
    expect((await calls(`?order=${order}&action=SIGN`)).map((c) => c.result)).toEqual([
      "timeout",
      "ok",
      "reset",
    ]);
  });

  it("HTML, garbage, JSON, 500/503, oversize and off-host redirect answers (SIGN and VERIFY)", async () => {
    const { location } = await pay(storeB);
    const raw = rawOf(location);
    for (const kind of ["sign", "verify"] as const) {
      const send = () =>
        kind === "sign"
          ? fetch(`${base}?${enc(signPairs(storeB, newOrder()))}`, { redirect: "manual" })
          : fetch(`${base}?${verifyQuery(storeB, raw)}`, { redirect: "manual" });
      const once = async (sw: string) => {
        await scenario({ [kind]: sw, times: 1 });
        return send();
      };
      const html = await once("html_200");
      expect(html.headers.get("content-type")).toMatch(/^text\/html/);
      expect(await html.text()).toMatch(/^<!DOCTYPE html>/);
      expect(await (await once("html_with_ccode0")).text()).toContain("CCode=0");
      const garbage = Buffer.from(await (await once("garbage_200")).arrayBuffer());
      expect(garbage.includes(0)).toBe(true);
      expect((await once("json_200")).headers.get("content-type")).toBe("application/json");
      expect((await once("http_500")).status).toBe(500);
      expect((await once("http_503")).status).toBe(503);
      expect((await (await once("oversize")).text()).length).toBeGreaterThan(64 * 1024);
      const moved = await once("redirect_3xx");
      expect(moved.status).toBe(302);
      expect(moved.headers.get("location")).toBe("http://hyp-redirect.invalid/p/");
      expect((await send()).status).toBe(200);
    }
    // SIGN-only shape faults
    const shape = async (sw: string) => {
      await scenario({ sign: sw, times: 1 });
      return (await fetch(`${base}?${enc(signPairs(storeB, newOrder()))}`)).text();
    };
    const echoed = await shape("echo_secret");
    expect(echoed).toContain(`KEY=${storeB.key}`);
    expect(echoed).toContain(`PassP=${storeB.passp}`);
    expect(await shape("no_signature")).not.toContain("signature=");
    expect(valueIn(await shape("no_action_pay"), "action")).toBe("APISign");
    expect(await shape("creds")).toBe("CCode=902");
    expect(await shape("no_what")).toBe("CCode=904");
  });

  it("flaky:<n>, times, and order > terminal > global precedence", async () => {
    const { location, order } = await pay(storeB);
    const raw = rawOf(location);
    await scenario({ target: `order:${order}`, verify: "flaky:2" });
    expect(
      (await fetch(`${base}?${verifyQuery(storeB, raw)}`)).headers.get("content-type"),
    ).toMatch(/html/);
    expect(await verify(storeB, raw)).toMatch(/^<!DOCTYPE html>/);
    expect(await verify(storeB, raw)).toBe("CCode=0");

    await scenario({ verify: "fail_200" });
    await scenario({ target: "terminal:storeB", verify: "fail_code" });
    await scenario({ target: `order:${order}`, verify: "lenient" });
    const other = rawOf((await pay(storeB)).location);
    const onA = rawOf((await pay(storeA)).location);
    expect(await verify(storeB, raw.replace("Amount=10.50", "Amount=9.99"))).toBe("CCode=0");
    expect(await verify(storeB, other)).toBe(`CCode=${HYP_MOCK_CODES.verifyMismatch}`);
    expect(await verify(storeA, onA)).toBe("CCode=200");
  });

  it("an unknown switch, target or times is refused with 400", async () => {
    expect((await scenario({ sign: "nope" })).status).toBe(400);
    expect((await scenario({ verify: "flaky:x" })).status).toBe(400);
    expect((await scenario({ page: "approve,nope" })).status).toBe(400);
    expect((await scenario({ target: `terminal:${HYP_UNKNOWN_MASOF}`, sign: "ok" })).status).toBe(
      400,
    );
    expect((await scenario({ target: "elsewhere", sign: "ok" })).status).toBe(400);
    expect((await scenario({ sign: "ok", times: 0 })).status).toBe(400);
    expect((await scenario({})).status).toBe(400);
    expect(await (await fetch(`${origin}/__hyp/scenarios`)).json()).toEqual([]);
  });
});

describe("mock Hyp — control endpoints and the call log", () => {
  it("reset clears scenarios, issued pages and returns, and the call log", async () => {
    const { location, signed } = await pay(storeB);
    await scenario({ sign: "creds" });
    expect((await fetch(`${origin}/__hyp/reset`, { method: "POST" })).status).toBe(200);
    expect(await (await fetch(`${origin}/__hyp/scenarios`)).json()).toEqual([]);
    expect(await calls()).toEqual([]);
    expect(await (await fetch(`${base}?${signed}`)).text()).toContain(HYP_PAGE_TESTIDS.error);
    expect(await verify(storeB, rawOf(location))).toBe(`CCode=${HYP_MOCK_CODES.verifyMismatch}`);
    expect(await signGet(storeB, newOrder())).toMatch(/&signature=[0-9a-f]{64}$/);
  });

  it("DM-ENV-8 (mock): the call log keeps method, path, parameter names and the Masof — never KEY/PassP values", async () => {
    const { order, location } = await pay(storeB);
    await verify(storeB, rawOf(location), "POST");
    await pay(storeA);
    const mine = await calls(`?order=${order}`);
    expect(mine.map((c) => [c.action, c.method, c.path, c.masof])).toEqual([
      ["SIGN", "GET", "/hyp/p/", storeB.masof],
      ["PAGE", "GET", "/hyp/p/", storeB.masof],
      ["VERIFY", "POST", "/hyp/p/", storeB.masof],
    ]);
    expect(mine[0]?.query_keys).toEqual(signPairs(storeB, order).map(([k]) => k));
    expect(mine[1]?.choice).toBe("approve");
    expect(await calls(`?order=${order}&action=verify`)).toHaveLength(1);
    expect(await calls(`?masof=storeA`)).toHaveLength(2);
    const everything = JSON.stringify(await calls());
    for (const canary of hypCanaries(RUN)) expect(everything).not.toContain(canary);
    // the shared /__calls copy (mock-services) has the values masked
    const shared = JSON.stringify(external);
    expect(shared).toContain("PassP=[redacted]");
    for (const canary of hypCanaries(RUN)) expect(shared).not.toContain(canary);
  });

  it("GET /__hyp/terminals lists the run's fake credentials for the specs; unknown control paths → 404", async () => {
    const res = await fetch(`${origin}/__hyp/terminals`);
    const body = (await res.json()) as { terminals: Term[] };
    const creds = hypFakeCredentials(RUN);
    expect(body.terminals.map((t) => [t.label, t.masof, t.key, t.passp])).toEqual(
      (["platform", "storeA", "storeB", "liveShaped"] as const).map((l) => [
        l,
        creds[l].masof,
        creds[l].key,
        creds[l].passp,
      ]),
    );
    expect((await fetch(`${origin}/__hyp/nothing`)).status).toBe(404);
    expect((await fetch(`${origin}/hyp/other`)).status).toBe(404);
  });
});

describe("mock-services.mjs dispatches Hyp before its 503 fallback", () => {
  it("R3: Grow still gets the same 503; /hyp works; /__calls has no KEY/PassP values", async () => {
    const port = await new Promise<number>((resolve) => {
      const probe = createServer();
      probe.listen(0, "127.0.0.1", () => {
        const p = (probe.address() as AddressInfo).port;
        probe.close(() => resolve(p));
      });
    });
    const child = spawn(process.execPath, [join(process.cwd(), "e2e/scripts/mock-services.mjs")], {
      env: { ...process.env, MOCK_PORT: String(port), HYP_MOCK_RUN_ID: RUN },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.on(
          "data",
          (d: Buffer) => d.toString().includes("mock services on") && resolve(),
        );
        child.once("exit", (code) => reject(new Error(`mock-services exited ${code}`)));
      });
      const svc = `http://127.0.0.1:${port}`;
      const grow = await fetch(`${svc}/grow/api/light/server/1.0/createPaymentProcess`, {
        method: "POST",
        body: "x=1",
      });
      expect(grow.status).toBe(503);
      expect(await grow.text()).toBe(JSON.stringify({ error: "payments are mocked in e2e" }));
      const t = hypFakeCredentials(RUN).storeB;
      const signed = await (
        await fetch(`${svc}/hyp/p/?${enc(signPairs({ ...storeB, ...t }, newOrder()))}`)
      ).text();
      expect(signed).toMatch(/&signature=[0-9a-f]{64}$/);
      const shared = (await (await fetch(`${svc}/__calls`)).json()) as { url: string }[];
      expect(shared.map((c) => c.url.split("?")[0])).toEqual([
        "/grow/api/light/server/1.0/createPaymentProcess",
        "/hyp/p/",
      ]);
      const text = JSON.stringify(shared);
      expect(text).toContain("KEY=[redacted]");
      expect(text).not.toContain(t.key);
      expect(text).not.toContain(t.passp);
      expect((await (await fetch(`${svc}/__hyp/calls?action=SIGN`)).json()) as Call[]).toHaveLength(
        1,
      );
    } finally {
      child.kill();
    }
  });
});
