// שלב א' 7 — חבילות: הקלט של פונקציות השרת (שמירה בניהול, הצעת מחיר ובקשה מהאתר), החבילות באתר
// (רק של יחידה שבאתר, תמונות מהגלריות בלי עותקים, תקופה, הגעה ראשונה), מפת האתר, ושורת החבילה במייל.
import { describe, expect, it } from "vitest";
import { renderBookingEmail } from "@/engines/hospitality/outbox/templates";
import type { PublicPackage } from "@/engines/hospitality/types/packages";
import type { PublicMedia, PublicSite, PublicUnit } from "@/engines/hospitality/types/website";
import { InputError } from "@/engines/hospitality/validation/input";
import {
  parsePackageActive,
  parsePackageQuote,
  parsePackageSave,
  parseRequestPackage,
} from "@/engines/hospitality/validation/packages";
import {
  findPackage,
  firstArrival,
  packageImages,
  packagePeriod,
  sitePackages,
} from "@/engines/hospitality/website/lib/packages";
import { sitemapEntries } from "@/engines/hospitality/website/seo";

const UNIT = "0f0e0d0c-0b0a-4908-8706-050403020100";
const PKG = "1f0e0d0c-0b0a-4908-8706-050403020100";
const IMG1 = "2f0e0d0c-0b0a-4908-8706-050403020101";
const IMG2 = "2f0e0d0c-0b0a-4908-8706-050403020102";

const save = (over: Record<string, unknown> = {}) => ({
  unitId: UNIT,
  kind: "special",
  name: "חבילת כלה – שני לילות ב-VIP",
  nights: 2,
  price: 2400,
  maxGuests: 2,
  ...over,
});

describe("saving a package (management)", () => {
  it("a full package: kind, unit, nights, price for the whole package, guests, period, policy, images", () => {
    const p = parsePackageSave(
      save({
        description: "  עיצוב חדר ובקבוק יין ",
        terms: "",
        stayFrom: "2026-12-01",
        stayTo: "2027-01-31",
        mediaIds: [IMG2, IMG1],
        expectedRevision: 3,
      }),
    );
    expect(p).toMatchObject({
      id: null,
      unitId: UNIT,
      kind: "special",
      nights: 2,
      price: 2400,
      maxGuests: 2,
      description: "עיצוב חדר ובקבוק יין",
      terms: null,
      stayFrom: "2026-12-01",
      stayTo: "2027-01-31",
      policyId: null,
      mediaIds: [IMG2, IMG1],
      expectedRevision: 3,
    });
  });
  it("refused: a short name, 0 / 15 nights, no price / 3 decimals, a bad kind, a period shorter than the nights", () => {
    expect(() => parsePackageSave(save({ name: "א" }))).toThrow(InputError);
    expect(() => parsePackageSave(save({ nights: 0 }))).toThrow(InputError);
    expect(() => parsePackageSave(save({ nights: 15 }))).toThrow(InputError);
    expect(() => parsePackageSave(save({ price: 0 }))).toThrow(InputError);
    expect(() => parsePackageSave(save({ price: 10.005 }))).toThrow(InputError);
    expect(() => parsePackageSave(save({ kind: "vip" }))).toThrow(InputError);
    expect(() =>
      parsePackageSave(save({ nights: 3, stayFrom: "2026-12-01", stayTo: "2026-12-03" })),
    ).toThrow("התקופה של החבילה קצרה ממספר הלילות בה");
  });
  it("images: up to 12, each once, ids only", () => {
    expect(() =>
      parsePackageSave(save({ mediaIds: Array.from({ length: 13 }, () => IMG1) })),
    ).toThrow("עד 12 תמונות לחבילה");
    expect(() => parsePackageSave(save({ mediaIds: [IMG1, IMG1] }))).toThrow(
      "כל תמונה — פעם אחת בחבילה",
    );
    expect(() => parsePackageSave(save({ mediaIds: ["../logo.png"] }))).toThrow(InputError);
  });
  it("show / hide needs a real true / false", () => {
    expect(parsePackageActive({ id: PKG, active: true })).toEqual({ id: PKG, active: true });
    expect(() => parsePackageActive({ id: PKG, active: "yes" })).toThrow(InputError);
  });
});

describe("the site: quote and request for a package", () => {
  it("quote: the package, the arrival date, the guests (2 adults by default)", () => {
    expect(parsePackageQuote({ packageId: PKG, checkIn: "2026-12-10" })).toEqual({
      packageId: PKG,
      checkIn: "2026-12-10",
      adults: 2,
      children: 0,
    });
    expect(() => parsePackageQuote({ packageId: PKG, checkIn: "2026-02-30" })).toThrow(InputError);
  });
  it("request: the guest's details as for a unit, with the package instead of the unit — no coupon", () => {
    const r = parseRequestPackage({
      packageId: PKG,
      checkIn: "2026-12-10",
      checkOut: "2026-12-12",
      adults: 2,
      children: 0,
      fullName: "דנה לוי",
      email: "Dana@Example.com",
      phone: "054-2630459",
      idempotencyKey: "pkg-request-1",
      policyHash: "a".repeat(64),
      policyAccepted: true,
      promoCode: "HACK",
    });
    expect(r).toMatchObject({ packageId: PKG, checkIn: "2026-12-10", email: "dana@example.com" });
    expect(r).not.toHaveProperty("unitId");
    expect(r).not.toHaveProperty("promoCode");
    expect(() =>
      parseRequestPackage({
        packageId: PKG,
        checkIn: "2026-12-10",
        checkOut: "2026-12-12",
        fullName: "דנה לוי",
        email: "dana@example.com",
        phone: "054-2630459",
        idempotencyKey: "pkg-request-1",
        policyHash: "a".repeat(64),
        policyAccepted: false,
      }),
    ).toThrow(InputError);
  });
});

const img = (id: string, url: string | null = `https://cdn.test/${id}.webp`): PublicMedia =>
  ({ id, kind: "image", url, alt: "", sort_order: 0 }) as unknown as PublicMedia;
const unit = (id: string, media: PublicMedia[] = []): PublicUnit =>
  ({
    id,
    slug: id,
    name: `יחידה ${id}`,
    property_id: "p1",
    media,
    member_ids: null,
  }) as unknown as PublicUnit;
const pkg = (over: Partial<PublicPackage> = {}): PublicPackage => ({
  id: PKG,
  slug: "חבילת-כלה",
  kind: "special",
  name: "חבילת כלה",
  description: null,
  terms: null,
  nights: 2,
  price: 2400,
  max_guests: 2,
  stay_from: null,
  stay_to: null,
  unit_id: "vip",
  media_ids: [],
  sort_order: 0,
  policy: null,
  ...over,
});
const site = (packages: PublicPackage[], units = [unit("vip", [img(IMG1), img(IMG2)])]) =>
  ({
    business: { name: "נופי דורית", currency: "ILS" },
    today: "2026-11-07",
    booking_open: true,
    gallery: [],
    properties: [{ id: "p1", media: [] }],
    units,
    room_types: [],
    packages,
    design: null,
    policy: null,
  }) as unknown as PublicSite;

describe("packages on the site", () => {
  it("only packages whose unit is on the site; found by the (encoded) slug", () => {
    const s = site([pkg(), pkg({ id: "x", slug: "other", unit_id: "hidden-unit" })]);
    expect(sitePackages(s).map((p) => p.id)).toEqual([PKG]);
    expect(findPackage(s, encodeURIComponent("חבילת-כלה"))?.id).toBe(PKG);
    expect(findPackage(s, "other")).toBeUndefined();
    expect(findPackage(s, undefined)).toBeUndefined();
  });
  it("images: the chosen ones in their order (from the galleries already on the site); none — the unit's photo", () => {
    expect(packageImages(pkg({ media_ids: [IMG2, IMG1] }), site([])).map((m) => m.id)).toEqual([
      IMG2,
      IMG1,
    ]);
    expect(packageImages(pkg({ media_ids: ["gone"] }), site([])).map((m) => m.id)).toEqual([IMG1]);
    expect(packageImages(pkg(), site([])).map((m) => m.id)).toEqual([IMG1]);
  });
  it("the period and the first arrival date", () => {
    expect(packagePeriod(pkg())).toBeNull();
    expect(packagePeriod(pkg({ stay_from: "2026-12-01", stay_to: null }))).toEqual({
      from: "1 בדצמבר 2026",
      to: null,
    });
    expect(firstArrival(pkg({ stay_from: "2026-12-01" }), "2026-11-07")).toBe("2026-12-01");
    expect(firstArrival(pkg({ stay_from: "2026-10-01" }), "2026-11-07")).toBe("2026-11-07");
  });
  it("the sitemap lists the package pages", () => {
    const paths = sitemapEntries(site([pkg()])).map((e) => e.path);
    expect(paths).toContain(`/stay/packages/${encodeURIComponent("חבילת-כלה")}`);
  });
});

describe("emails of a package booking", () => {
  it("a 'package' row with its name", () => {
    const e = renderBookingEmail(
      "request_received",
      "guest",
      {
        booking_number: 7,
        unit_name: "סוויטת VIP",
        package_name: "חבילת כלה – שני לילות ב-VIP",
        check_in: "2026-12-10",
        check_out: "2026-12-12",
        nights: 2,
        adults: 2,
        total: 2400,
        currency: "ILS",
        manage_token: "b".repeat(64),
      },
      {
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
      },
    )!;
    expect(e.html).toContain("חבילה");
    expect(e.html).toContain("חבילת כלה – שני לילות ב-VIP");
    expect(e.html).toContain("סוויטת VIP");
  });
});
