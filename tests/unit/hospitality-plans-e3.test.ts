// שלב E3: חבילות לצימרים — עריכת חבילה (אותם כללים כמו admin_save_plan) ו"זמין בפרימיום" בממשק
import { describe, expect, it } from "vitest";
import { planFeatureOpen } from "@/engines/hospitality/management/lib/plan-features";
import type { ManagementContext } from "@/engines/hospitality/types/management";
import { parseSavePlan } from "@/engines/hospitality/validation/platform-admin";

const base = {
  code: "basic",
  name: " בסיסית ",
  tagline: "",
  price_monthly: 200,
  setup_fee: 2000,
  max_units: 3,
  max_properties: 1,
  max_media: 20,
  max_managers: 1,
  features: { channels: false, room_types: false, promotions: false },
  highlights: ["עד 3 יחידות", "", "  תמיכה  "],
  is_published: true,
};

describe("parseSavePlan", () => {
  it("cleans the input like the database: trims, drops empty lines, keeps the three features", () => {
    const plan = parseSavePlan({ ...base, features: { channels: true, other: true } });
    expect(plan.name).toBe("בסיסית");
    expect(plan.highlights).toEqual(["עד 3 יחידות", "תמיכה"]);
    expect(plan.features).toEqual({ channels: true, room_types: false, promotions: false });
  });

  it("empty limits and prices mean unlimited / no price", () => {
    const plan = parseSavePlan({
      ...base,
      max_units: null,
      max_properties: "",
      price_monthly: null,
    });
    expect(plan.max_units).toBeNull();
    expect(plan.max_properties).toBeNull();
    expect(plan.price_monthly).toBeNull();
  });

  it("refuses bad values", () => {
    expect(() => parseSavePlan({ ...base, price_monthly: -1 })).toThrow(/מחיר/);
    expect(() => parseSavePlan({ ...base, max_media: 61 })).toThrow(/תמונות/);
    expect(() => parseSavePlan({ ...base, max_units: 1.5 })).toThrow(/יחידות/);
    expect(() => parseSavePlan({ ...base, name: " " })).toThrow(/שם החבילה/);
    expect(() => parseSavePlan({ ...base, code: "Basic!" })).toThrow(/חבילה/);
    expect(() =>
      parseSavePlan({ ...base, highlights: Array.from({ length: 21 }, (_, i) => `x${i}`) }),
    ).toThrow(/20/);
  });
});

const ctx = (features?: ManagementContext["entitlements"]["features"]) =>
  ({ entitlements: { active: true, max_units: 3, units_used: 1, features } }) as ManagementContext;

describe("planFeatureOpen", () => {
  it("closed only when the plan says so", () => {
    expect(planFeatureOpen(ctx({ channels: false }), "channels")).toBe(false);
    expect(planFeatureOpen(ctx({ channels: true }), "channels")).toBe(true);
  });
  it("a sub-manager (no plan details) sees the action — the database decides", () => {
    expect(planFeatureOpen(ctx(undefined), "room_types")).toBe(true);
  });
});
