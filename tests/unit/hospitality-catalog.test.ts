// Hospitality Stage 2c.2 — מתחמים ויחידות: בדיקת הקלט (אותם כללים כמו המסד), מודל המסך,
// התוויות וההקמה הראשונה. ההרשאות והכללים במסד — hospitality-catalog.test.sql; המסכים — e2e.
import { describe, expect, it } from "vitest";
import {
  OCCUPANCY_ERROR,
  parseCreateProperty,
  parseCreateUnit,
  parseSetup,
  parseUpdateProperty,
  parseUpdateUnit,
  propertyFieldError,
  unitErrors,
  unitFieldError,
} from "@/engines/hospitality/validation/catalog";
import {
  BUSINESS_TYPES,
  FIRST_RUN_TYPES,
  PROPERTY_TYPE_LABELS,
  UNIT_TYPE_LABELS,
  setupUnitType,
} from "@/engines/hospitality/management/catalog/labels";
import {
  PROPERTY_FORM_KEYS,
  UNIT_FORM_KEYS,
  mergeAfterConflict,
  missingForBooking,
  nextUnitName,
  physicalUnits,
  propertyChanges,
  propertyFormFrom,
  setupRows,
  unitChanges,
  unitFields,
  unitFormErrors,
  unitFormFrom,
  unitSummary,
  unitsLimit,
  visibleProperties,
  wholeUnit,
} from "@/engines/hospitality/management/catalog/model";
import { activityText } from "@/engines/hospitality/management/team/activity";
import {
  PROPERTY_TYPES,
  UNIT_TYPES,
  type CatalogProperty,
  type CatalogUnit,
  type CatalogView,
} from "@/engines/hospitality/types/catalog";

const ID = "6a1e0000-0000-4000-8000-000000000001";

const unit = (over: Partial<CatalogUnit> = {}): CatalogUnit => ({
  id: ID,
  property_id: ID,
  kind: "unit",
  unit_type: "zimmer",
  name: "צימר 1",
  description: null,
  capacity: 4,
  base_occupancy: 2,
  child_age_limit: 12,
  bedrooms: 2,
  bathrooms: 1,
  is_active: true,
  sort_order: 0,
  revision: 1,
  has_price: false,
  has_photo: false,
  has_history: false,
  member_ids: null,
  separate_toilets: 0,
  max_adults: null,
  max_children: null,
  beds: [],
  amenities: [],
  ...over,
});
const property = (over: Partial<CatalogProperty> = {}): CatalogProperty => ({
  id: ID,
  name: "מתחם הגפן",
  property_type: "zimmer_complex",
  description: null,
  address: null,
  status: "active",
  sort_order: 0,
  revision: 1,
  units: [],
  latitude: null,
  longitude: null,
  parking: null,
  parking_type: null,
  parking_spaces: null,
  parking_fee_note: null,
  parking_instructions: null,
  guest_info: null,
  rules_smoking: null,
  rules_pets: null,
  rules_pets_note: null,
  rules_events: null,
  quiet_from: null,
  quiet_to: null,
  rules_custom: [],
  amenities: [],
  ...over,
});

describe("catalog validation (same rules and messages as the database)", () => {
  it("names: required, up to 120 characters", () => {
    expect(propertyFieldError("name", "")).toBe("יש למלא את שם המתחם");
    expect(unitFieldError("name", "  ")).toBe("יש למלא את שם היחידה");
    expect(unitFieldError("name", "א".repeat(121))).toBe("שם היחידה ארוך מדי (עד 120 תווים)");
    expect(unitFieldError("name", "צימר הגפן")).toBeNull();
  });

  it("types come from the lists", () => {
    for (const t of PROPERTY_TYPES) expect(propertyFieldError("property_type", t)).toBeNull();
    for (const t of UNIT_TYPES) expect(unitFieldError("unit_type", t)).toBeNull();
    expect(propertyFieldError("property_type", "castle")).toBe("סוג המקום — יש לבחור מהרשימה");
    expect(unitFieldError("unit_type", "tent")).toBe("סוג היחידה — יש לבחור מהרשימה");
    expect(propertyFieldError("status", "archived")).toBe("מצב המתחם — יש לבחור מהרשימה");
  });

  it("numbers: whole numbers in range, never text or fractions", () => {
    expect(unitFieldError("capacity", 0)).toBe(
      "מספר האורחים המרבי חייב להיות מספר שלם בין 1 ל-100",
    );
    expect(unitFieldError("capacity", 2.5)).not.toBeNull();
    expect(unitFieldError("capacity", "4")).not.toBeNull();
    expect(unitFieldError("bedrooms", 0)).toBeNull();
    expect(unitFieldError("child_age_limit", 18)).toBe("גיל ילד עד חייב להיות מספר שלם בין 0 ל-17");
  });

  it("included guests cannot exceed the maximum", () => {
    const f = unitFields(unitFormFrom(unit({ capacity: 2, base_occupancy: 2 })));
    expect(unitErrors({ ...f, base_occupancy: 3 }).base_occupancy).toBe(OCCUPANCY_ERROR);
    expect(() =>
      parseCreateUnit({
        propertyId: ID,
        data: { name: "x", unit_type: "zimmer", capacity: 2, base_occupancy: 3 },
      }),
    ).toThrow(OCCUPANCY_ERROR);
  });

  it("server input: unknown fields (slug, tenant, price) are refused", () => {
    expect(() =>
      parseCreateProperty({ data: { name: "x", property_type: "villa", slug: "x" } }),
    ).toThrow("שדה לא מוכר: slug");
    expect(() =>
      parseCreateUnit({ propertyId: ID, data: { name: "x", unit_type: "zimmer", base_price: 1 } }),
    ).toThrow("שדה לא מוכר: base_price");
    expect(() =>
      parseCreateUnit({
        propertyId: ID,
        data: { name: "x", unit_type: "zimmer", kind: "whole_property" },
      }),
    ).toThrow("שדה לא מוכר: kind");
  });

  it("server input: required fields, ids and revision", () => {
    expect(() => parseCreateProperty({ data: { name: "x" } })).toThrow(
      "סוג המקום — יש לבחור מהרשימה",
    );
    expect(() =>
      parseCreateUnit({ propertyId: "nope", data: { name: "x", unit_type: "zimmer" } }),
    ).toThrow("המתחם לא תקין");
    expect(() => parseUpdateUnit({ id: ID, changes: {}, revision: 1 })).toThrow(
      "אין שינויים לשמירה",
    );
    expect(() => parseUpdateUnit({ id: ID, changes: { capacity: 3 }, revision: 0 })).toThrow(
      "הגרסה לא תקינה",
    );
    expect(parseUpdateProperty({ id: ID, changes: { description: "  " }, revision: 2 })).toEqual({
      id: ID,
      changes: { description: null },
      revision: 2,
    });
  });

  it("first run: type, name and 1–30 units, each checked (message names the row)", () => {
    expect(
      parseSetup({
        propertyType: "zimmer",
        name: " צימר הגפן ",
        units: [{ name: "צימר הגפן", capacity: 4, bedrooms: 2 }],
      }),
    ).toEqual({
      propertyType: "zimmer",
      name: "צימר הגפן",
      units: [{ name: "צימר הגפן", capacity: 4, bedrooms: 2 }],
    });
    expect(() => parseSetup({ propertyType: "zimmer", name: "x", units: [] })).toThrow(
      "יש להוסיף לפחות יחידה אחת",
    );
    expect(() =>
      parseSetup({
        propertyType: "zimmer_complex",
        name: "x",
        units: [
          { name: "a", capacity: 2, bedrooms: 1 },
          { name: "b", capacity: 0, bedrooms: 1 },
        ],
      }),
    ).toThrow("יחידה 2: מספר האורחים המרבי");
    expect(() =>
      parseSetup({
        propertyType: "zimmer_complex",
        name: "x",
        units: Array.from({ length: 31 }, (_, i) => ({ name: `u${i}`, capacity: 2, bedrooms: 1 })),
      }),
    ).toThrow("עד 30 יחידות");
  });
});

describe("business types and labels", () => {
  it("every property and unit type has a Hebrew label", () => {
    for (const t of PROPERTY_TYPES) {
      expect(PROPERTY_TYPE_LABELS[t]).toMatch(/[א-ת]/);
      expect(BUSINESS_TYPES[t].label).toMatch(/[א-ת]/);
    }
    for (const t of UNIT_TYPES) expect(UNIT_TYPE_LABELS[t]).toMatch(/[א-ת]/);
  });

  it("first run offers five business types and 'something else'", () => {
    expect(FIRST_RUN_TYPES).toEqual([
      "zimmer",
      "zimmer_complex",
      "vacation_apartments",
      "villa",
      "boutique_hotel",
      "other",
    ]);
  });

  it("each business type creates the matching unit type", () => {
    expect(setupUnitType("zimmer")).toBe("zimmer");
    expect(setupUnitType("zimmer_complex")).toBe("zimmer");
    expect(setupUnitType("vacation_apartments")).toBe("apartment");
    expect(setupUnitType("villa")).toBe("villa");
    expect(setupUnitType("boutique_hotel")).toBe("room");
    expect(setupUnitType("other")).toBe("other");
  });

  it("single-unit types start with one unit; multi-unit types with numbered rows", () => {
    expect(BUSINESS_TYPES.zimmer.single).toBe(true);
    expect(BUSINESS_TYPES.villa.single).toBe(true);
    expect(setupRows("zimmer_complex").map((r) => r.name)).toEqual(["צימר 1", "צימר 2"]);
    expect(setupRows("boutique_hotel").map((r) => r.name)).toEqual(["חדר 1", "חדר 2", "חדר 3"]);
  });
});

describe("units screen model", () => {
  it("plan limit: text, room left, refusal at the limit and when the plan is not active", () => {
    expect(unitsLimit({ max_units: 20, units_used: 3, active: true })).toMatchObject({
      text: "3 מתוך 20 יחידות פעילות בחבילה",
      canAdd: true,
      remaining: 17,
    });
    expect(unitsLimit({ max_units: 5, units_used: 5, active: true }).canAdd).toBe(false);
    expect(unitsLimit({ max_units: null, units_used: 40, active: true })).toMatchObject({
      canAdd: true,
      remaining: null,
    });
    expect(unitsLimit({ max_units: 20, units_used: 1, active: false }).reason).toContain(
      "אינו פעיל",
    );
  });

  it("summary in plain Hebrew (singular / plural)", () => {
    expect(unitSummary({ capacity: 4, bedrooms: 2, bathrooms: 1 })).toBe(
      "עד 4 אורחים · 2 חדרי שינה · חדר רחצה אחד",
    );
    expect(unitSummary({ capacity: 1, bedrooms: 0, bathrooms: 0 })).toBe("אורח אחד");
  });

  it("what is still missing to take bookings (active units only)", () => {
    expect(missingForBooking(unit())).toEqual(["מחיר", "תמונות"]);
    expect(missingForBooking(unit({ has_price: true }))).toEqual(["תמונות"]);
    expect(missingForBooking(unit({ is_active: false }))).toEqual([]);
  });

  it("next free unit name", () => {
    expect(nextUnitName("צימר", ["צימר 1", "צימר 2"])).toBe("צימר 3");
    expect(nextUnitName("חדר", ["חדר 2"])).toBe("חדר 3");
    expect(nextUnitName("חדר", ["חדר 1", "חדר 3"])).toBe("חדר 4");
  });

  it("list: archived properties hidden; whole property apart from the physical units", () => {
    const whole = unit({ id: "w", kind: "whole_property", member_ids: [ID] });
    const view: CatalogView = {
      limits: { max_units: 20, units_used: 1, active: true },
      can_owner: true,
      check_in_time: "15:00",
      check_out_time: "11:00",
      amenities: [],
      amenity_presets: [],
      properties: [property({ units: [unit(), whole] }), property({ id: "b", status: "archived" })],
    };
    expect(visibleProperties(view)).toHaveLength(1);
    expect(physicalUnits(view.properties[0]!).map((u) => u.id)).toEqual([ID]);
    expect(wholeUnit(view.properties[0]!)?.id).toBe("w");
  });

  it("forms: only what changed is sent; text → null; numbers parsed", () => {
    const base = unitFormFrom(unit());
    expect(unitChanges(base, { ...base, capacity: "6", description: "  " })).toEqual({
      capacity: 6,
    });
    expect(unitFormErrors({ ...base, capacity: "" }).capacity).toBeDefined();
    const p = propertyFormFrom(property());
    expect(propertyChanges(p, { ...p, address: "רמות 1", status: "draft" })).toEqual({
      address: "רמות 1",
      status: "draft",
    });
  });

  it("updated in the meantime: keeps my changes the other user did not touch, reports the rest", () => {
    const base = unitFormFrom(unit());
    const mine = { ...base, capacity: "6", name: "צימר הגפן" };
    const latest = { ...base, name: "צימר האלון", bedrooms: "3" };
    const merged = mergeAfterConflict(UNIT_FORM_KEYS, base, mine, latest);
    expect(merged.form).toMatchObject({ capacity: "6", name: "צימר האלון", bedrooms: "3" });
    expect(merged.dropped).toEqual(["name"]);
    expect(merged.remoteChanged.sort()).toEqual(["bedrooms", "name"]);
    expect(PROPERTY_FORM_KEYS).toContain("status");
  });
});

describe("recent activity texts for catalog changes", () => {
  it("names who did what in Hebrew", () => {
    const e = (action: string) =>
      activityText({
        at: "",
        actor: "דנה",
        actor_role: "owner",
        action,
        target: "צימר 1",
        changes: {},
      });
    expect(e("catalog.unit_created")).toBe("דנה הוסיף/ה את היחידה צימר 1");
    expect(e("catalog.property_updated")).toBe("דנה עדכן/ה את המתחם צימר 1");
    expect(e("catalog.unit_deactivated")).toBe("דנה השבית/ה את היחידה צימר 1");
  });
});
