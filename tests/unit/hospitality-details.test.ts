// Stage 2d — פרטי היחידה והמתחם: קריאת מיקום מקישור למפה, הרשימה המוכנה והאייקונים מול
// המסד, מיטות, מתקנים, חניה, כללי המקום, מידע פרטי להגעה, ושינויים בטפסים.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AMENITY_ICONS,
  amenitiesError,
  arrivalError,
  bedsError,
  cleanPropertyDetail,
  googleMapsLink,
  parseArrivalSave,
  parseMapLocation,
  propertyDetailCrossErrors,
  sleepsIn,
  wazeLink,
} from "@/engines/hospitality/validation/details";
import { parseUpdateProperty, parseUpdateUnit } from "@/engines/hospitality/validation/catalog";
import {
  propertyChanges,
  propertyDetailFields,
  propertyFormErrors,
  propertyFormFrom,
  unitChanges,
  unitFormErrors,
  unitFormFrom,
} from "@/engines/hospitality/management/catalog/model";
import { activityText } from "@/engines/hospitality/management/team/activity";
import { AMENITY_CATEGORIES, BED_TYPES } from "@/engines/hospitality/types/catalog";
import type { CatalogProperty, CatalogUnit } from "@/engines/hospitality/types/catalog";

const MIGRATION = readFileSync(
  join(__dirname, "../../supabase/migrations/20261101190000_hosp_details.sql"),
  "utf8",
);
const ID = "6a1e0000-0000-4000-8000-000000000001";
const A1 = "6a1e0000-0000-4000-8000-0000000000a1";
const A2 = "6a1e0000-0000-4000-8000-0000000000a2";

const unit = (over: Partial<CatalogUnit> = {}): CatalogUnit => ({
  id: ID,
  property_id: ID,
  kind: "unit",
  unit_type: "zimmer",
  name: "צימר",
  description: null,
  capacity: 4,
  base_occupancy: 2,
  child_age_limit: 12,
  bedrooms: 2,
  bathrooms: 1,
  separate_toilets: 0,
  max_adults: null,
  max_children: null,
  beds: [],
  amenities: [],
  is_active: true,
  sort_order: 0,
  revision: 1,
  has_price: false,
  has_photo: false,
  has_history: false,
  member_ids: null,
  ...over,
});
const property = (over: Partial<CatalogProperty> = {}): CatalogProperty => ({
  id: ID,
  name: "חוות הזית",
  property_type: "zimmer_complex",
  description: null,
  address: null,
  status: "active",
  sort_order: 0,
  revision: 1,
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
  units: [],
  ...over,
});

describe("map links → coordinates (in the browser, no network)", () => {
  const cases: [string, number, number][] = [
    ["https://www.google.com/maps/place/Rosh+Pina/@32.9695,35.5428,15z", 32.9695, 35.5428],
    [
      "https://www.google.com/maps/place/X/@32.1,35.1,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d32.7940231!4d35.5312",
      32.794023,
      35.5312,
    ],
    ["https://maps.google.com/?q=32.0853,34.7818", 32.0853, 34.7818],
    ["https://www.google.com/maps/search/?api=1&query=31.7683%2C35.2137", 31.7683, 35.2137],
    ["https://waze.com/ul?ll=32.0853%2C34.7818&navigate=yes", 32.0853, 34.7818],
    ["https://www.waze.com/live-map/directions?to=ll.32.1,35.2&ll=32.1,35.2", 32.1, 35.2],
    ["https://www.openstreetmap.org/?mlat=32.79&mlon=35.53#map=15/32.79/35.53", 32.79, 35.53],
    ["https://www.openstreetmap.org/#map=17/29.5577/34.9519", 29.5577, 34.9519],
    ["geo:32.5,35.1", 32.5, 35.1],
    ["  32.79, 35.53 ", 32.79, 35.53],
    ["32.79 35.53", 32.79, 35.53],
    ["-33.8688, 151.2093", -33.8688, 151.2093],
  ];
  it.each(cases)("%s", (text, lat, lng) => {
    expect(parseMapLocation(text)).toEqual({ ok: true, lat, lng });
  });
  it("short links need opening — ask for the coordinates instead (no request is made)", () => {
    for (const s of [
      "https://maps.app.goo.gl/AbCdEf123",
      "https://goo.gl/maps/xyz",
      "https://waze.com/ul/hsv8tx",
    ])
      expect(parseMapLocation(s)).toEqual({ ok: false, reason: "short_link" });
  });
  it("empty, nonsense and out-of-range input", () => {
    expect(parseMapLocation("   ")).toEqual({ ok: false, reason: "empty" });
    expect(parseMapLocation("רחוב הזית 4, ראש פינה")).toEqual({ ok: false, reason: "invalid" });
    expect(parseMapLocation("95, 35")).toEqual({ ok: false, reason: "invalid" });
    expect(parseMapLocation("javascript:alert(1)")).toEqual({ ok: false, reason: "invalid" });
  });
  it("preview links go to Google Maps / Waze with the coordinates only", () => {
    expect(googleMapsLink(32.79, 35.53)).toBe(
      "https://www.google.com/maps/search/?api=1&query=32.79,35.53",
    );
    expect(wazeLink(32.79, 35.53)).toBe("https://waze.com/ul?ll=32.79,35.53&navigate=yes");
  });
});

describe("amenity presets and icons match the database", () => {
  const presetsJson = MIGRATION.match(/SELECT '(\[[\s\S]*?\])'::jsonb;/)![1]!;
  const presets = JSON.parse(presetsJson) as {
    code: string;
    name: string;
    category: string;
    icon: string;
  }[];
  const dbIcons = [
    ...MIGRATION.match(/_amenity_icons\(\)[\s\S]*?ARRAY\[([\s\S]*?)\]::text\[\]/)![1]!.matchAll(
      /'([a-z0-9-]+)'/g,
    ),
  ].map((m) => m[1]);
  const dbCategories = [
    ...MIGRATION.match(
      /_amenity_categories\(\)[\s\S]*?ARRAY\[([\s\S]*?)\]::text\[\]/,
    )![1]!.matchAll(/'([a-z_]+)'/g),
  ].map((m) => m[1]);

  it("the 15 owner-requested amenities (parking lives in its own fields)", () => {
    expect(presets.map((p) => p.name)).toEqual([
      "Wi-Fi",
      "מיזוג",
      "טלוויזיה",
      "מטבחון",
      "מקרר",
      "מיקרוגל",
      "מכונת קפה",
      "מרפסת",
      "חצר",
      "נוף",
      "פינת מנגל",
      "בריכה",
      "ג׳קוזי",
      "ארוחת בוקר",
      "נגישות",
    ]);
  });
  it("every preset: unique code, a known group and icon, a name the database accepts", () => {
    expect(new Set(presets.map((p) => p.code)).size).toBe(presets.length);
    for (const p of presets) {
      expect(p.code).toMatch(/^[a-z][a-z_]{1,29}$/);
      expect(AMENITY_CATEGORIES).toContain(p.category);
      expect(AMENITY_ICONS).toContain(p.icon);
      expect(p.name.length).toBeLessThanOrEqual(60);
    }
  });
  it("the icon list and the group list are the same in the screen and in the database", () => {
    expect(dbIcons).toEqual([...AMENITY_ICONS]);
    expect(dbCategories).toEqual([...AMENITY_CATEGORIES]);
    for (const icon of AMENITY_ICONS) expect(icon).toMatch(/^[a-z0-9-]{1,40}$/);
  });
  it("bed types are the database's list", () => {
    expect(MIGRATION).toContain(`ARRAY[${BED_TYPES.map((t) => `'${t}'`).join(", ")}]`);
  });
});

describe("beds", () => {
  it("valid rows; sleeps counts adults' places (a crib is for a baby)", () => {
    const rows = [
      { bed_type: "king" as const, quantity: 1, room_label: "חדר הורים" },
      { bed_type: "single" as const, quantity: 2, room_label: null },
      { bed_type: "crib" as const, quantity: 1, room_label: null },
    ];
    expect(bedsError(rows)).toBeNull();
    expect(sleepsIn(rows)).toBe(4);
  });
  it("Hebrew errors like the database", () => {
    expect(bedsError([{ bed_type: "waterbed", quantity: 1 }])).toBe("סוג המיטה — יש לבחור מהרשימה");
    expect(bedsError([{ bed_type: "double", quantity: 0 }])).toMatch(/בין 1 ל-20/);
    expect(bedsError([{ bed_type: "double", quantity: 1, room_label: "א".repeat(61) }])).toMatch(
      /שם החדר ארוך מדי/,
    );
    expect(
      bedsError(Array.from({ length: 31 }, () => ({ bed_type: "single", quantity: 1 }))),
    ).toMatch(/עד 30/);
    expect(bedsError([{ bed_type: "double", quantity: 1, extra: 1 }])).toMatch(/שורה 1 לא תקינה/);
  });
});

describe("amenities, parking, house rules, arrival info", () => {
  it("amenity links: no duplicates, short notes", () => {
    expect(amenitiesError([{ amenity_id: A1, note: "מחומם" }, { amenity_id: A2 }])).toBeNull();
    expect(amenitiesError([{ amenity_id: A1 }, { amenity_id: A1 }])).toBe("אותו מתקן סומן פעמיים");
    expect(amenitiesError([{ amenity_id: A1, note: "א".repeat(121) }])).toMatch(/עד 120/);
    expect(amenitiesError([{ amenity_id: "x" }])).toMatch(/לא תקין/);
  });
  it("parking: free / paid needs private or shared; quiet hours need both ends", () => {
    expect(
      propertyDetailCrossErrors({
        parking: "paid",
        parking_type: null,
        quiet_from: null,
        quiet_to: null,
      }),
    ).toEqual({
      parking_type: "סוג החניה — יש לבחור פרטית או משותפת",
    });
    expect(
      propertyDetailCrossErrors({
        parking: "none",
        parking_type: null,
        quiet_from: "22:00",
        quiet_to: null,
      }),
    ).toEqual({
      quiet_to: "שעות שקט — יש למלא מתי מתחילות ומתי נגמרות",
    });
  });
  it("server cleaning: trims, drops empty rules, refuses bad values", () => {
    expect(cleanPropertyDetail("rules_custom", ["  שקט  ", "", "לא לעשן"])).toEqual([
      "שקט",
      "לא לעשן",
    ]);
    expect(cleanPropertyDetail("guest_info", "   ")).toBeNull();
    expect(() => cleanPropertyDetail("rules_smoking", "sometimes")).toThrow(
      "עישון — יש לבחור מהרשימה",
    );
    expect(() => cleanPropertyDetail("quiet_from", "10pm")).toThrow(/22:00/);
    expect(() => cleanPropertyDetail("location", { lat: 95, lng: 1 })).toThrow(/מחוץ לטווח/);
    expect(() =>
      cleanPropertyDetail(
        "rules_custom",
        Array.from({ length: 21 }, (_, i) => `כלל ${i}`),
      ),
    ).toThrow(/עד 20/);
  });
  it("arrival info: limits, unknown fields, the revision", () => {
    expect(arrivalError("wifi_password", "x".repeat(101))).toMatch(/עד 100/);
    expect(
      parseArrivalSave({
        propertyId: ID,
        unitId: null,
        values: { gate_code: " 4321 ", wifi_name: "" },
        revision: null,
      }),
    ).toEqual({
      propertyId: ID,
      unitId: null,
      values: { gate_code: "4321", wifi_name: null },
      revision: null,
    });
    expect(() =>
      parseArrivalSave({ propertyId: ID, values: { pin: "1" }, revision: null }),
    ).toThrow(/שדה לא מוכר/);
    expect(() => parseArrivalSave({ propertyId: ID, values: {}, revision: 0 })).toThrow(/הגרסה/);
  });
  it("unit and property updates accept the 2d fields (and refuse broken ones)", () => {
    expect(
      parseUpdateUnit({
        id: ID,
        revision: 2,
        changes: {
          max_adults: 2,
          max_children: null,
          separate_toilets: 1,
          beds: [{ bed_type: "double", quantity: 1 }],
        },
      }).changes,
    ).toEqual({
      max_adults: 2,
      max_children: null,
      separate_toilets: 1,
      beds: [{ bed_type: "double", quantity: 1, room_label: null }],
    });
    expect(() =>
      parseUpdateUnit({ id: ID, revision: 2, changes: { capacity: 2, max_adults: 3 } }),
    ).toThrow(/מקסימום המבוגרים/);
    expect(
      parseUpdateProperty({
        id: ID,
        revision: 1,
        changes: { parking: "free", parking_type: "shared", location: { lat: 32.7, lng: 35.5 } },
      }).changes,
    ).toEqual({ parking: "free", parking_type: "shared", location: { lat: 32.7, lng: 35.5 } });
  });
});

describe("forms: what changed", () => {
  it("unit: beds and amenities are sent whole, only when changed", () => {
    const base = unitFormFrom(
      unit({ beds: [{ bed_type: "double", quantity: 1, room_label: null }] }),
    );
    expect(unitChanges(base, base)).toEqual({});
    const form = {
      ...base,
      max_children: "0",
      beds: [...base.beds, { bed_type: "single" as const, quantity: "2", room_label: " ילדים " }],
      amenities: [{ amenity_id: A1, note: "  " }],
    };
    expect(unitChanges(base, form)).toEqual({
      max_children: 0,
      beds: [
        { bed_type: "double", quantity: 1, room_label: null },
        { bed_type: "single", quantity: 2, room_label: "ילדים" },
      ],
      amenities: [{ amenity_id: A1, note: null }],
    });
  });
  it("unit: max adults above the maximum guests is an error next to the field", () => {
    const f = { ...unitFormFrom(unit({ capacity: 2 })), max_adults: "3" };
    expect(unitFormErrors(f).max_adults).toMatch(/מקסימום המבוגרים/);
  });
  it("property: normalised like the database (no parking → no type / spaces / price)", () => {
    const base = propertyFormFrom(
      property({
        parking: "paid",
        parking_type: "shared",
        parking_spaces: 4,
        parking_fee_note: "30 ₪",
      }),
    );
    const none = { ...base, parking: "none" as const };
    expect(propertyDetailFields(none)).toMatchObject({
      parking: "none",
      parking_type: null,
      parking_spaces: null,
      parking_fee_note: null,
    });
    expect(propertyChanges(base, none)).toEqual({
      parking: "none",
      parking_type: null,
      parking_spaces: null,
      parking_fee_note: null,
    });
  });
  it("property: a pasted map link becomes coordinates; the same place is no change", () => {
    const base = propertyFormFrom(property({ latitude: 32.79, longitude: 35.53 }));
    expect(base.location).toBe("32.79, 35.53");
    expect(
      propertyChanges(base, { ...base, location: "https://maps.google.com/?q=32.79,35.53" }),
    ).toEqual({});
    expect(propertyChanges(base, { ...base, location: "geo:31.5,34.9" })).toEqual({
      location: { lat: 31.5, lng: 34.9 },
    });
    expect(propertyChanges(base, { ...base, location: "" })).toEqual({ location: null });
    expect(
      propertyFormErrors({ ...base, location: "https://maps.app.goo.gl/abc" }).location,
    ).toMatch(/קישור מקוצר/);
  });
});

describe("the action log in plain Hebrew — field names, never values", () => {
  const entry = (action: string, changes: Record<string, unknown>) => ({
    at: "2026-11-01T10:00:00Z",
    action,
    actor: "דנה",
    actor_role: "owner" as const,
    target: "צימר הזית",
    changes: changes as never,
  });
  it("unit / property updates list the changed fields", () => {
    expect(
      activityText(
        entry("catalog.unit_updated", {
          beds: { from: 0, to: 4 },
          amenities: { added: ["Wi-Fi"] },
        }),
      ),
    ).toBe("דנה עדכן/ה את היחידה צימר הזית: מיטות, מתקנים");
    expect(
      activityText(
        entry("catalog.property_updated", {
          parking: { from: null, to: "free" },
          guest_info: { changed: true },
        }),
      ),
    ).toBe("דנה עדכן/ה את המתחם צימר הזית: חניה, מידע שימושי לאורחים");
  });
  it("private arrival info: which field changed — no codes", () => {
    expect(
      activityText(
        entry("catalog.arrival_info_updated", { fields: ["gate_code", "wifi_password"] }),
      ),
    ).toBe("דנה עדכן/ה מידע פרטי להגעה (צימר הזית): קוד השער, סיסמת ה-Wi-Fi");
  });
  it("the amenity catalogue", () => {
    expect(activityText(entry("catalog.amenity_added", {}))).toBe(
      "דנה הוסיף/ה את המתקן צימר הזית לרשימה",
    );
    expect(activityText(entry("catalog.amenity_removed", {}))).toBe(
      "דנה הסיר/ה את המתקן צימר הזית מהרשימה",
    );
  });
});
