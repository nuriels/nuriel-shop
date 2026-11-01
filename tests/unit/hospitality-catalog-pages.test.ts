// Hospitality Stage 2c.3 — עמודי היחידה והמתחם: בדיקת הקלט של הפעולות, סדר היחידות,
// "השכרת המתחם כולו", מה מונע פעולה, "עודכן בינתיים" בפעולות, וסימון הניווט.
// ההרשאות והכללים במסד — hospitality-catalog.test.sql; המסכים והקריאות הישירות — e2e.
import { describe, expect, it } from "vitest";
import {
  WHOLE_MEMBERS_ERROR,
  parseReorder,
  parseSetActive,
  parseTarget,
  parseWholeProperty,
} from "@/engines/hospitality/validation/catalog";
import {
  DEACTIVATE_IN_WHOLE,
  DELETE_IN_WHOLE,
  DELETE_WITH_HISTORY,
  GONE_PROPERTY,
  GONE_UNIT,
  PROPERTY_DELETE_WITH_HISTORY,
  STALE_ORDER,
  STALE_PROPERTY,
  STALE_UNIT,
  STALE_WHOLE,
  activateBlock,
  activeUnits,
  canRentWhole,
  deactivateBlock,
  inactiveUnits,
  initialMembers,
  memberChoices,
  moveItem,
  newUnitDefaults,
  propertyDeleteBlock,
  sameOrder,
  sameSet,
  staleOrder,
  staleProperty,
  staleUnit,
  staleWhole,
  unitDeleteBlock,
  unitsOverview,
  withUnitOrder,
} from "@/engines/hospitality/management/catalog/model";
import { NAV_ITEMS, isNavActive } from "@/engines/hospitality/management/lib/nav";
import type {
  CatalogProperty,
  CatalogUnit,
  CatalogView,
} from "@/engines/hospitality/types/catalog";

const id = (n: number) => `6a1e0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = id(100);

const unit = (n: number, over: Partial<CatalogUnit> = {}): CatalogUnit => ({
  id: id(n),
  property_id: P,
  kind: "unit",
  unit_type: "zimmer",
  name: `צימר ${n}`,
  description: null,
  capacity: 2,
  base_occupancy: 2,
  child_age_limit: 12,
  bedrooms: 1,
  bathrooms: 1,
  is_active: true,
  sort_order: n,
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
const whole = (members: number[], over: Partial<CatalogUnit> = {}): CatalogUnit =>
  unit(99, {
    kind: "whole_property",
    unit_type: "other",
    name: "כל המתחם — הגליל",
    sort_order: 1000,
    member_ids: members.map(id),
    revision: 3,
    ...over,
  });
const property = (units: CatalogUnit[], over: Partial<CatalogProperty> = {}): CatalogProperty => ({
  id: P,
  name: "צימרי הגליל",
  property_type: "zimmer_complex",
  description: null,
  address: null,
  status: "active",
  sort_order: 0,
  revision: 5,
  units,
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
const view = (
  properties: CatalogProperty[],
  limits: Partial<CatalogView["limits"]> = {},
): CatalogView => ({
  limits: { max_units: 5, units_used: 3, active: true, ...limits },
  can_owner: true,
  check_in_time: "15:00",
  check_out_time: "11:00",
  amenities: [],
  amenity_presets: [],
  properties,
});

describe("action input (checked before the database, same messages)", () => {
  it("activate / deactivate: a real yes / no, a unit id and the loaded revision", () => {
    expect(parseSetActive({ id: id(1), active: false, revision: 2 })).toEqual({
      id: id(1),
      active: false,
      revision: 2,
    });
    expect(() => parseSetActive({ id: id(1), active: "false", revision: 2 })).toThrow(
      "חסר מצב היחידה",
    );
    expect(() => parseSetActive({ id: "x", active: true, revision: 2 })).toThrow("היחידה לא תקין");
    expect(() => parseSetActive({ id: id(1), active: true, revision: 0 })).toThrow(
      "הגרסה לא תקינה",
    );
  });

  it("archive / delete: the id and the loaded revision", () => {
    expect(parseTarget({ id: id(1).toUpperCase(), revision: 4 }, "המתחם")).toEqual({
      id: id(1),
      revision: 4,
    });
    expect(() => parseTarget({ id: id(1) }, "המתחם")).toThrow("הגרסה לא תקינה");
  });

  it("the whole property: on — at least two different units; off — no units", () => {
    expect(
      parseWholeProperty({ propertyId: P, enabled: true, memberIds: [id(1), id(2)], revision: 3 }),
    ).toEqual({ propertyId: P, enabled: true, memberIds: [id(1), id(2)], revision: 3 });
    expect(
      parseWholeProperty({ propertyId: P, enabled: false, memberIds: [id(1)], revision: null }),
    ).toEqual({ propertyId: P, enabled: false, memberIds: [], revision: null });
    expect(() =>
      parseWholeProperty({ propertyId: P, enabled: true, memberIds: [id(1)], revision: null }),
    ).toThrow(WHOLE_MEMBERS_ERROR);
    expect(() =>
      parseWholeProperty({
        propertyId: P,
        enabled: true,
        memberIds: [id(1), id(1)],
        revision: null,
      }),
    ).toThrow("יחידה מופיעה פעמיים");
    expect(() =>
      parseWholeProperty({ propertyId: P, enabled: "yes", memberIds: [], revision: null }),
    ).toThrow('חסר מצב "השכרת המתחם כולו"');
  });

  it("order: exactly the same units (at least two), in a new order", () => {
    expect(parseReorder({ propertyId: P, expected: [id(1), id(2)], ids: [id(2), id(1)] })).toEqual({
      propertyId: P,
      expected: [id(1), id(2)],
      ids: [id(2), id(1)],
    });
    for (const ids of [[id(2)], [id(2), id(3)], [id(1), id(2), id(3)], [id(1), id(1)]])
      expect(() => parseReorder({ propertyId: P, expected: [id(1), id(2)], ids })).toThrow();
    expect(() => parseReorder({ propertyId: P, expected: "x", ids: [] })).toThrow("רשימה לא תקינה");
  });
});

describe("unit order", () => {
  const p = property([unit(1), unit(2, { is_active: false }), unit(3), whole([1, 3])]);

  it("active and inactive units apart; the whole property is neither", () => {
    expect(activeUnits(p).map((u) => u.name)).toEqual(["צימר 1", "צימר 3"]);
    expect(inactiveUnits(p).map((u) => u.name)).toEqual(["צימר 2"]);
  });

  it("move up / down; outside the list nothing changes; the input list is kept", () => {
    const list = ["a", "b", "c"];
    expect(moveItem(list, 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(list, 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(list, 0, 3)).toEqual(list);
    expect(moveItem(list, -1, 0)).toEqual(list);
    expect(list).toEqual(["a", "b", "c"]);
    expect(sameOrder(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameOrder(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("the list right after a move: new order, inactive after it, the whole property last", () => {
    const other = property([unit(7)], { id: id(200), name: "אחר" });
    const next = withUnitOrder(view([p, other]), P, [id(3), id(1)]);
    const units = next.properties[0]!.units;
    expect(units.map((u) => u.name)).toEqual(["צימר 3", "צימר 1", "צימר 2", "כל המתחם — הגליל"]);
    expect(units.slice(0, 3).map((u) => u.sort_order)).toEqual([0, 1, 2]);
    expect(next.properties[1]).toBe(other);
  });
});

describe("what blocks an action (explained before the database refuses)", () => {
  it("deactivate: not while the unit is part of an active whole property", () => {
    const p = property([unit(1), unit(2), whole([1, 2])]);
    expect(deactivateBlock(p, unit(1))).toBe(DEACTIVATE_IN_WHOLE);
    const off = property([unit(1), unit(2), whole([1, 2], { is_active: false })]);
    expect(deactivateBlock(off, unit(1))).toBeNull();
    expect(deactivateBlock(p, whole([1, 2]))).toBeNull();
  });

  it("activate: not in an archived property, not at the plan limit", () => {
    const p = property([unit(1)]);
    expect(activateBlock(view([p]), p)).toBeNull();
    expect(activateBlock(view([p]), property([unit(1)], { status: "archived" }))).toContain(
      "המתחם בארכיון",
    );
    expect(activateBlock(view([p], { units_used: 5 }), p)).toContain("מגבלת היחידות");
    expect(activateBlock(view([p], { active: false }), p)).toContain("המנוי של העסק אינו פעיל");
  });

  it("delete a unit: never after a booking or block, never while in a whole property", () => {
    const p = property([unit(1), unit(2), unit(3), whole([1, 2], { is_active: false })]);
    expect(unitDeleteBlock(p, unit(3))).toBeNull();
    expect(unitDeleteBlock(p, unit(3, { has_history: true }))).toBe(DELETE_WITH_HISTORY);
    expect(unitDeleteBlock(p, unit(1))).toBe(DELETE_IN_WHOLE);
  });

  it("delete a property: only when no unit in it was ever booked or blocked", () => {
    expect(propertyDeleteBlock(property([unit(1), unit(2)]))).toBeNull();
    expect(propertyDeleteBlock(property([unit(1), unit(2, { has_history: true })]))).toBe(
      PROPERTY_DELETE_WITH_HISTORY,
    );
  });
});

describe("the whole property", () => {
  it("offered only with at least two units", () => {
    expect(canRentWhole(property([unit(1)]))).toBe(false);
    expect(canRentWhole(property([unit(1), unit(2, { is_active: false })]))).toBe(true);
  });

  it("choices: every unit, an inactive one shown but not selectable", () => {
    const choices = memberChoices(property([unit(1), unit(2, { is_active: false })]));
    expect(choices.map((c) => [c.unit.name, c.disabledReason])).toEqual([
      ["צימר 1", null],
      ["צימר 2", "לא פעילה — יש להפעיל אותה קודם"],
    ]);
  });

  it("starting selection: the current members, or every active unit when there is none yet", () => {
    expect(initialMembers(property([unit(1), unit(2), unit(3), whole([1, 3])]))).toEqual([
      id(1),
      id(3),
    ]);
    expect(initialMembers(property([unit(1), unit(2), unit(3)]))).toEqual([id(1), id(2), id(3)]);
    // a member deactivated while the whole property was off → start again from the active units
    const p = property([
      unit(1),
      unit(2, { is_active: false }),
      unit(3),
      whole([1, 2], { is_active: false }),
    ]);
    expect(initialMembers(p)).toEqual([id(1), id(3)]);
    expect(sameSet([id(1), id(3)], [id(3), id(1)])).toBe(true);
    expect(sameSet([id(1)], [id(1), id(3)])).toBe(false);
  });

  it("a new unit gets the property's unit type and the next free name", () => {
    const p = property([unit(1), unit(2)]);
    expect(newUnitDefaults(p)).toEqual({ unit_type: "zimmer", name: "צימר 3" });
    expect(newUnitDefaults(undefined)).toEqual({});
  });
});

describe("updated in the meantime — checked on the server before an action", () => {
  const p = property([unit(1, { revision: 4 }), unit(2), whole([1, 2])]);
  const v = view([p]);

  it("unit: same revision → go; changed → stale; deleted → gone", () => {
    expect(staleUnit(v, id(1), 4)).toBeNull();
    expect(staleUnit(v, id(1), 3)).toBe(STALE_UNIT);
    expect(staleUnit(v, id(9), 1)).toBe(GONE_UNIT);
  });

  it("property: same revision → go; changed → stale; deleted → gone", () => {
    expect(staleProperty(v, P, 5)).toBeNull();
    expect(staleProperty(v, P, 4)).toBe(STALE_PROPERTY);
    expect(staleProperty(v, id(300), 1)).toBe(GONE_PROPERTY);
  });

  it("whole property: compared with the revision that was loaded (none yet = null)", () => {
    expect(staleWhole(v, P, 3)).toBeNull();
    expect(staleWhole(v, P, null)).toBe(STALE_WHOLE);
    expect(staleWhole(view([property([unit(1), unit(2)])]), P, null)).toBeNull();
  });

  it("order: the active units must still be in the order that was shown", () => {
    expect(staleOrder(v, P, [id(1), id(2)])).toBeNull();
    expect(staleOrder(v, P, [id(2), id(1)])).toBe(STALE_ORDER);
    // a unit switched on by someone else meanwhile → the list changed
    const more = view([property([unit(1), unit(2), unit(3)])]);
    expect(staleOrder(more, P, [id(1), id(2)])).toBe(STALE_ORDER);
    expect(staleOrder(v, id(300), [id(1), id(2)])).toBe(GONE_PROPERTY);
  });
});

describe("navigation on the unit and property pages", () => {
  const item = (key: string) => NAV_ITEMS.find((i) => i.key === key)!;

  it("'units' stays marked on a unit page and on a property page", () => {
    expect(isNavActive(item("units"), "/manage/units")).toBe(true);
    expect(isNavActive(item("units"), "/manage/units/")).toBe(true);
    expect(isNavActive(item("units"), `/manage/units/${id(1)}`)).toBe(true);
    expect(isNavActive(item("units"), `/manage/properties/${P}`)).toBe(true);
    expect(isNavActive(item("units"), "/manage/settings")).toBe(false);
  });

  it("other items: their own path only (the dashboard is not marked on every page)", () => {
    expect(isNavActive(item("dashboard"), "/manage")).toBe(true);
    expect(isNavActive(item("dashboard"), "/manage/units")).toBe(false);
    expect(isNavActive(item("settings"), "/manage/settings")).toBe(true);
    expect(isNavActive(item("bookings"), "/manage")).toBe(false);
  });
});

describe("dashboard units card (2c.4)", () => {
  it("counts active, inactive and whole properties; archived properties are left out", () => {
    const p = property([
      unit(1),
      unit(2, { is_active: false }),
      unit(3, { has_price: true }),
      whole([1, 3]),
    ]);
    const archived = property([unit(7)], { id: id(201), status: "archived" });
    const o = unitsOverview(view([p, archived]));
    expect(o).toMatchObject({
      properties: 1,
      active: 2,
      inactive: 1,
      wholeActive: 1,
      missingPrice: 1,
    });
    expect(o.single).toBeNull();
    expect(o.limitText).toBe("3 מתוך 5 יחידות פעילות בחבילה");
  });

  it("a single unit is shown itself; no property → nothing to count", () => {
    expect(unitsOverview(view([property([unit(1)])])).single?.name).toBe("צימר 1");
    expect(unitsOverview(view([]))).toMatchObject({ properties: 0, active: 0, single: null });
  });
});
