import { describe, expect, it } from "vitest";
import { PLAN_FEATURES, subscriptionStateFrom, TRIAL_DAYS } from "@/lib/subscription";

const NOW = Date.parse("2026-06-01T00:00:00Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("subscription state (Ecommerce plans baseline)", () => {
  it("keeps the current plans, trial length and limits", () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(Object.keys(PLAN_FEATURES).sort()).toEqual(["basic", "premium", "trial"]);
    expect(PLAN_FEATURES.basic.maxProducts).toBe(1000);
    expect(PLAN_FEATURES.premium.maxProducts).toBeNull();
  });

  it("is active during the trial and locked after it", () => {
    const row = (end: number) => ({
      plan_type: "trial",
      status: "trialing",
      trial_ends_at: iso(end),
      current_period_end: null,
    });
    const live = subscriptionStateFrom(row(NOW + 3 * DAY), false, NOW);
    expect(live).toMatchObject({ plan: "trial", active: true, daysLeft: 3 });
    expect(subscriptionStateFrom(row(NOW - DAY), false, NOW).active).toBe(false);
  });

  it("never locks the default store or a store without a subscription row", () => {
    const expired = {
      plan_type: "basic",
      status: "canceled",
      trial_ends_at: null,
      current_period_end: iso(NOW - DAY),
    };
    expect(subscriptionStateFrom(expired, true, NOW).active).toBe(true);
    expect(subscriptionStateFrom(null, false, NOW).active).toBe(true);
  });

  it("locks a canceled subscription", () => {
    const canceled = {
      plan_type: "premium",
      status: "canceled",
      trial_ends_at: null,
      current_period_end: iso(NOW + 30 * DAY),
    };
    expect(subscriptionStateFrom(canceled, false, NOW).active).toBe(false);
  });
});
