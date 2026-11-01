// Stage 2f — מחירים, כללים ומדיניות: בדיקת הקלט (אותן הודעות כמו המסד), הטקסטים בעברית,
// התבניות, והדוגמה "אם אורח מבטל N ימים לפני" מתוך לוח הזמנים שהשרת מחזיר.
import { describe, expect, it } from "vitest";
import {
  POLICY_TEMPLATES,
  parsePolicySave,
  parseQuoteInput,
  parseRuleSave,
  parseUnitPrices,
  policyError,
  ruleError,
} from "@/engines/hospitality/validation/pricing";
import {
  DEFAULT_POLICY_RULES,
  datesText,
  daysText,
  policySummary,
  priceText,
  refundAt,
} from "@/engines/hospitality/management/pricing/model";
import type { PolicyPreview, PolicyRules } from "@/engines/hospitality/types/pricing";

const ID = "6a1e0000-0000-4000-8000-000000000001";

describe("unit prices", () => {
  it("accepts prices with two decimals, refuses the rest like the database", () => {
    expect(
      parseUnitPrices({ id: ID, revision: 3, changes: { base_price: 650.5, min_nights: 2 } })
        .changes,
    ).toEqual({
      base_price: 650.5,
      min_nights: 2,
    });
    expect(() => parseUnitPrices({ id: ID, revision: 3, changes: { base_price: -1 } })).toThrow(
      /מחיר ללילה/,
    );
    expect(() => parseUnitPrices({ id: ID, revision: 3, changes: { base_price: 10.555 } })).toThrow(
      /שתי ספרות/,
    );
    expect(() => parseUnitPrices({ id: ID, revision: 3, changes: { min_nights: 0 } })).toThrow(
      /בין 1 ל-60/,
    );
    expect(() =>
      parseUnitPrices({ id: ID, revision: 3, changes: { price_floor: 900, price_ceiling: 500 } }),
    ).toThrow(/המינימלי/);
    expect(() => parseUnitPrices({ id: ID, revision: 3, changes: { capacity: 3 } })).toThrow(
      /שדה לא מוכר/,
    );
    expect(() => parseUnitPrices({ id: ID, revision: 0, changes: { base_price: 1 } })).toThrow(
      /הגרסה/,
    );
  });
});

describe("rate rules", () => {
  const base = {
    name: "קיץ",
    kind: "season",
    price_mode: "percent",
    value: 20,
    date_from: "2027-07-01",
    date_to: "2027-09-01",
  };
  it("a valid season", () => expect(ruleError(base)).toBeNull());
  it("Hebrew errors like rate_rule_save", () => {
    expect(ruleError({ ...base, date_from: null, date_to: null })).toBe(
      "לעונה ולחג יש לבחור תאריכים",
    );
    expect(ruleError({ ...base, date_to: "2027-07-01" })).toMatch(/חייב להיות אחרי/);
    expect(ruleError({ ...base, date_to: "2028-09-01" })).toBe("כלל אחד — עד שנה");
    expect(ruleError({ ...base, value: 900 })).toMatch(/באחוזים/);
    expect(ruleError({ ...base, kind: "weekend", policy_id: ID })).toMatch(/רק לעונה או לחג/);
    expect(ruleError({ ...base, days_mask: 0 })).toMatch(/לפחות יום אחד/);
    expect(ruleError({ ...base, min_nights: 61 })).toMatch(/בין 1 ל-60/);
    expect(ruleError({ ...base, name: " " })).toBe("יש למלא את שם הכלל");
  });
  it("a partial update (switch on / off) is passed to the database as is", () => {
    expect(parseRuleSave({ id: ID, data: { is_active: false } })).toEqual({
      id: ID,
      data: { is_active: false },
    });
    expect(() => parseRuleSave({ id: null, data: { is_active: false } })).toThrow(/שם הכלל/);
    expect(() => parseRuleSave({ id: ID, data: { tenant_id: ID } })).toThrow(/שדה לא מוכר/);
  });
  it("texts", () => {
    expect(priceText({ price_mode: "fixed", value: 900 })).toMatch(/900.*ללילה/);
    expect(priceText({ price_mode: "percent", value: 20 })).toBe("+20% ממחיר הבסיס");
    expect(daysText(127)).toBe("כל הימים");
    expect(daysText((1 << 4) | (1 << 5))).toBe("ה׳, ו׳");
    expect(datesText({ date_from: "2027-07-01", date_to: "2027-09-01" })).toBe(
      "1.7.2027 – 31.8.2027 (לילות)",
    );
  });
});

describe("cancellation policies", () => {
  it("templates are valid policies", () => {
    for (const t of Object.values(POLICY_TEMPLATES))
      expect(
        policyError("x", { ...DEFAULT_POLICY_RULES, ...t.rules } as PolicyRules),
        t.label,
      ).toBeNull();
  });
  it("the database rules, checked before saving", () => {
    const r = DEFAULT_POLICY_RULES;
    expect(
      policyError("x", {
        ...r,
        fee_tiers: [
          { from_days: 3, fee: "full" },
          { from_days: 10, fee: "full" },
        ],
      }),
    ).toMatch(/מסודרות/);
    expect(
      policyError("x", { ...r, free_cancel_days: 2, fee_tiers: [{ from_days: 5, fee: "full" }] }),
    ).toMatch(/לפני סוף הביטול החינם/);
    expect(policyError("x", { ...r, fee_tiers: [{ from_days: 3, fee: "deposit" }] })).toMatch(
      /דורשים מקדמה/,
    );
    expect(policyError("x", { ...r, deposit_kind: "percent", deposit_value: 120 })).toMatch(
      /עד 100/,
    );
    expect(
      policyError("x", { ...r, free_cancel_days: null, auto_cancel: "within_free_window" }),
    ).toMatch(/חלון ביטול חינם/);
    expect(policyError(" ", r)).toBe("יש למלא את שם המדיניות");
  });
  it("house rules cannot be saved in a policy (2d)", () => {
    expect(() => parsePolicySave({ id: null, data: { house_rules: "x" } })).toThrow(/שדה לא מוכר/);
    expect(() => parsePolicySave({ id: ID, data: { name: "x" } })).toThrow(/הגרסה/);
  });
  it("a plain-Hebrew summary", () => {
    expect(
      policySummary({ ...DEFAULT_POLICY_RULES, ...POLICY_TEMPLATES.moderate.rules } as PolicyRules),
    ).toBe(
      "ביטול חינם עד 7 ימים לפני ההגעה; אחר כך — 50% מהסכום; מ-2 ימים לפני — הסכום המלא; אי-הגעה — הסכום המלא",
    );
  });
});

describe("the live example reads the server's schedule", () => {
  // as policy_schedule returns it for: free until 7 days before, then 50%, from 2 days — full; total 1000
  const arrival = "2027-08-20T12:00:00Z";
  const at = (days: number) => new Date(Date.parse(arrival) - days * 86400000).toISOString();
  const preview: PolicyPreview = {
    total: 1000,
    deposit_amount: 0,
    currency: "ILS",
    check_in_time: "15:00",
    schedule: {
      arrival,
      free_until: at(7),
      no_show_fee: 1000,
      periods: [
        { from: null, until: at(7), fee: 0, kind: "free" },
        { from: at(7), until: at(2), fee: 500, kind: "percent_total", from_days: 7 },
        { from: at(2), until: null, fee: 1000, kind: "full", from_days: 2 },
      ],
    },
  };
  it.each([
    [30, 0, 1000],
    [8, 0, 1000],
    [7, 500, 500],
    [5, 500, 500],
    [2, 1000, 0],
    [0, 1000, 0],
  ])("%s days before → fee %s, refund %s", (days, fee, refund) => {
    expect(refundAt(preview, days)).toEqual({ fee, refund });
  });
});

describe("price preview input", () => {
  it("dates and guests", () => {
    expect(
      parseQuoteInput({
        unitId: ID,
        checkIn: "2027-07-01",
        checkOut: "2027-07-03",
        adults: 2,
        children: 1,
      }),
    ).toEqual({
      unitId: ID,
      checkIn: "2027-07-01",
      checkOut: "2027-07-03",
      adults: 2,
      children: 1,
    });
    expect(() =>
      parseQuoteInput({
        unitId: ID,
        checkIn: "2027-07-03",
        checkOut: "2027-07-01",
        adults: 2,
        children: 0,
      }),
    ).toThrow(/אחרי הכניסה/);
    expect(() =>
      parseQuoteInput({
        unitId: ID,
        checkIn: "2027-07-01",
        checkOut: "2027-07-03",
        adults: 0,
        children: 0,
      }),
    ).toThrow(/המבוגרים/);
  });
});
