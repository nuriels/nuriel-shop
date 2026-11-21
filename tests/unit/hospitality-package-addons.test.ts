// מיגרציה 202 — חדרים נוספים לחבילה (חבילת כלה): הקלט של שמירת החבילה בניהול (החדרים הנוספים, המחיר ללילה,
// כמה לכל היותר), החדרים שהאורח בוחר (הצעה ובקשה), הפורמט שהמסד מקבל, ושורת החבילה במייל של חדר נוסף.
// המסד נשאר הסמכות הסופית (scripts/db-tests/hospitality-package-addons.test.sql).
import { describe, expect, it } from "vitest";
import { renderBookingEmail } from "@/engines/hospitality/outbox/templates";
import { InputError } from "@/engines/hospitality/validation/input";
import {
  PACKAGE_ADDON_MAX_UNITS,
  parsePackageAddons,
  parsePackageAddonsQuote,
  parsePackageRooms,
  parsePackageRoomsQuote,
  parsePackageSave,
  parseRequestPackage,
  roomsArg,
} from "@/engines/hospitality/validation/packages";

const UNIT = "0f0e0d0c-0b0a-4908-8706-050403020100";
const PKG = "1f0e0d0c-0b0a-4908-8706-050403020100";
const ADIR = "3f0e0d0c-0b0a-4908-8706-050403020101";
const MORIA = "3f0e0d0c-0b0a-4908-8706-050403020102";
const unitN = (n: number) => `4f0e0d0c-0b0a-4908-8706-0504030201${String(n).padStart(2, "0")}`;

const save = (over: Record<string, unknown> = {}) => ({
  unitId: UNIT,
  kind: "special",
  name: "חבילת כלה – נופי דורית VIP",
  nights: 2,
  price: 4000,
  maxGuests: 2,
  ...over,
});

describe("saving the add-on rooms with the package (management)", () => {
  it("not sent → null (the database keeps what is saved — an app before this release sends nothing)", () => {
    expect(parsePackageSave(save()).addons).toBeNull();
    expect(parsePackageAddons(undefined)).toBeNull();
    expect(parsePackageAddons(null)).toBeNull();
  });
  it("two rooms at 1,200 a night, up to 2", () => {
    expect(
      parsePackageSave(save({ addons: { unitIds: [ADIR, MORIA], nightlyPrice: 1200, max: 2 } }))
        .addons,
    ).toEqual({ unitIds: [ADIR, MORIA], nightlyPrice: 1200, max: 2 });
  });
  it("an empty list clears them (no price, max 0) — whatever price was sent", () => {
    expect(parsePackageAddons({ unitIds: [], nightlyPrice: 999, max: 3 })).toEqual({
      unitIds: [],
      nightlyPrice: null,
      max: 0,
    });
  });
  it("refused: not an object, not a list, a bad id, twice, more than 8, no / 0 / 3-decimal price, max 0 or more than chosen", () => {
    const bad = [
      "x",
      [ADIR],
      { unitIds: "x" },
      { unitIds: ["not-a-uuid"], nightlyPrice: 1200, max: 1 },
      { unitIds: [ADIR, ADIR], nightlyPrice: 1200, max: 1 },
      {
        unitIds: Array.from({ length: PACKAGE_ADDON_MAX_UNITS + 1 }, (_, i) => unitN(i)),
        nightlyPrice: 1200,
        max: 1,
      },
      { unitIds: [ADIR], max: 1 },
      { unitIds: [ADIR], nightlyPrice: 0, max: 1 },
      { unitIds: [ADIR], nightlyPrice: 12.345, max: 1 },
      { unitIds: [ADIR], nightlyPrice: 100_001, max: 1 },
      { unitIds: [ADIR], nightlyPrice: 1200, max: 0 },
      { unitIds: [ADIR], nightlyPrice: 1200, max: 2 },
    ];
    for (const b of bad) expect(() => parsePackageAddons(b), JSON.stringify(b)).toThrow(InputError);
  });
});

describe("the rooms the guest picks (site)", () => {
  it("none → an empty list (the package request as before)", () => {
    expect(parsePackageRooms(undefined)).toEqual([]);
    expect(parsePackageRooms([])).toEqual([]);
  });
  it("a room with its guests; 2 adults by default", () => {
    expect(
      parsePackageRooms([{ unitId: ADIR, adults: 4, children: 1 }, { unitId: MORIA }]),
    ).toEqual([
      { unitId: ADIR, adults: 4, children: 1 },
      { unitId: MORIA, adults: 2, children: 0 },
    ]);
  });
  it("refused: not a list, more than 8, twice, a bad id, 0 adults", () => {
    expect(() => parsePackageRooms({ unitId: ADIR })).toThrow(InputError);
    expect(() =>
      parsePackageRooms(Array.from({ length: 9 }, (_, i) => ({ unitId: unitN(i) }))),
    ).toThrow(InputError);
    expect(() => parsePackageRooms([{ unitId: ADIR }, { unitId: ADIR }])).toThrow(InputError);
    expect(() => parsePackageRooms([{ unitId: "x" }])).toThrow(InputError);
    expect(() => parsePackageRooms([{ unitId: ADIR, adults: 0 }])).toThrow(InputError);
  });
  it("the database format: unit_id / adults / children", () => {
    expect(roomsArg([{ unitId: ADIR, adults: 3, children: 0 }])).toEqual([
      { unit_id: ADIR, adults: 3, children: 0 },
    ]);
  });
  it("the free rooms: the package and the arrival date", () => {
    expect(parsePackageAddonsQuote({ packageId: PKG, checkIn: "2026-12-10" })).toEqual({
      packageId: PKG,
      checkIn: "2026-12-10",
    });
    expect(() => parsePackageAddonsQuote({ packageId: PKG, checkIn: "2026-02-30" })).toThrow(
      InputError,
    );
  });
  it("the joint quote: the package quote's fields + the rooms", () => {
    expect(
      parsePackageRoomsQuote({ packageId: PKG, checkIn: "2026-12-10", rooms: [{ unitId: ADIR }] }),
    ).toEqual({
      packageId: PKG,
      checkIn: "2026-12-10",
      adults: 2,
      children: 0,
      rooms: [{ unitId: ADIR, adults: 2, children: 0 }],
    });
  });
  it("the request carries the rooms (empty when none); still no coupon", () => {
    const base = {
      packageId: PKG,
      checkIn: "2026-12-10",
      checkOut: "2026-12-12",
      fullName: "דנה לוי",
      email: "dana@example.com",
      phone: "054-2630459",
      idempotencyKey: "pkg-request-rooms-1",
      policyHash: "a".repeat(64),
      policyAccepted: true,
      promoCode: "HACK",
    };
    expect(parseRequestPackage(base).rooms).toEqual([]);
    const r = parseRequestPackage({ ...base, rooms: [{ unitId: ADIR, adults: 4 }] });
    expect(r.rooms).toEqual([{ unitId: ADIR, adults: 4, children: 0 }]);
    expect(r).not.toHaveProperty("promoCode");
  });
});

describe("emails of an add-on room", () => {
  const ctx = {
    business: {
      name: "נופי דורית",
      phone: null,
      email: null,
      address: null,
      checkInTime: null,
      checkOutTime: null,
    },
    bookingUrl: null,
    siteOrigin: "https://nofi.example",
    escape: (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;"),
  };
  const payload = {
    booking_number: 1002,
    unit_name: "אדיר",
    package_name: "חבילת כלה – נופי דורית VIP",
    check_in: "2026-12-10",
    check_out: "2026-12-12",
    nights: 2,
    adults: 4,
    total: 2400,
    currency: "ILS",
  };
  it("a room's own email says it is an add-on room of the package", () => {
    const e = renderBookingEmail(
      "booking_confirmed",
      "guest",
      { ...payload, package_role: "addon" },
      ctx,
    )!;
    expect(e.html).toContain("חבילת כלה – נופי דורית VIP · חדר נוסף");
  });
  it("the package's own email (no role) — the package name alone, as before", () => {
    const e = renderBookingEmail("booking_confirmed", "guest", payload, ctx)!;
    expect(e.html).toContain("חבילת כלה – נופי דורית VIP");
    expect(e.html).not.toContain("חדר נוסף");
  });
  it("the joint request email: both bookings in the rooms table and the total of everything", () => {
    const e = renderBookingEmail(
      "group_request_received",
      "guest",
      {
        ...payload,
        unit_name: "גן עדן VIP",
        total: 6400,
        room_count: 2,
        rooms: [
          {
            number: 1001,
            unit_name: "גן עדן VIP",
            adults: 2,
            children: 0,
            total: 4000,
            manage_token: "c".repeat(64),
          },
          {
            number: 1002,
            unit_name: "אדיר",
            adults: 4,
            children: 0,
            total: 2400,
            manage_token: "d".repeat(64),
          },
        ],
      },
      ctx,
    )!;
    expect(e.subject).toContain("2 חדרים");
    expect(e.html).toContain("#1001 · גן עדן VIP");
    expect(e.html).toContain("#1002 · אדיר");
    expect(e.html).toMatch(/6,400/);
    expect(e.html).toContain(`${ctx.siteOrigin}/stay/my-booking#t=${"d".repeat(64)}`);
  });
});
