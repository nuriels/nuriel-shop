// MAX/Hyp DEMO — DM-SEC-7: one redactor for every payment log line (src/platform/payments/redact.ts).
// All values are obvious fakes. Card-like numbers are generated here at run time from a "00…" body (no card
// network issues numbers there) — never a real card or a published test card, and no such literal in Git.
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { redactPaymentText } from "@/platform/payments/redact";
import { buildSignParams, buildVerifyQuery, encodeParams } from "@/platform/payments/max/protocol";
import type { MaxCredentials } from "@/platform/payments/provider";

const CREDS: MaxCredentials = {
  masof: "9999999901",
  key: "FAKE_KEY_unit",
  passp: "FAKE_PASSP_unit",
};
const ORDER = "0123456789abcdef0123456789abcdef";
const SIGNATURE = "ab".repeat(32);
const CANARIES = [
  CREDS.key,
  CREDS.passp,
  CREDS.masof,
  SIGNATURE,
  "payer@example.invalid",
  "0500000000",
  "Tester",
  "Payerson",
];

const q = (...pairs: [string, string][]) => pairs.map(([k, v]) => `${k}=${v}`).join("&");
const expectNoCanary = (text: string) => {
  for (const c of CANARIES) expect(text, c).not.toContain(c);
};

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return sum % 10 === 0;
}
const withCheckDigit = (body: string) => {
  for (let d = 0; d <= 9; d += 1) if (luhn(`${body}${d}`)) return `${body}${d}`;
  throw new Error("unreachable");
};
const PAN13 = withCheckDigit("001234567890");
const PAN15 = withCheckDigit("00987654321098");
const PAN16 = withCheckDigit("001234567890123");
const PAN19 = withCheckDigit("001122334455667788");
const NOT_LUHN16 = `${PAN16.slice(0, -1)}${(Number(PAN16.slice(-1)) + 1) % 10}`;
const LUHN12 = withCheckDigit("00123456789");
const LUHN20 = withCheckDigit("0012345678901234567");
const group4 = (pan: string, sep: string) => pan.match(/.{1,4}/g)!.join(sep);

describe("DM-SEC-7: one redactor for every payment log line", () => {
  const FULL = [
    "KEY",
    "PassP",
    "zPass",
    "Sign",
    "signature",
    "UserId",
    "bincard",
    "BinCard",
    "Tmonth",
    "Tyear",
    "L4digit",
    "cell",
    "email",
    "ClientName",
    "ClientLName",
    "Fild1",
    "Fild2",
    "Fild3",
    "street",
    "city",
    "zip",
    "UID",
  ];

  it("DM-SEC-7: every listed name is masked in a query string, in any case, and nothing else changes", () => {
    for (const name of FULL)
      for (const variant of [name, name.toLowerCase(), name.toUpperCase()]) {
        expect(redactPaymentText(`?${variant}=v4lue-1&Amount=10.00&Order=${ORDER}`), variant).toBe(
          `?${variant}=***&Amount=10.00&Order=${ORDER}`,
        );
        expect(redactPaymentText(`x ${variant}=v4lue-1 y`), variant).toBe(`x ${variant}=*** y`);
      }
  });

  it("DM-SEC-7: a SIGN query loses every secret and customer value; Masof keeps its last 2 digits", () => {
    const pairs = buildSignParams(CREDS, {
      amountMinor: 1000,
      order: ORDER,
      moreData: true,
      client: {
        firstName: "Tester",
        lastName: "Payerson",
        email: "payer@example.invalid",
        cell: "0500000000",
      },
    });
    const out = redactPaymentText(`GET https://pay.example.invalid/p/?${encodeParams(pairs)}`);
    expectNoCanary(out);
    expect(out).toBe(
      `GET https://pay.example.invalid/p/?${q(
        ["action", "APISign"],
        ["What", "SIGN"],
        ["Masof", "…01"],
        ["KEY", "***"],
        ["PassP", "***"],
        ["Amount", "10.00"],
        ["Coin", "1"],
        ["Order", ORDER],
        ["Sign", "***"],
        ["MoreData", "True"],
        ["hideBtns", "True"],
        ["PageLang", "HEB"],
        ["ClientName", "***"],
        ["ClientLName", "***"],
        ["email", "***"],
        ["cell", "***"],
      )}`,
    );
  });

  it("DM-SEC-7: a VERIFY query (credentials + raw return with MoreData fields) is fully masked", () => {
    const raw = q(
      ["Id", "12345"],
      ["CCode", "0"],
      ["Amount", "10.00"],
      ["ACode", "0000001"],
      ["Order", ORDER],
      ["Fild1", "Tester%20Payerson"],
      ["Fild2", "payer%40example.invalid"],
      ["Fild3", ""],
      ["Sign", SIGNATURE],
      ["UserId", "000000000"],
      ["L4digit", "4321"],
      ["cell", "0500000000"],
      ["Tmonth", "01"],
      ["Tyear", "2099"],
      ["UID", "fakeuid-77"],
      ["BinCard", "000000"],
    );
    const out = redactPaymentText(buildVerifyQuery(CREDS, raw));
    expectNoCanary(out);
    for (const leak of [
      "4321",
      "2099",
      "fakeuid-77",
      "000000000",
      "Tester%20Payerson",
      "payer%40example.invalid",
    ])
      expect(out).not.toContain(leak);
    expect(out).toContain(
      "Masof=…01&KEY=***&PassP=***&Id=12345&CCode=0&Amount=10.00&ACode=0000001",
    );
    expect(out).toContain("&Fild3=&Sign=***&UserId=***&L4digit=***");
  });

  it("DM-SEC-7: JSON-like text — quoted, single-quoted (util.inspect), numbers, nested and escaped strings", () => {
    expect(
      redactPaymentText(
        JSON.stringify({
          KEY: CREDS.key,
          PassP: CREDS.passp,
          Masof: CREDS.masof,
          Amount: "10.00",
          L4digit: 4321,
          inner: { signature: SIGNATURE, ccode: "0" },
        }),
      ),
    ).toBe(
      '{"KEY":"***","PassP":"***","Masof":"…01","Amount":"10.00","L4digit":***,"inner":{"signature":"***","ccode":"0"}}',
    );
    // console.log(creds) / util.inspect: unquoted names, single quotes
    expect(redactPaymentText(inspect(CREDS))).toBe("{ masof: '…01', key: '***', passp: '***' }");
    // spaces around the colon, escaped quotes inside the value
    expect(redactPaymentText('{ "PassP" : "ab\\"FAKE_PASSP_unit\\"cd", "x": 1 }')).toBe(
      '{ "PassP" : "***", "x": 1 }',
    );
    // JSON inside a JSON string (\"name\":\"value\")
    const nested = JSON.stringify({
      log: JSON.stringify({ PassP: CREDS.passp, email: "payer@example.invalid", note: "kept" }),
    });
    const out = redactPaymentText(nested);
    expectNoCanary(out);
    expect(out).toContain("kept");
    // a truncated log line still loses the value
    expect(redactPaymentText('{"KEY":"FAKE_KEY_unit')).not.toContain(CREDS.key);
  });

  it("DM-SEC-7: a %-encoded query (a URL inside a parameter) is masked too", () => {
    const query = buildVerifyQuery(
      CREDS,
      q(["Id", "1"], ["CCode", "0"], ["Order", ORDER], ["Sign", SIGNATURE]),
    );
    for (const wrapped of [
      encodeURIComponent(`https://pay.example.invalid/p/?${query}`),
      encodeURIComponent(query).toLowerCase(),
    ]) {
      const out = redactPaymentText(`next=${wrapped}`).toLowerCase();
      for (const c of CANARIES) expect(out, c).not.toContain(c.toLowerCase());
      expect(out).toContain("masof%3d…01");
    }
    expect(redactPaymentText("a%3FPassP%3Dsecret-1%26Amount%3D10")).toBe(
      "a%3FPassP%3D***%26Amount%3D10",
    );
    // an encoded "&" inside a plain value does not end the value early
    expect(redactPaymentText("PassP=ab%26cd&x=1")).toBe("PassP=***&x=1");
  });

  it("DM-SEC-7: terminal numbers keep only the last 2 digits (Masof, masof, terminal_number, terminalNumber)", () => {
    expect(
      redactPaymentText("verify ok ccode=0 method=GET masof=9999999901 payload=sha256:abcd"),
    ).toBe("verify ok ccode=0 method=GET masof=…01 payload=sha256:abcd");
    expect(
      redactPaymentText('{"terminal_number":"9999999902","terminalNumber":"9999999903"}'),
    ).toBe('{"terminal_number":"…02","terminalNumber":"…03"}');
    expect(redactPaymentText("Masof=12")).toBe("Masof=***");
    expect(redactPaymentText("Masof=")).toBe("Masof=");
  });

  it("DM-SEC-7: Luhn-valid 13–19 digit runs are masked — contiguous, grouped, or next to other numbers", () => {
    for (const pan of [PAN13, PAN15, PAN16, PAN19]) {
      expect(luhn(pan)).toBe(true);
      expect(redactPaymentText(`card ${pan} end`), pan.length.toString()).toBe("card [card] end");
      expect(redactPaymentText(`x=${pan}`)).toBe("x=[card]");
      expect(redactPaymentText(`{"n":${pan}}`)).toBe('{"n":[card]}');
    }
    expect(redactPaymentText(`pan ${group4(PAN16, " ")}.`)).toBe("pan [card].");
    expect(redactPaymentText(`pan ${group4(PAN16, "-")}.`)).toBe("pan [card].");
    // next to a timestamp, or followed by an expiry-like group: the card digits still go
    const ts = ["1764316800000", "1764316800001", "1764316800002"].find((t) => !luhn(t))!;
    for (const text of [
      `${ts} ${PAN16}`,
      `${group4(PAN16, " ")} 12 29`,
      `${PAN16}-0425`,
      `id:${PAN16}abc`,
    ]) {
      const out = redactPaymentText(text);
      expect(out, text).toContain("[card]");
      expect(out, text).not.toContain(PAN16);
      expect(out.replace(/\D/g, ""), text).not.toContain(PAN16);
    }
  });

  it("DM-SEC-7: not card-like → unchanged (Luhn-invalid, 12 or 20 digits, ordinary numbers)", () => {
    for (const text of [
      `n=${NOT_LUHN16}`,
      `n=${LUHN12}`,
      `n=${LUHN20}`,
      "Amount=10.00 Id=12345678 at 2026-11-28 10:15:00",
      `Order=${ORDER}`,
    ]) {
      expect(redactPaymentText(text), text).toBe(text);
    }
  });

  it("DM-SEC-7: other names are left alone; empty values stay empty", () => {
    for (const text of [
      "api_key=abc",
      "monkey=1",
      "Signal=1",
      "design=1",
      "x.Sign2=1",
      "CCode=0&Order=1&Amount=2",
    ])
      expect(redactPaymentText(text), text).toBe(text);
    expect(redactPaymentText("Fild3=&Sign=abc&email=")).toBe("Fild3=&Sign=***&email=");
  });

  it("DM-SEC-7: idempotent, never throws, linear on large input", () => {
    const corpus = [
      buildVerifyQuery(
        CREDS,
        q(["Id", "1"], ["CCode", "0"], ["Order", ORDER], ["Sign", SIGNATURE]),
      ),
      JSON.stringify({ masof: CREDS.masof, key: CREDS.key, n: PAN16 }),
      inspect(CREDS),
      `Masof=…01 KEY=*** [card]`,
    ];
    for (const text of corpus) {
      const once = redactPaymentText(text);
      expect(redactPaymentText(once)).toBe(once);
    }
    expect(() => redactPaymentText("\ud800KEY=\udfff&x")).not.toThrow();
    expect(redactPaymentText(1234 as unknown as string)).toBe("1234");
    // adversarial shapes: long backslash runs, many unterminated quoted values, long digit-group runs
    const inputs = [
      `${"PassP=".repeat(20_000)}${"9 ".repeat(100_000)}${"\\".repeat(100_000)}'"'"`.repeat(2),
      "KEY:'aaa,".repeat(50_000),
      '"email":"x,'.repeat(50_000),
      '\\\\\\"KEY\\\\\\":\\\\\\"x,'.repeat(20_000),
      `${"\\".repeat(200_000)}"KEY":"x"`,
      "1-".repeat(200_000),
    ];
    for (const input of inputs) {
      const started = Date.now();
      const out = redactPaymentText(input);
      expect(Date.now() - started, input.slice(0, 20)).toBeLessThan(3000);
      expect(out.length).toBeGreaterThan(0);
    }
  });
});
