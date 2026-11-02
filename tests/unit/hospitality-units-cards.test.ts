// מסך היחידות (Morning Sprint): כרטיסי יחידה — מחיר סוף השבוע מכללי המחיר, המיטות, המתקנים,
// ומצב הפרסום באתר. חישובים טהורים, בלי שדות חדשים במסד.
import { describe, expect, it } from "vitest";
import {
  amenityPreview,
  bedsText,
  publishState,
  weekendPrice,
} from "@/engines/hospitality/management/catalog/unit-cards";
import type { CatalogUnit } from "@/engines/hospitality/types/catalog";
import type { RateRule } from "@/engines/hospitality/types/pricing";

const U = { id: "u1", property_id: "p1" };
const rule = (over: Partial<RateRule>): RateRule => ({
  id: "r",
  name: "סוף שבוע",
  kind: "weekend",
  property_id: null,
  unit_id: null,
  date_from: null,
  date_to: null,
  days_mask: 48,
  price_mode: "percent",
  value: 20,
  min_nights: null,
  priority: 0,
  policy_id: null,
  is_active: true,
  ...over,
});

describe("weekend price from the rules", () => {
  it("percent / amount / fixed; no rule → null", () => {
    expect(weekendPrice(U, 500, [])).toBeNull();
    expect(weekendPrice(U, 500, [rule({})])).toBe(600);
    expect(weekendPrice(U, 500, [rule({ price_mode: "amount", value: 150 })])).toBe(650);
    expect(weekendPrice(U, 500, [rule({ price_mode: "fixed", value: 720 })])).toBe(720);
  });
  it("the most specific rule wins (unit → property → business); inactive / seasonal / other kinds ignored", () => {
    const rules = [
      rule({ id: "all", value: 10 }),
      rule({ id: "prop", property_id: "p1", value: 20 }),
      rule({ id: "unit", unit_id: "u1", price_mode: "fixed", value: 900 }),
      rule({ id: "other-unit", unit_id: "u2", price_mode: "fixed", value: 1 }),
    ];
    expect(weekendPrice(U, 500, rules)).toBe(900);
    expect(weekendPrice(U, 500, rules.slice(0, 2))).toBe(600);
    expect(weekendPrice(U, 500, [rule({ is_active: false })])).toBeNull();
    expect(
      weekendPrice(U, 500, [rule({ date_from: "2026-07-01", date_to: "2026-08-31" })]),
    ).toBeNull();
    expect(weekendPrice(U, 500, [rule({ kind: "season" })])).toBeNull();
    expect(weekendPrice(U, 500, [rule({ property_id: "p2" })])).toBeNull();
  });
});

describe("beds, amenities, publish state", () => {
  it("beds summed by type", () => {
    expect(
      bedsText([
        { bed_type: "double", quantity: 1 },
        { bed_type: "single", quantity: 1 },
        { bed_type: "single", quantity: 1 },
        { bed_type: "crib", quantity: 0 },
      ]),
    ).toBe("זוגית · 2 × יחיד");
    expect(bedsText([])).toBe("");
  });

  it("the first amenities and how many more", () => {
    const catalog = ["ג׳קוזי", "מטבחון", "מזגן", "WiFi", "חניה"].map((name, i) => ({
      id: `a${i}`,
      name,
    }));
    const unit = { amenities: catalog.map((a) => ({ amenity_id: a.id, note: null })) };
    expect(amenityPreview(unit, catalog)).toEqual({ shown: ["ג׳קוזי", "מטבחון", "מזגן"], more: 2 });
    expect(amenityPreview({ amenities: [{ amenity_id: "gone", note: null }] }, catalog)).toEqual({
      shown: [],
      more: 0,
    });
  });

  it("shown on the site only when active, the property published, price and photos set, and the site open", () => {
    const base = { is_active: true, has_price: true, has_photo: true } as CatalogUnit;
    expect(publishState(base, { status: "active" }, true)).toEqual({
      state: "live",
      label: "מוצגת באתר",
    });
    expect(publishState(base, { status: "active" }, false).state).toBe("closed");
    expect(publishState({ ...base, is_active: false }, { status: "active" }, true)).toEqual({
      state: "inactive",
      label: "לא פעילה",
    });
    expect(publishState(base, { status: "draft" }, true).state).toBe("draft");
    expect(
      publishState({ ...base, has_price: false, has_photo: false }, { status: "active" }, true),
    ).toEqual({
      state: "missing",
      label: "חסר: מחיר ותמונות",
    });
  });
});
