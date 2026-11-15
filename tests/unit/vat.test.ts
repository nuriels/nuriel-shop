import { describe, expect, it } from "vitest";
import { calculateVat, orderVatBreakdown, parseVatProfile, vatPriceNotice } from "@/lib/vat";

// the same table as scripts/db-tests/vat-settings.test.sql ("vat rounding") — the app and the database
// (order_gross / order_vat_amount, the amount charged) must give the same numbers
const CASES: [
  total: number,
  included: boolean,
  rate: number,
  net: number,
  vat: number,
  gross: number,
][] = [
  [100, false, 18, 100, 18, 118],
  [99.99, false, 18, 99.99, 18.0, 117.99],
  [0.3, false, 18, 0.3, 0.05, 0.35],
  [1234.56, false, 17, 1234.56, 209.88, 1444.44],
  [118, true, 18, 100.0, 18.0, 118],
  [10, true, 18, 8.47, 1.53, 10],
  [0.3, true, 18, 0.25, 0.05, 0.3],
  [59.9, true, 18, 50.76, 9.14, 59.9],
  [100, false, 0, 100, 0, 100],
  [100, true, 0, 100, 0, 100],
];

describe("VAT — the app matches the database", () => {
  it.each(CASES)(
    "total %s, includes VAT %s, rate %s%%",
    (total, included, rate, net, vat, gross) => {
      const v = calculateVat(total, { pricesIncludeVat: included, vatRate: rate });
      expect(v.net).toBeCloseTo(net, 2);
      expect(v.vat).toBeCloseTo(vat, 2);
      expect(v.gross).toBeCloseTo(gross, 2);
    },
  );

  it("no double VAT: prices that include VAT stay the same total", () => {
    expect(calculateVat(118, { pricesIncludeVat: true, vatRate: 18 }).gross).toBe(118);
    expect(calculateVat(118, { pricesIncludeVat: true, vatRate: 18 }).showBreakdown).toBe(false);
  });

  it("0% (exempt) — no breakdown, no VAT, the total as is", () => {
    const v = calculateVat(100, { pricesIncludeVat: false, vatRate: 0 });
    expect(v).toMatchObject({ net: 100, vat: 0, gross: 100, showBreakdown: false, exempt: true });
  });
});

describe("store VAT profile (store_vat_profile)", () => {
  it("reads the server profile; exempt is always 0% and the price is final", () => {
    expect(
      parseVatProfile({
        business_type: "exempt",
        prices_include_vat: false,
        vat_rate: 18,
        confirmed: true,
      }),
    ).toEqual({
      businessType: "exempt",
      pricesIncludeVat: true,
      vatRate: 0,
      confirmed: true,
    });
    expect(
      parseVatProfile({ business_type: "authorized", prices_include_vat: false, vat_rate: 18 }),
    ).toEqual({
      businessType: "authorized",
      pricesIncludeVat: false,
      vatRate: 18,
      confirmed: false,
    });
  });

  it("an unknown answer is ignored (null), never guessed", () => {
    expect(parseVatProfile(null)).toBeNull();
    expect(parseVatProfile({ business_type: "company", vat_rate: 18 })).toBeNull();
    expect(parseVatProfile({ business_type: "authorized", vat_rate: -1 })).toBeNull();
    expect(parseVatProfile([1, 2])).toBeNull();
  });

  it("the notice to the customer, up front", () => {
    expect(vatPriceNotice({ businessType: "exempt", pricesIncludeVat: true, vatRate: 0 })).toBe(
      "עוסק פטור — לא מתווסף מע״מ למחירים",
    );
    expect(
      vatPriceNotice({ businessType: "authorized", pricesIncludeVat: true, vatRate: 18 }),
    ).toBe("המחירים באתר כוללים מע״מ");
    expect(
      vatPriceNotice({ businessType: "authorized", pricesIncludeVat: false, vatRate: 18 }),
    ).toBe("המחירים באתר אינם כוללים מע״מ — מע״מ 18% יתווסף בסיכום ההזמנה");
  });
});

describe("a stored order — the breakdown the database computed", () => {
  it("uses the stored net / VAT / total (migration 191)", () => {
    expect(
      orderVatBreakdown({
        total: "250",
        vat_rate: "18",
        prices_include_vat: false,
        net_amount: "250",
        vat_amount: "45",
        gross_amount: "295",
      }),
    ).toMatchObject({ net: 250, vat: 45, gross: 295, showBreakdown: true, vatRate: 18 });
  });

  it("an old order keeps its own rate (17%) and falls back to the same calculation", () => {
    expect(
      orderVatBreakdown({ total: 200, vat_rate: 17, prices_include_vat: false }),
    ).toMatchObject({
      net: 200,
      vat: 34,
      gross: 234,
    });
  });

  it("an exempt order: no VAT line", () => {
    expect(
      orderVatBreakdown({
        total: 100,
        vat_rate: 0,
        prices_include_vat: true,
        net_amount: 100,
        vat_amount: 0,
        gross_amount: 100,
      }),
    ).toMatchObject({ vat: 0, gross: 100, showBreakdown: false, exempt: true });
  });
});
