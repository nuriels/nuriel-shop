// Billing & Agreements (מיגרציה 189) — בדיקת קלט ותצוגה (src/platform/billing/logic.ts). החישובים
// הכספיים עצמם במסד ונבדקים ב-scripts/db-tests/billing-agreements.test.sql.
import { describe, expect, it } from "vitest";
import {
  BillingInputError,
  balanceText,
  confirmationLabel,
  daysLeftText,
  formatDate,
  formatMoney,
  israelToday,
  parseAgreementInput,
  parseAmount,
  parseEntryInput,
  parseUuid,
  priceLine,
} from "@/platform/billing/logic";

describe("billing display", () => {
  it("formats shekels: whole amounts without agorot, fractions with two digits, negatives with a minus", () => {
    expect(formatMoney(400)).toBe("₪400");
    expect(formatMoney(1234.5)).toBe("₪1,234.50");
    expect(formatMoney(-30.51)).toBe("−₪30.51");
    expect(formatMoney(null)).toBe("—");
  });

  it("formats ISO dates as DD/MM/YYYY", () => {
    expect(formatDate("2026-11-14")).toBe("14/11/2026");
    expect(formatDate("2026-11-14T10:00:00+02:00")).toBe("14/11/2026");
    expect(formatDate(null)).toBe("—");
  });

  it("shows VAT clearly: included, excluded with the split, none, and the list price", () => {
    expect(priceLine({ gross: 200, net: 169.49, vat: 30.51, rate: 18, mode: "included" })).toBe(
      "₪200 כולל מע״מ 18%",
    );
    expect(priceLine({ gross: 236, net: 200, vat: 36, rate: 18, mode: "excluded" })).toBe(
      "₪200 + מע״מ 18% (₪36) = ₪236",
    );
    expect(priceLine({ gross: 200, net: 200, vat: 0, rate: 0, mode: "excluded" })).toBe(
      "₪200 (ללא מע״מ)",
    );
    expect(priceLine({ gross: 700, mode: "list" })).toBe("₪700 (לפי המחירון)");
    expect(priceLine(null)).toBe("—");
  });

  it("a manual payment is 'received (recorded by Nuriel)' — 'approved' only for a payment provider", () => {
    expect(confirmationLabel("manual")).toBe("התקבל (נרשם על ידי Nuriel)");
    expect(confirmationLabel("manual")).not.toContain("אושר");
    expect(confirmationLabel("provider")).toContain("אושר");
  });

  it("days left and balance texts", () => {
    expect(daysLeftText(0)).toBe("מסתיים היום");
    expect(daysLeftText(1)).toBe("נותר יום אחד");
    expect(daysLeftText(20)).toBe("נותרו 20 ימים");
    expect(daysLeftText(null)).toBe("ללא תאריך סיום");
    expect(balanceText(0)).toBe("אין יתרה");
    expect(balanceText(1360)).toBe("₪1,360 לתשלום");
    expect(balanceText(-10)).toBe("₪10 זכות");
  });

  it("today is the Israel calendar day", () => {
    // 22:30 UTC on 14/11 is already 15/11 in Israel (UTC+2)
    expect(israelToday(new Date("2026-11-14T22:30:00Z"))).toBe("2026-11-15");
    expect(israelToday(new Date("2026-11-14T10:00:00Z"))).toBe("2026-11-14");
  });
});

describe("billing input", () => {
  const base = { plan: "premium", billing_cycle: "monthly", vat_mode: "included", vat_rate: "18" };

  it("an agreement: empty agreed price = list price (null), amounts rounded to agorot", () => {
    const a = parseAgreementInput({
      ...base,
      agreed_monthly: "200",
      agreed_yearly: "",
      setup_fee: "1999.999",
    });
    expect(a).toMatchObject({
      plan: "premium",
      billing_cycle: "monthly",
      agreed_monthly: 200,
      agreed_yearly: null,
      setup_fee: 2000,
      vat_mode: "included",
      vat_rate: 18,
      commitment_months: null,
      start_date: null,
    });
    expect(parseAgreementInput({ ...base, setup_fee: "" }).setup_fee).toBe(0);
  });

  it("an agreement: refuses a bad plan code, cycle, VAT, commitment, date or a negative price", () => {
    const bad: Record<string, unknown>[] = [
      { ...base, plan: "Premium!" },
      { ...base, plan: "" },
      { ...base, billing_cycle: "weekly" },
      { ...base, vat_mode: "maybe" },
      { ...base, vat_rate: "120" },
      { ...base, vat_rate: "" },
      { ...base, commitment_months: "0" },
      { ...base, commitment_months: "2.5" },
      { ...base, start_date: "14/11/2026" },
      { ...base, agreed_monthly: "-1" },
      { ...base, agreed_monthly: "abc" },
      { ...base, setup_fee: "2000000" },
    ];
    for (const input of bad)
      expect(() => parseAgreementInput(input), JSON.stringify(input)).toThrow(BillingInputError);
  });

  it("an agreement keeps the text fields short and trimmed", () => {
    const a = parseAgreementInput({
      ...base,
      terms: `  ${"א".repeat(3000)}  `,
      internal_note: "   ",
    });
    expect(a.terms).toHaveLength(2000);
    expect(a.internal_note).toBeNull();
  });

  it("a ledger entry: a payment needs a method; the amount must be positive; a reversal is not entered by hand", () => {
    const ok = parseEntryInput({
      kind: "payment",
      category: "setup",
      amount: "1,000",
      method: "bit",
      occurred_on: "2026-11-14",
    });
    expect(ok).toMatchObject({
      kind: "payment",
      category: "setup",
      amount: 1000,
      method: "bit",
      vat_rate: null,
    });
    expect(
      parseEntryInput({ kind: "charge", amount: "50", method: "bit", occurred_on: "2026-11-14" })
        .method,
    ).toBeNull();
    expect(() =>
      parseEntryInput({ kind: "payment", amount: "10", occurred_on: "2026-11-14" }),
    ).toThrow("אמצעי תשלום");
    expect(() =>
      parseEntryInput({ kind: "charge", amount: "0", occurred_on: "2026-11-14" }),
    ).toThrow("גדול מאפס");
    expect(() =>
      parseEntryInput({ kind: "reversal", amount: "5", occurred_on: "2026-11-14" }),
    ).toThrow("סוג רישום");
    expect(() => parseEntryInput({ kind: "charge", amount: "5", occurred_on: "" })).toThrow(
      "תאריך",
    );
    expect(() =>
      parseEntryInput({
        kind: "payment",
        amount: "5",
        method: "paypal",
        occurred_on: "2026-11-14",
      }),
    ).toThrow("אמצעי תשלום");
  });

  it("amounts and ids", () => {
    expect(parseAmount("₪ 1,234.567", "x")).toBe(1234.57);
    expect(parseAmount("", "x")).toBeNull();
    expect(() => parseAmount("1000001", "x")).toThrow(BillingInputError);
    expect(parseUuid("B1890000-0000-0000-0000-00000000AAA1")).toBe(
      "b1890000-0000-0000-0000-00000000aaa1",
    );
    expect(() => parseUuid("not-a-uuid")).toThrow(BillingInputError);
  });
});
