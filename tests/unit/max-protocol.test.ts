// MAX/Hyp DEMO — the pure protocol layer (src/platform/payments/max/protocol.ts, messages.ts, provider.ts,
// registry.ts). Test IDs from MAX-DEMO-PLAN.md appendix D. Every value here is an obvious fake: a terminal
// number that does not start with 00100, placeholder credentials, a made-up order reference and signature.
// No network: these functions are pure.
import { describe, expect, it } from "vitest";
import {
  MaxProtocolInputError,
  RETURN_MAX_LENGTH,
  SIGN_PARAM_ORDER,
  buildSignParams,
  buildVerifyQuery,
  classifyReturnCcode,
  classifyVerifyResponse,
  decimalToMinor,
  encodeParams,
  minorToDecimal,
  parseReturnQuery,
  validateSignResponse,
} from "@/platform/payments/max/protocol";
import {
  PAYMENT_MESSAGES,
  messageKeyForReturnOutcome,
  messageKeyForServiceCcode,
  paymentMessage,
  payerMessageKey,
  type PaymentMessageKey,
} from "@/platform/payments/max/messages";
import { PROVIDERS, isProviderId } from "@/platform/payments/registry";
import type { MaxCredentials, SignInput } from "@/platform/payments/provider";

const CREDS: MaxCredentials = {
  masof: "9999999901",
  key: "FAKE_KEY_unit",
  passp: "FAKE_PASSP_unit",
};
const ORDER = "0123456789abcdef0123456789abcdef";
const ENDPOINT = "https://pay.example.invalid/p/";
const FAKE_SIGNATURE = "ab".repeat(32);
const SECRET_NAMES = ["KEY", "PassP"];
/** Invisible characters, built at run time so that none sits literally in this file (Trojan Source). */
const RLM = String.fromCodePoint(0x200f);
const RLO = String.fromCodePoint(0x202e);
const ZWSP = String.fromCodePoint(0x200b);
const BOM = String.fromCodePoint(0xfeff);

const INPUT: SignInput = {
  amountMinor: 1000,
  order: ORDER,
  moreData: true,
  client: {
    firstName: "Test",
    lastName: "Payer",
    email: "payer@example.invalid",
    cell: "0500000000",
  },
};
const SENT = { masof: CREDS.masof, amountMinor: 1000, order: ORDER, moreData: true };

/** Joins raw pairs as they would appear on the wire (no encoding: values are given already encoded). */
const q = (...pairs: [string, string][]) => pairs.map(([k, v]) => `${k}=${v}`).join("&");
const names = (query: string) => query.split("&").map((s) => s.split("=")[0] ?? "");

/** What Hyp's SIGN answer looks like: the sent parameters minus credentials, action=pay, a signature (ASCII order, as the docs example). */
function hypSignResponse(
  pairs: [string, string][],
  edit?: (m: Map<string, string>) => void,
): string {
  const m = new Map(pairs.filter(([k]) => !SECRET_NAMES.includes(k)));
  m.set("action", "pay");
  edit?.(m);
  const sorted = [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const signature = m.has("signature") ? [] : [["signature", FAKE_SIGNATURE] as [string, string]];
  return encodeParams([...sorted, ...signature]);
}
const okSignBody = () => hypSignResponse(buildSignParams(CREDS, INPUT));

/** A documented success return (creating-a-payment-page) with fake values, plus the MoreData fields. */
const BASE_RETURN: [string, string][] = [
  ["Id", "12345"],
  ["CCode", "0"],
  ["Amount", "10.00"],
  ["ACode", "0000001"],
  ["Order", ORDER],
  ["Fild1", "Test%20Payer"],
  ["Fild2", "payer%40example.invalid"],
  ["Fild3", ""],
  ["Sign", FAKE_SIGNATURE],
];
const MOREDATA_RETURN: [string, string][] = [
  ...BASE_RETURN,
  ["Bank", "6"],
  ["Payments", "1"],
  ["Brand", "2"],
  ["Issuer", "2"],
  ["L4digit", "0000"],
  ["Coin", "1"],
  ["Hesh", "0"],
  ["UID", "fakeuid"],
  ["spType", "0"],
];

const thrownBy = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
};

describe("DM-PAY-1: SIGN request — a closed allow-list, never anything else", () => {
  // Independent of the code under test: every Hyp parameter that DEMO must never send (evidence 01 §1.2 "Not
  // sent in DEMO", §4.2; plan §3.2): Israeli ID, installments, J5/postpone, recurring, invoices, Hyp e-mails,
  // undocumented-for-APISign inputs, token/refund/payout names.
  const FORBIDDEN = [
    "UserId",
    "Tash",
    "FixTash",
    "tashType",
    "ShowEngTashText",
    "J5",
    "Postpone",
    "HK",
    "freq",
    "TashFirstPayment",
    "FirstPaymentTash",
    "OnlyOnApprove",
    "SendHesh",
    "sendHeshSMS",
    "Pritim",
    "heshDesc",
    "EZ.lang",
    "EZ.comment",
    "EZ.description",
    "EZ.email_text",
    "EZ.vat",
    "EZ.cc_emails",
    "EZ.customer_crn",
    "sendemail",
    "Info",
    "tmp",
    "street",
    "city",
    "UTF8",
    "UTF8out",
    "Fild1",
    "Fild2",
    "Fild3",
    "tOwner",
    "Token",
    "zPass",
    "TransId",
    "type",
  ].map((n) => n.toLowerCase());
  const ALLOWED = new Set<string>(SIGN_PARAM_ORDER);

  const VARIANTS: SignInput[] = [
    INPUT,
    { amountMinor: 1, order: ORDER, moreData: false },
    { amountMinor: 5000, order: "f".repeat(32), moreData: true, client: {} },
    {
      amountMinor: 1050,
      order: ORDER,
      moreData: true,
      client: {
        firstName: "A&Tash=12&J5=True",
        lastName: "B?HK=True",
        email: "x&SendHesh=True",
        cell: "1&EZ.vat=0",
      },
    },
    {
      amountMinor: 999_999,
      order: ORDER,
      moreData: false,
      client: { firstName: "ישראל", lastName: "ישראלי" },
    },
  ];

  it("DM-PAY-1: exactly the documented DEMO set, in order, with fixed values", () => {
    const pairs = buildSignParams(CREDS, INPUT);
    expect(pairs.map(([k]) => k)).toEqual([
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
      "ClientName",
      "ClientLName",
      "email",
      "cell",
    ]);
    expect(Object.fromEntries(pairs)).toEqual({
      action: "APISign",
      What: "SIGN",
      Masof: CREDS.masof,
      KEY: CREDS.key,
      PassP: CREDS.passp,
      Amount: "10.00",
      Coin: "1",
      Order: ORDER,
      Sign: "True",
      MoreData: "True",
      hideBtns: "True",
      PageLang: "HEB",
      ClientName: "Test",
      ClientLName: "Payer",
      email: "payer@example.invalid",
      cell: "0500000000",
    });
  });

  it("DM-PAY-1: MoreData only when asked; customer fields only when given and non-empty", () => {
    const bare = buildSignParams(CREDS, { amountMinor: 1, order: ORDER, moreData: false });
    expect(bare.map(([k]) => k)).toEqual([
      "action",
      "What",
      "Masof",
      "KEY",
      "PassP",
      "Amount",
      "Coin",
      "Order",
      "Sign",
      "hideBtns",
      "PageLang",
    ]);
    expect(Object.fromEntries(bare)["Amount"]).toBe("0.01");
    const blanks = buildSignParams(CREDS, {
      amountMinor: 100,
      order: ORDER,
      moreData: true,
      client: { firstName: "   ", lastName: `${RLM}\u0000`, email: "", cell: "\t" },
    });
    expect(blanks.some(([k]) => ["ClientName", "ClientLName", "email", "cell"].includes(k))).toBe(
      false,
    );
  });

  it("DM-PAY-1: every variant stays inside the allow-list, in allow-list order", () => {
    for (const input of VARIANTS) {
      const keys = buildSignParams(CREDS, input).map(([k]) => k);
      for (const k of keys) expect(ALLOWED.has(k), k).toBe(true);
      const positions = keys.map((k) =>
        SIGN_PARAM_ORDER.indexOf(k as (typeof SIGN_PARAM_ORDER)[number]),
      );
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("DM-PAY-1: no forbidden parameter ever appears — not as a pair, not in the encoded query (injection via customer fields is encoded)", () => {
    for (const input of VARIANTS) {
      const pairs = buildSignParams(CREDS, input);
      for (const [k] of pairs) expect(FORBIDDEN, k).not.toContain(k.toLowerCase());
      const query = encodeParams(pairs);
      for (const n of names(query)) expect(FORBIDDEN, n).not.toContain(n.toLowerCase());
      expect(names(query)).toEqual(pairs.map(([k]) => k));
      // the decoded query gives back exactly the same pairs, same order
      expect([...new URLSearchParams(query).entries()]).toEqual(pairs);
    }
  });

  it("DM-PAY-1: customer fields are trimmed, stripped of control/format characters and capped", () => {
    const pairs = buildSignParams(CREDS, {
      amountMinor: 100,
      order: ORDER,
      moreData: true,
      client: {
        firstName: `  Te\r\nst\u0000 ${RLO}Name${ZWSP}  `,
        lastName: "א".repeat(80),
        email: `${"e".repeat(250)}@x.invalid`,
        cell: "0".repeat(21),
      },
    });
    const values = Object.fromEntries(pairs);
    expect(values["ClientName"]).toBe("Test Name");
    expect(Array.from(values["ClientLName"] ?? "")).toHaveLength(50);
    // a cut e-mail or phone would be wrong data: dropped, not cut
    expect(values["email"]).toBeUndefined();
    expect(values["cell"]).toBeUndefined();
    for (const [, v] of pairs) expect(v).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    // a surrogate pair is never split by the cap
    const emoji = buildSignParams(CREDS, {
      amountMinor: 100,
      order: ORDER,
      moreData: false,
      client: { firstName: `${"a".repeat(49)}😀😀` },
    });
    expect(Object.fromEntries(emoji)["ClientName"]).toBe(`${"a".repeat(49)}😀`);
    expect(() => encodeParams(emoji)).not.toThrow();
  });

  it("DM-PAY-1: refuses a bad amount, order, terminal or credential — and the error never carries a value", () => {
    const bad: [Partial<MaxCredentials>, Partial<SignInput>, string][] = [
      [{}, { amountMinor: 0 }, "amount"],
      [{}, { amountMinor: -100 }, "amount"],
      [{}, { amountMinor: 10.5 }, "amount"],
      [{}, { amountMinor: Number.NaN }, "amount"],
      [{}, { amountMinor: Number.POSITIVE_INFINITY }, "amount"],
      [{}, { amountMinor: 2 ** 53 }, "amount"],
      [{}, { amountMinor: "1000" as unknown as number }, "amount"],
      [{}, { order: ORDER.toUpperCase() }, "order"],
      [{}, { order: ORDER.slice(1) }, "order"],
      [{}, { order: `${ORDER}0` }, "order"],
      [{}, { order: `${ORDER.slice(0, 31)}g` }, "order"],
      [{}, { order: `${ORDER.slice(0, 30)}&x` }, "order"],
      [{}, { moreData: "true" as unknown as boolean }, "more_data"],
      [{ masof: "999999990" }, {}, "masof"],
      [{ masof: "99999999011" }, {}, "masof"],
      [{ masof: "99999abcde" }, {}, "masof"],
      [{ masof: " 9999999901" }, {}, "masof"],
      [{ key: "" }, {}, "key"],
      [{ key: "FAKE\r\nKEY" }, {}, "key"],
      [{ key: "FAKE\u0000KEY" }, {}, "key"],
      [{ key: "x".repeat(257) }, {}, "key"],
      [{ passp: "" }, {}, "passp"],
      [{ passp: "FAKE\nPASSP" }, {}, "passp"],
      [{ passp: `FAKE${RLO}PASSP` }, {}, "passp"],
    ];
    for (const [credPatch, inputPatch, field] of bad) {
      const creds = { ...CREDS, ...credPatch };
      const e = thrownBy(() => buildSignParams(creds, { ...INPUT, ...inputPatch }));
      expect(e, field).toBeInstanceOf(MaxProtocolInputError);
      expect((e as MaxProtocolInputError).field).toBe(field);
      const message = String((e as Error).message);
      for (const secret of [creds.key, creds.passp, creds.masof].filter((s) => s.length > 3))
        expect(message).not.toContain(secret);
    }
  });

  it("DM-PAY-1: encodeParams percent-encodes every value (RFC 3986; space is %20, never +)", () => {
    expect(
      encodeParams([
        ["a", "b c"],
        ["x", "é&=+?#%"],
        ["y", "!'()*~-._"],
        ["z", ""],
        ["EZ.lang", "he"],
      ]),
    ).toBe("a=b%20c&x=%C3%A9%26%3D%2B%3F%23%25&y=%21%27%28%29%2A~-._&z=&EZ.lang=he");
    expect(() => encodeParams([["bad name", "x"]])).toThrow(MaxProtocolInputError);
    expect(() => encodeParams([["", "x"]])).toThrow(MaxProtocolInputError);
    expect(() => encodeParams([["a", "\ud800"]])).toThrow(MaxProtocolInputError);
  });
});

describe("DM-PAY-2: SIGN response — signature, action=pay, echoes, no credentials", () => {
  it("DM-PAY-2: a documented success gives the payment URL = endpoint + '?' + the trimmed body, byte for byte", () => {
    const body = okSignBody();
    const res = validateSignResponse(`${body}\r\n`, SENT, ENDPOINT);
    expect(res).toEqual({
      ok: true,
      payUrl: `${ENDPOINT}?${body}`,
      echo: {
        Masof: CREDS.masof,
        Coin: "1",
        Order: ORDER,
        Sign: "True",
        MoreData: "True",
        Amount: "10.00",
      },
    });
    // nothing re-encoded or re-ordered: %20, %40, "+" and %XX bytes stay as Hyp sent them
    const raw = `${body}&Extra1=a+b&Extra2=%E0%E1`.replace(
      "ClientName=Test",
      "ClientName=Test%20One",
    );
    const res2 = validateSignResponse(raw, SENT, ENDPOINT);
    expect(res2.ok && res2.payUrl).toBe(`${ENDPOINT}?${raw}`);
    expect(raw).toContain("email=payer%40example.invalid");
  });

  it("DM-PAY-2: HTML is a system error, even when it contains CCode=0 or a signature", () => {
    for (const body of [
      "<html><body>CCode=0</body></html>",
      "  \n<!DOCTYPE html><title>x</title>",
      `${okSignBody()}<html>`,
      "<p>signature=1&action=pay</p>",
    ])
      expect(validateSignResponse(body, SENT, ENDPOINT)).toEqual({ ok: false, code: "html" });
  });

  it("DM-PAY-2: a non-zero CCode is a failure with that code; CCode=0 next to a valid signature is accepted", () => {
    expect(validateSignResponse("CCode=902", SENT, ENDPOINT)).toEqual({
      ok: false,
      code: "ccode",
      ccode: "902",
    });
    expect(validateSignResponse("CCode=904\n", SENT, ENDPOINT)).toEqual({
      ok: false,
      code: "ccode",
      ccode: "904",
    });
    expect(validateSignResponse(`${okSignBody()}&ccode=1`, SENT, ENDPOINT)).toEqual({
      ok: false,
      code: "ccode",
      ccode: "1",
    });
    expect(validateSignResponse(`CCode=0&${okSignBody()}`, SENT, ENDPOINT).ok).toBe(true);
  });

  it("DM-PAY-2: no signature, or action not changed to pay → refused", () => {
    const pairs = buildSignParams(CREDS, INPUT);
    expect(
      validateSignResponse(
        hypSignResponse(pairs, (m) => m.set("signature", "")),
        SENT,
        ENDPOINT,
      ),
    ).toEqual({
      ok: false,
      code: "no_signature",
    });
    const noSig = okSignBody().replace(/&signature=[^&]*$/, "");
    expect(validateSignResponse(noSig, SENT, ENDPOINT)).toEqual({
      ok: false,
      code: "no_signature",
    });
    for (const edit of [
      (m: Map<string, string>) => m.delete("action"),
      (m: Map<string, string>) => m.set("action", "APISign"),
    ])
      expect(validateSignResponse(hypSignResponse(pairs, edit), SENT, ENDPOINT)).toEqual({
        ok: false,
        code: "no_action_pay",
      });
  });

  it("DM-PAY-2: any KEY/PassP name in the answer (any case, %-encoded, even empty) → secret_echo, never a URL", () => {
    const body = okSignBody();
    for (const extra of [
      q(["KEY", "x"]),
      q(["PassP", "x"]),
      q(["key", ""]),
      q(["PASSP", "x"]),
      q(["%4BEY", "x"]),
      q(["zPass", "x"]),
      "PassP",
    ]) {
      expect(validateSignResponse(`${body}&${extra}`, SENT, ENDPOINT), extra).toEqual({
        ok: false,
        code: "secret_echo",
      });
      expect(validateSignResponse(`${extra}&${body}`, SENT, ENDPOINT), extra).toEqual({
        ok: false,
        code: "secret_echo",
      });
    }
    const echoed = encodeParams(buildSignParams(CREDS, INPUT)).replace(
      "action=APISign",
      "action=pay",
    );
    expect(validateSignResponse(`${echoed}&signature=${FAKE_SIGNATURE}`, SENT, ENDPOINT)).toEqual({
      ok: false,
      code: "secret_echo",
    });
  });

  it("DM-PAY-2: Masof, Amount, Coin, Order, Sign and MoreData must come back as sent", () => {
    const pairs = buildSignParams(CREDS, INPUT);
    const edits: [string, (m: Map<string, string>) => void][] = [
      ["other terminal", (m) => m.set("Masof", "9999999902")],
      ["masof missing", (m) => m.delete("Masof")],
      ["amount changed", (m) => m.set("Amount", "10.01")],
      ["amount missing", (m) => m.delete("Amount")],
      ["amount not a decimal", (m) => m.set("Amount", "10,00")],
      ["other currency", (m) => m.set("Coin", "2")],
      ["coin missing", (m) => m.delete("Coin")],
      ["other order", (m) => m.set("Order", "f".repeat(32))],
      ["order missing", (m) => m.delete("Order")],
      ["sign false", (m) => m.set("Sign", "False")],
      ["sign missing", (m) => m.delete("Sign")],
      ["moredata dropped", (m) => m.delete("MoreData")],
      ["moredata false", (m) => m.set("MoreData", "False")],
      ["installments added", (m) => m.set("Tash", "12")],
      ["J5 added", (m) => m.set("J5", "True")],
      ["recurring added", (m) => m.set("HK", "True")],
      ["invoice added", (m) => m.set("SendHesh", "True")],
      ["invoice option added", (m) => m.set("EZ.lang", "he")],
      ["israeli id added", (m) => m.set("UserId", "000000000")],
    ];
    for (const [label, edit] of edits)
      expect(validateSignResponse(hypSignResponse(pairs, edit), SENT, ENDPOINT), label).toEqual({
        ok: false,
        code: "mismatch",
      });
    // MoreData back although it was not sent
    const noMore = buildSignParams(CREDS, { ...INPUT, moreData: false });
    const sentNoMore = { ...SENT, moreData: false };
    expect(validateSignResponse(hypSignResponse(noMore), sentNoMore, ENDPOINT).ok).toBe(true);
    expect(
      validateSignResponse(
        hypSignResponse(noMore, (m) => m.set("MoreData", "True")),
        sentNoMore,
        ENDPOINT,
      ),
    ).toEqual({
      ok: false,
      code: "mismatch",
    });
    // the same amount written differently is the same agorot ("10", "10.0" for 1000)
    for (const amount of ["10", "10.0", "10.00"])
      expect(
        validateSignResponse(
          hypSignResponse(pairs, (m) => m.set("Amount", amount)),
          SENT,
          ENDPOINT,
        ).ok,
        amount,
      ).toBe(true);
  });

  it("DM-PAY-2: malformed answers (empty, JSON, duplicates, broken pairs or escapes, raw spaces) are refused", () => {
    const body = okSignBody();
    for (const bad of [
      "",
      "   \r\n",
      '{"CCode":0}',
      `${body}&Order=${ORDER}`,
      `${body}&order=${ORDER}`,
      `${body}&&x=1`,
      `${body}&`,
      `${body}&novalue`,
      `${body}&=x`,
      `${body}&x=%G1`,
      `${body}&x=a b`,
      `${body}&x=a\nb`,
      `${body}&x=a"b`,
      `${body}&x=a{b}`,
      body.replace("Coin=1", "Coin=1&CCode=%FF"),
    ])
      expect(validateSignResponse(bad, SENT, ENDPOINT), JSON.stringify(bad)).toEqual({
        ok: false,
        code: "malformed",
      });
    // an echo that does not decode is a mismatch, not a value
    expect(validateSignResponse(body.replace("Coin=1", "Coin=%FF"), SENT, ENDPOINT)).toEqual({
      ok: false,
      code: "mismatch",
    });
  });

  it("DM-PAY-2: a bad endpoint or a bad 'sent' record is a programming error (thrown, no value in the message)", () => {
    for (const endpoint of [
      "",
      "pay.example.invalid/p/",
      "https://pay.example.invalid/p/?x=1",
      "https://a b/",
      "javascript:alert(1)",
    ])
      expect(() => validateSignResponse(okSignBody(), SENT, endpoint), endpoint).toThrow(
        MaxProtocolInputError,
      );
    expect(() => validateSignResponse(okSignBody(), { ...SENT, amountMinor: 0 }, ENDPOINT)).toThrow(
      MaxProtocolInputError,
    );
    expect(() => validateSignResponse(okSignBody(), { ...SENT, order: "x" }, ENDPOINT)).toThrow(
      MaxProtocolInputError,
    );
    expect(() => validateSignResponse(okSignBody(), { ...SENT, masof: "" }, ENDPOINT)).toThrow(
      MaxProtocolInputError,
    );
  });
});

describe("DM-PAY-3: return parsing — raw kept, duplicate and reserved names refused", () => {
  it("DM-PAY-3: a documented return keeps the raw string and the original order; fields are decoded", () => {
    const raw = q(...BASE_RETURN);
    const r = parseReturnQuery(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.raw).toBe(raw);
    expect(r.pairs).toEqual(BASE_RETURN);
    expect(r).toMatchObject({
      ccode: "0",
      id: "12345",
      order: ORDER,
      amountMinor: 1000,
      acode: "0000001",
      coin: null,
      payments: null,
      brand: null,
      last4: null,
      flags: [],
    });
  });

  it("DM-PAY-3: MoreData fields (both spType/SpType and bincard/BinCard spellings)", () => {
    for (const extra of [
      [
        ["SpType", "0"],
        ["BinCard", "000000"],
      ],
      [["bincard", "000000"]],
    ] as [string, string][][]) {
      const r = parseReturnQuery(q(...MOREDATA_RETURN.filter(([k]) => k !== "spType"), ...extra));
      expect(r.ok).toBe(true);
      if (r.ok)
        expect(r).toMatchObject({ coin: "1", payments: 1, brand: "2", last4: "0000", flags: [] });
    }
  });

  it("DM-PAY-3: Windows-1255 and UTF-8 bytes in Fild1/Info/errMsg are kept byte for byte (never decoded or re-encoded)", () => {
    const pairs = BASE_RETURN.map(([k, v]): [string, string] => [k, k === "Fild3" ? "%D7%99" : v]);
    const raw = q(
      ...pairs,
      ["Info", "%EC%EC%E0%20%FA%E9%E0%E5%F8"],
      ["errMsg", "%FA%F7%E9%EF%20(0)"],
    );
    const r = parseReturnQuery(raw);
    expect(r.ok && r.raw).toBe(raw);
    expect(buildVerifyQuery(CREDS, raw).endsWith(`&${raw}`)).toBe(true);
  });

  it("DM-PAY-3: empty, over-long and malformed queries are refused", () => {
    expect(parseReturnQuery("")).toEqual({ ok: false, reason: "empty" });
    const long = `${q(...BASE_RETURN)}&Fild9=`;
    const exact = long + "x".repeat(RETURN_MAX_LENGTH - long.length);
    expect(exact).toHaveLength(4096);
    expect(parseReturnQuery(exact).ok).toBe(true);
    expect(parseReturnQuery(`${exact}x`)).toEqual({ ok: false, reason: "too_long" });
    for (const bad of [
      `?${q(...BASE_RETURN)}`,
      `${q(...BASE_RETURN)}&`,
      `${q(...BASE_RETURN)}&&Bank=6`,
      `${q(...BASE_RETURN)}&Bank`,
      `${q(...BASE_RETURN)}&=6`,
      `${q(...BASE_RETURN)}#frag`,
      `${q(...BASE_RETURN)}&Bank=6 7`,
      `${q(...BASE_RETURN)}&Bank=6\n`,
      `${q(...BASE_RETURN)}&Bank=<6>`,
      `${q(...BASE_RETURN)}&Bank="6"`,
      `${q(...BASE_RETURN)}&Bank=ו`,
      `${q(...BASE_RETURN)}&%4BEY=x`,
      `${q(...BASE_RETURN)}&Ba%6Ek=6`,
      `${q(...BASE_RETURN)}&1Bank=6`,
    ])
      expect(parseReturnQuery(bad), JSON.stringify(bad)).toEqual({
        ok: false,
        reason: "malformed",
      });
  });

  it("DM-PAY-3: a repeated name (case-insensitive) is refused", () => {
    for (const extra of [
      ["Amount", "1.00"],
      ["amount", "10.00"],
      ["CCODE", "0"],
      ["order", ORDER],
      ["Fild3", ""],
    ] as [string, string][])
      expect(parseReturnQuery(q(...BASE_RETURN, extra)), extra[0]).toEqual({
        ok: false,
        reason: "duplicate_key",
      });
    expect(parseReturnQuery(q(...BASE_RETURN, ["spType", "0"], ["SpType", "0"]))).toEqual({
      ok: false,
      reason: "duplicate_key",
    });
    expect(parseReturnQuery(q(...BASE_RETURN, ["bincard", "1"], ["BinCard", "1"]))).toEqual({
      ok: false,
      reason: "duplicate_key",
    });
  });

  it("DM-PAY-3: names only we send (KEY, PassP, action, What — and Masof) are refused in any case", () => {
    for (const name of [
      "KEY",
      "key",
      "PassP",
      "PASSP",
      "passp",
      "action",
      "Action",
      "What",
      "WHAT",
      "Masof",
      "masof",
    ]) {
      expect(parseReturnQuery(q(...BASE_RETURN, [name, "x"])), name).toEqual({
        ok: false,
        reason: "reserved_key",
      });
      expect(parseReturnQuery(q([name, ""], ...BASE_RETURN)), name).toEqual({
        ok: false,
        reason: "reserved_key",
      });
    }
  });

  it("DM-PAY-3: field shapes — junk never reads as a value, and a junk Id/Payments refuses the whole return", () => {
    const with_ = (k: string, v: string) =>
      q(...MOREDATA_RETURN.map(([n, x]): [string, string] => [n, n === k ? v : x]));
    const field = (k: string, v: string) => {
      const r = parseReturnQuery(with_(k, v));
      return r.ok ? r : null;
    };
    expect(field("Amount", "10.5")?.amountMinor).toBe(1050);
    expect(field("Amount", "21.1")?.amountMinor).toBe(2110);
    expect(field("Amount", "10%2E50")?.amountMinor).toBe(1050);
    for (const v of ["", "abc", "10.005", "-10", "1e3", "10%20"])
      expect(field("Amount", v)?.amountMinor, v).toBeNull();
    expect(field("Order", ORDER.toUpperCase())?.order).toBeNull();
    expect(field("Order", "")?.order).toBeNull();
    expect(field("Order", "12345678910")?.order).toBeNull();
    expect(field("CCode", "")?.ccode).toBeNull();
    expect(field("CCode", "%FF")?.ccode).toBeNull();
    expect(field("CCode", "600")?.ccode).toBe("600");
    expect(field("Id", "")?.id).toBeNull();
    expect(field("L4digit", "12345")?.last4).toBeNull();
    expect(field("L4digit", "12a4")?.last4).toBeNull();
    expect(field("Brand", "%3Cb%3E")?.brand).toBeNull();
    expect(field("ACode", "00%2000")?.acode).toBeNull();
    expect(field("Payments", "")?.payments).toBeNull();
    expect(field("Payments", "3")?.payments).toBe(3);
    for (const v of ["x", "1.0", "-1", "%20", "1%201", "%FF", "1234"])
      expect(parseReturnQuery(with_("Payments", v)), `Payments=${v}`).toEqual({
        ok: false,
        reason: "malformed",
      });
    for (const v of ["1%202", "%FF", "a/b", "x".repeat(65)])
      expect(parseReturnQuery(with_("Id", v)), `Id=${v}`).toEqual({
        ok: false,
        reason: "malformed",
      });
    // the documented 3DS example has an empty Order: parsed, order null (cannot match an attempt)
    expect(field("Order", "")).not.toBeNull();
  });
});

describe("DM-PAY-4: VERIFY — only exactly CCode=0; HTML is never verified", () => {
  it("DM-PAY-4: the request is action, What, Masof, KEY, PassP, then the raw return unchanged", () => {
    const raw = q(...BASE_RETURN, ["Info", "%EC%E0+%E1"], ["MULTI", "[1~CC~x~4.16~5614~0000001]"]);
    const query = buildVerifyQuery(CREDS, raw);
    expect(names(query).slice(0, 5)).toEqual(["action", "What", "Masof", "KEY", "PassP"]);
    const prefix = encodeParams([
      ["action", "APISign"],
      ["What", "VERIFY"],
      ["Masof", CREDS.masof],
      ["KEY", CREDS.key],
      ["PassP", CREDS.passp],
    ]);
    expect(query).toBe(`${prefix}&${raw}`);
  });

  it("DM-PAY-4: a refused return is never verified; bad credentials are refused without echoing them", () => {
    for (const raw of [
      "",
      q(...BASE_RETURN, ["PassP", "x"]),
      q(...BASE_RETURN, ["Amount", "1"]),
      "a b",
    ])
      expect(() => buildVerifyQuery(CREDS, raw), raw).toThrow(MaxProtocolInputError);
    const e = thrownBy(() =>
      buildVerifyQuery({ ...CREDS, passp: "FAKE\r\nPASSP" }, q(...BASE_RETURN)),
    );
    expect(e).toBeInstanceOf(MaxProtocolInputError);
    expect(String((e as Error).message)).not.toContain("FAKE");
  });

  it("DM-PAY-4: verified only for the exact body CCode=0 (a trailing CR/LF is tolerated)", () => {
    for (const body of ["CCode=0", "CCode=0\r\n", "CCode=0\n", "CCode=0\r", "CCode=0\r\n\r\n"])
      expect(classifyVerifyResponse(body), JSON.stringify(body)).toEqual({
        verified: true,
        ccode: "0",
        html: false,
      });
  });

  it("DM-PAY-4: everything else is not verified (00, spaces, case, duplicates, extra keys, empty, JSON)", () => {
    const cases: [string, string | null][] = [
      ["CCode=00", "00"],
      ["CCode= 0", " 0"],
      ["CCode=0 ", "0 "],
      [" CCode=0", null],
      ["ccode=0", null],
      ["CCODE=0", null],
      ["CCode=0&CCode=1", null],
      ["CCode=0&CCode=0", null],
      ["CCode=0&ccode=0", null],
      ["CCode=0&Id=1", "0"],
      ["Id=1&CCode=0", "0"],
      ["CCode=0\r\nX", "0\r\nX"],
      [`${BOM}CCode=0`, null],
      ["CCode=0%00", "0%00"],
      ["CCode=", ""],
      ["CCode", null],
      ["", null],
      ['{"CCode":0}', null],
      ["CCode=200", "200"],
      ["CCode=902", "902"],
      ["CCode=904\r\n", "904"],
    ];
    for (const [body, ccode] of cases)
      expect(classifyVerifyResponse(body), JSON.stringify(body)).toEqual({
        verified: false,
        ccode,
        html: false,
      });
  });

  it("DM-PAY-4: HTML (even with CCode=0 inside) is never verified and is marked html", () => {
    for (const body of [
      "<html>CCode=0</html>",
      "  <body>CCode=0",
      "CCode=0<html>",
      "\n<!doctype html>",
    ])
      expect(classifyVerifyResponse(body), body).toEqual({
        verified: false,
        ccode: null,
        html: true,
      });
  });
});

describe("DM-PAY-6: 600/700/800, HKId and MULTI → for review, never paid", () => {
  it("DM-PAY-6: the return CCode — 0 approved; 10 (partial approval) and 600/700/800 hold; everything else declined", () => {
    expect(classifyReturnCcode("0")).toBe("approved");
    for (const c of ["10", "600", "700", "800"]) expect(classifyReturnCcode(c), c).toBe("hold");
    for (const c of [
      null,
      "",
      "00",
      " 0",
      "0 ",
      "-0",
      "+0",
      "1",
      "010",
      "10 ",
      "4",
      "6",
      "33",
      "200",
      "401",
      "902",
      "990",
      "998",
      "999",
      "6000",
      "60",
      "080",
      "700 ",
      "abc",
    ])
      expect(classifyReturnCcode(c), String(c)).toBe("declined");
  });

  it("DM-PAY-6: HKId and MULTI are flagged (any value), never refused, so the return is still verified and reviewed", () => {
    const hk = parseReturnQuery(q(...MOREDATA_RETURN, ["HKId", "1"]));
    expect(hk.ok && hk.flags).toEqual(["hk"]);
    const hkEmpty = parseReturnQuery(q(...MOREDATA_RETURN, ["hkid", ""]));
    expect(hkEmpty.ok && hkEmpty.flags).toEqual(["hk"]);
    const multi = parseReturnQuery(
      q(...MOREDATA_RETURN, [
        "MULTI",
        "[1~CC~Brand~4.16~0000~0000001][2~Gift~Gift~1.84~0000~0000002]",
      ]),
    );
    expect(multi.ok && multi.flags).toEqual(["multi"]);
    const both = parseReturnQuery(q(...MOREDATA_RETURN, ["MULTI", ""], ["HKId", "7"]));
    expect(both.ok && both.flags).toEqual(["hk", "multi"]);
  });

  it("DM-PAY-6: a hold reads as 'for review' — never as paid or failed", () => {
    expect(messageKeyForReturnOutcome(classifyReturnCcode("700"))).toBe("needs_review");
    expect(messageKeyForReturnOutcome(classifyReturnCcode("0"))).toBe("approved");
    expect(messageKeyForReturnOutcome(classifyReturnCcode("4"))).toBe("declined");
  });
});

describe("DM-PAY-7: a returned Hesh/HeshASM is detected and flagged (no invoice parameter is ever sent)", () => {
  it("DM-PAY-7: Hesh or HeshASM non-empty and not 0 → document; 0, empty or absent → no flag", () => {
    const flagsOf = (...extra: [string, string][]) => {
      const r = parseReturnQuery(q(...BASE_RETURN, ...extra));
      return r.ok ? r.flags : null;
    };
    expect(flagsOf()).toEqual([]);
    expect(flagsOf(["Hesh", "0"])).toEqual([]);
    expect(flagsOf(["Hesh", ""])).toEqual([]);
    expect(flagsOf(["Hesh", "%30"])).toEqual([]);
    expect(flagsOf(["HeshASM", "0"], ["Hesh", ""])).toEqual([]);
    for (const value of ["EZ", "12345", "00", "+", "%FF", "0.0"]) {
      expect(flagsOf(["Hesh", value]), `Hesh=${value}`).toEqual(["document"]);
      expect(flagsOf(["HeshASM", value]), `HeshASM=${value}`).toEqual(["document"]);
    }
    expect(flagsOf(["hesh", "EZ"])).toEqual(["document"]);
    expect(flagsOf(["Hesh", "EZ"], ["HKId", "1"], ["MULTI", "x"])).toEqual([
      "document",
      "hk",
      "multi",
    ]);
  });

  it("DM-PAY-7: SIGN never carries an invoice, document or Hyp e-mail parameter", () => {
    const query = encodeParams(buildSignParams(CREDS, INPUT));
    for (const n of names(query))
      expect(n).not.toMatch(
        /^(SendHesh|sendHeshSMS|Pritim|heshDesc|EZ\..*|sendemail|Hesh|HeshASM)$/i,
      );
  });
});

describe("money: integer agorot <-> Hyp decimal, string arithmetic only", () => {
  it("decimalToMinor accepts Hyp's documented forms exactly", () => {
    const ok: [string, number][] = [
      ["10", 1000],
      ["10.5", 1050],
      ["10.00", 1000],
      ["10.50", 1050],
      ["0.01", 1],
      ["0.1", 10],
      ["0", 0],
      ["0.00", 0],
      ["1", 100],
      ["21.1", 2110],
      // float traps: 0.29 * 100, 1.15 * 100, 4.35 * 100, 1.005 * 100 are not integers in floating point
      ["0.29", 29],
      ["1.15", 115],
      ["4.35", 435],
      ["8.20", 820],
      ["19.99", 1999],
      ["90071992547409.91", Number.MAX_SAFE_INTEGER],
    ];
    for (const [v, minor] of ok) expect(decimalToMinor(v), v).toBe(minor);
  });

  it("decimalToMinor refuses everything else", () => {
    for (const v of [
      "",
      " 10",
      "10 ",
      "+10",
      "-10",
      "-0",
      "10.",
      ".5",
      "10.005",
      "1.005",
      "1e3",
      "0x10",
      "10,5",
      "1,000",
      "010",
      "00.50",
      "١٠",
      "１０",
      "Infinity",
      "NaN",
      "10.5.0",
      "10.5a",
      "90071992547409.92",
      "99999999999999999999",
    ])
      expect(decimalToMinor(v), JSON.stringify(v)).toBeNull();
    expect(decimalToMinor(10 as unknown as string)).toBeNull();
  });

  it("minorToDecimal always writes two fraction digits", () => {
    const cases: [number, string][] = [
      [0, "0.00"],
      [1, "0.01"],
      [5, "0.05"],
      [10, "0.10"],
      [99, "0.99"],
      [100, "1.00"],
      [1050, "10.50"],
      [5000, "50.00"],
      [123456789, "1234567.89"],
      [Number.MAX_SAFE_INTEGER, "90071992547409.91"],
    ];
    for (const [minor, s] of cases) expect(minorToDecimal(minor), String(minor)).toBe(s);
    for (const bad of [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      2 ** 53,
      "100" as unknown as number,
    ])
      expect(() => minorToDecimal(bad), String(bad)).toThrow(MaxProtocolInputError);
  });

  it("round-trips exactly", () => {
    for (let minor = 0; minor <= 5000; minor += 1)
      expect(decimalToMinor(minorToDecimal(minor))).toBe(minor);
    for (const minor of [99_999_999, 1_000_000_007, 2 ** 52 + 1, Number.MAX_SAFE_INTEGER - 1])
      expect(decimalToMinor(minorToDecimal(minor))).toBe(minor);
  });
});

describe("fixed Hebrew messages (plan §6.2): one text per outcome class, never Hyp's text", () => {
  const KEYS: PaymentMessageKey[] = [
    "approved",
    "declined",
    "needs_review",
    "verification_pending",
    "unavailable",
    "credentials",
  ];

  it("every outcome class has a fixed Hebrew text", () => {
    expect(Object.keys(PAYMENT_MESSAGES).sort()).toEqual([...KEYS].sort());
    for (const k of KEYS) {
      expect(paymentMessage(k)).toBe(PAYMENT_MESSAGES[k]);
      expect(PAYMENT_MESSAGES[k]).toMatch(/[א-ת]/);
      // no codes or provider text, and no bidi controls
      expect(PAYMENT_MESSAGES[k]).not.toMatch(/[0-9]|CCode|Hyp|errMsg|\p{Cf}/u);
    }
    expect(new Set(Object.values(PAYMENT_MESSAGES)).size).toBe(KEYS.length);
  });

  it("gender-neutral wording: no second-person singular forms", () => {
    // ("את" is left out: it is also the gender-neutral direct-object marker)
    for (const k of KEYS)
      expect(PAYMENT_MESSAGES[k], k).not.toMatch(
        /(^|\s)(אתה|תוכל|תוכלי|נסה|נסי|בחר|בחרי|לחץ|לחצי|שלם|שלמי|הזן|הזיני|בדוק|בדקי|תבחר|תבחרי)(\s|[.,;]|$)/,
      );
  });

  it("whatever comes in, only the fixed texts come out", () => {
    const allowed = new Set(Object.values(PAYMENT_MESSAGES));
    for (const c of [
      null,
      "",
      "0",
      "902",
      "901",
      "999",
      "200",
      "<b>Hyp text</b>",
      "שגיאה של הספק",
    ]) {
      expect(allowed.has(paymentMessage(messageKeyForServiceCcode(c)))).toBe(true);
      expect(allowed.has(paymentMessage(messageKeyForReturnOutcome(classifyReturnCcode(c))))).toBe(
        true,
      );
    }
    expect(messageKeyForServiceCcode("902")).toBe("credentials");
    expect(messageKeyForServiceCcode("901")).toBe("credentials");
    expect(messageKeyForServiceCcode("999")).toBe("unavailable");
    expect(messageKeyForServiceCcode(null)).toBe("unavailable");
    expect(paymentMessage("bogus" as PaymentMessageKey)).toBe(PAYMENT_MESSAGES.unavailable);
    expect(paymentMessage("toString" as PaymentMessageKey)).toBe(PAYMENT_MESSAGES.unavailable);
  });

  it("a payer never sees the terminal-credentials text", () => {
    expect(payerMessageKey("credentials")).toBe("unavailable");
    for (const k of KEYS.filter((x) => x !== "credentials")) expect(payerMessageKey(k)).toBe(k);
  });
});

describe("provider registry: one provider, every optional capability off (3DS is an extension point only)", () => {
  it("PROVIDERS.max: hosted page only; no 3DS, refunds or tokens", () => {
    expect(Object.keys(PROVIDERS)).toEqual(["max"]);
    expect(PROVIDERS.max).toEqual({
      hostedPage: true,
      threeDS: false,
      refunds: false,
      tokens: false,
    });
    expect(Object.isFrozen(PROVIDERS)).toBe(true);
    expect(Object.isFrozen(PROVIDERS.max)).toBe(true);
  });

  it("isProviderId accepts only registered ids", () => {
    expect(isProviderId("max")).toBe(true);
    for (const v of ["grow", "MAX", "", "__proto__", "constructor", "toString", null, 1])
      expect(isProviderId(v), String(v)).toBe(false);
  });
});
