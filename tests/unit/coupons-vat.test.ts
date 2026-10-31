import { describe, expect, it } from "vitest";
import {
  couponCodeProblem,
  couponDiscount,
  couponEligibleSubtotal,
  couponLabel,
  normalizeCouponCode,
} from "@/lib/coupons";
import { calculateVat } from "@/lib/vat";

describe("coupons (mirror of the DB calculation)", () => {
  it("normalizes and validates codes", () => {
    expect(normalizeCouponCode("  summer 10 ")).toBe("SUMMER10");
    expect(couponCodeProblem("SUMMER10")).toBeNull();
    expect(couponCodeProblem("AB")).not.toBeNull();
    expect(couponCodeProblem("A".repeat(33))).not.toBeNull();
    expect(couponCodeProblem("שלום")).not.toBeNull();
  });

  it("computes percent / fixed / free-shipping discounts", () => {
    const percent = { discountType: "percent" as const, discountValue: 10, minOrderTotal: null };
    const fixed = { discountType: "fixed" as const, discountValue: 50, minOrderTotal: null };
    const ship = { discountType: "free_shipping" as const, discountValue: 0, minOrderTotal: null };
    expect(couponDiscount(percent, 199.99)).toBe(20);
    expect(couponDiscount(fixed, 30)).toBe(30); // never more than the products
    expect(couponDiscount(ship, 100, 29.9)).toBe(29.9);
    expect(couponDiscount({ ...fixed, minOrderTotal: 100 }, 99)).toBe(0);
    expect(couponDiscount(percent, 0)).toBe(0);
    expect(couponDiscount(percent, 100, 0, 40)).toBe(4); // only the eligible part
  });

  it("excludes sale items when the coupon does not stack", () => {
    const items = [
      { productId: "a", price: 10, quantity: 2 },
      { productId: "b", price: 5, quantity: 1 },
    ];
    expect(couponEligibleSubtotal({ excludeSaleItems: true, saleProductIds: ["a"] }, items)).toBe(
      5,
    );
    expect(couponEligibleSubtotal({ excludeSaleItems: false, saleProductIds: ["a"] }, items)).toBe(
      25,
    );
  });

  it("labels coupons", () => {
    expect(couponLabel("percent", 10)).toBe("10% הנחה");
    expect(couponLabel("fixed", 12.5)).toBe("₪12.50 הנחה");
    expect(couponLabel("free_shipping", 0)).toBe("משלוח חינם");
  });
});

describe("VAT", () => {
  it("adds VAT on top of net prices", () => {
    expect(calculateVat(100, { vatRate: 18, pricesIncludeVat: false })).toMatchObject({
      net: 100,
      vat: 18,
      gross: 118,
      showBreakdown: true,
    });
  });

  it("extracts VAT from gross prices", () => {
    expect(calculateVat(118, { vatRate: 18, pricesIncludeVat: true })).toMatchObject({
      net: 100,
      vat: 18,
      gross: 118,
      showBreakdown: false,
    });
  });

  it("charges no VAT for an exempt business", () => {
    expect(calculateVat(50, { vatRate: 0, pricesIncludeVat: false })).toMatchObject({
      vat: 0,
      gross: 50,
      exempt: true,
    });
  });
});
