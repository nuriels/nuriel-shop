// האתר הציבורי (Stage 4a): השער (/stay, "/" → /stay, robots), הניווט בדפדפן, עזרי העיצוב,
// התאריכים, בחירת התמונות, הערכות והקרדיט הקבוע.
import { describe, expect, it, vi } from "vitest";
import type { SiteRef } from "@/platform/engines/contract";
import { hospitalityGate } from "@/engines/hospitality/edge/gate";
import { clientRouteRedirect, isSitePath } from "@/engines/hospitality/edge/paths";
import {
  bedsText,
  findUnit,
  firstSentence,
  googleMapsHref,
  policyLines,
  rulesLines,
  telHref,
  unitPath,
  wazeHref,
  whatsappHref,
} from "@/engines/hospitality/website/lib/format";
import {
  addDays,
  monthGrid,
  nightsBetween,
  rangeHasBusy,
} from "@/engines/hospitality/website/lib/dates";
import {
  heroImage,
  siteGallery,
  unitCover,
  uniqueAmenities,
} from "@/engines/hospitality/website/lib/media";
import { DEFAULT_THEME, THEMES, themeFor } from "@/engines/hospitality/website/theme/themes";
import { siteCopy } from "@/engines/hospitality/website/copy";
import { he } from "@/engines/hospitality/website/copy/he";
import { NURIEL_CREDIT_TEXT, NURIEL_CREDIT_URL } from "@/platform/branding/NurielCredit";
import type {
  PublicMedia,
  PublicProperty,
  PublicSite,
  PublicUnit,
} from "@/engines/hospitality/types/website";

const HOSP: SiteRef = {
  id: "22222222-2222-2222-2222-222222222222",
  siteType: "hospitality",
  status: "active",
};
const SUSPENDED: SiteRef = { ...HOSP, status: "suspended" };
const get = (pathname: string) => ({ pathname, method: "GET" });
const siteOpen = { managementOpen: async () => false, siteOpen: async () => true };
const siteClosed = { managementOpen: async () => true, siteOpen: async () => false };

describe("edge gate: the public website", () => {
  it("serves /stay and its pages only while the site is open", async () => {
    for (const path of ["/stay", "/stay/", "/stay/units/x", "/stay/book", "/stay/my-booking"]) {
      expect(await hospitalityGate(HOSP, get(path), siteOpen), path).toBeNull();
      const shut = await hospitalityGate(HOSP, get(path), siteClosed);
      expect(shut?.status, path).toBe(404);
      expect(shut?.headers.get("x-robots-tag")).toBe("noindex");
    }
  });

  it("sends the site root to /stay when open (404 while closed)", async () => {
    const res = await hospitalityGate(HOSP, get("/"), siteOpen);
    expect(res?.status).toBe(302);
    expect(res?.headers.get("location")).toBe("/stay");
    expect((await hospitalityGate(HOSP, get("/"), siteClosed))?.status).toBe(404);
  });

  it("keeps every store page closed even with the site open", async () => {
    for (const path of [
      "/products/x",
      "/stayx",
      "/stays",
      "/checkout",
      "/admin/orders",
      "/login",
    ]) {
      expect((await hospitalityGate(HOSP, get(path), siteOpen))?.status, path).toBe(404);
    }
  });

  it("a suspended site shows the suspended page instead of the website", async () => {
    const res = await hospitalityGate(SUSPENDED, get("/stay"), siteOpen);
    expect(res?.status).toBe(403);
    expect(await res?.text()).toContain("האתר מושעה");
  });

  it("robots.txt: everything closed until the site opens; then only the home and unit pages", async () => {
    const closedRobots = await (
      await hospitalityGate(HOSP, get("/robots.txt"), siteClosed)
    )?.text();
    expect(closedRobots).toBe("User-agent: *\nDisallow: /\n");
    const openRobots = await (await hospitalityGate(HOSP, get("/robots.txt"), siteOpen))?.text();
    expect(openRobots).toContain("Allow: /stay$");
    expect(openRobots).toContain("Allow: /stay/units/");
    expect(openRobots).toContain("Disallow: /\n");
    expect(openRobots).not.toContain("/manage");
    const suspended = await (
      await hospitalityGate(SUSPENDED, get("/robots.txt"), siteOpen)
    )?.text();
    expect(suspended).toBe("User-agent: *\nDisallow: /\n");
  });

  it("does not check the site flag for the management area or server functions", async () => {
    const check = vi.fn(async () => true);
    await hospitalityGate(HOSP, get("/manage"), {
      managementOpen: async () => true,
      siteOpen: check,
    });
    await hospitalityGate(
      HOSP,
      { pathname: "/_serverFn/x", method: "POST" },
      { managementOpen: async () => true, siteOpen: check },
    );
    expect(check).not.toHaveBeenCalled();
  });

  it("in-app navigation allows the site paths as well as the management area", () => {
    expect(isSitePath("/stay")).toBe(true);
    expect(isSitePath("/stay/units/a")).toBe(true);
    expect(isSitePath("/stayx")).toBe(false);
    expect(clientRouteRedirect("/stay")).toBeNull();
    expect(clientRouteRedirect("/stay/units/a")).toBeNull();
    expect(clientRouteRedirect("/checkout")).toBe("/manage");
  });
});

const media = (id: string, extra: Partial<PublicMedia> = {}): PublicMedia => ({
  id,
  kind: "image",
  alt: null,
  width: 1600,
  height: 1067,
  is_cover: false,
  is_demo: false,
  embed_provider: null,
  embed_id: null,
  url: `https://cdn.test/${id}.webp`,
  srcset: null,
  thumb_url: null,
  ...extra,
});

const unit = (id: string, extra: Partial<PublicUnit> = {}): PublicUnit => ({
  id,
  slug: id,
  name: id,
  property_id: "p1",
  kind: "unit",
  unit_type: "zimmer",
  description: null,
  capacity: 2,
  base_occupancy: 2,
  max_adults: 2,
  max_children: 0,
  child_age_limit: 12,
  bedrooms: 1,
  bathrooms: 1,
  separate_toilets: 0,
  base_price: 750,
  min_nights: 1,
  policy: null,
  member_ids: null,
  seo_title: null,
  seo_description: null,
  beds: [],
  amenities: [],
  media: [],
  ...extra,
});

const property = (extra: Partial<PublicProperty> = {}): PublicProperty => ({
  id: "p1",
  slug: "p1",
  name: "המתחם",
  property_type: "zimmer_complex",
  description: null,
  address: "מושב דלתון",
  location: null,
  parking: null,
  parking_type: null,
  parking_spaces: null,
  parking_fee_note: null,
  parking_instructions: null,
  guest_info: null,
  rules: {
    smoking: null,
    pets: null,
    pets_note: null,
    events: null,
    quiet_from: null,
    quiet_to: null,
    custom: null,
  },
  amenities: [],
  media: [],
  ...extra,
});

const site = (extra: Partial<PublicSite> = {}): PublicSite => ({
  business: {
    name: "צימרי הגליל",
    phone: "050-0000101",
    whatsapp: null,
    email: null,
    address: null,
    check_in_time: "15:00",
    check_out_time: "11:00",
    currency: "ILS",
    timezone: "Asia/Jerusalem",
    booking_mode: "request",
    approval_hours: 12,
  },
  today: "2026-11-01",
  booking_open: true,
  gallery: [],
  policy: null,
  properties: [property()],
  units: [unit("a")],
  ...extra,
});

describe("website helpers", () => {
  const t = siteCopy("he");

  it("policy lines for the guest: free window, tiers and no-show", () => {
    expect(
      policyLines(
        {
          name: "רגילה",
          free_cancel_days: 7,
          fee_tiers: [
            { from_days: 7, fee: "percent_total", value: 50 },
            { from_days: 2, fee: "full" },
          ],
          no_show_fee: "full",
          no_show_value: 0,
          deposit_kind: "none",
          deposit_value: 0,
          guest_text: null,
        },
        t,
      ),
    ).toEqual([
      "ביטול חינם עד 7 ימים לפני ההגעה",
      "אחר כך — 50% מהסכום",
      "מ-2 ימים לפני — הסכום המלא",
      "אי-הגעה — הסכום המלא",
    ]);
    expect(policyLines(null, t)).toEqual([]);
  });

  it("house rules from the property, with the owner's own lines", () => {
    const p = property({
      rules: {
        smoking: "outside",
        pets: "on_request",
        pets_note: "כלבים קטנים",
        events: "no",
        quiet_from: "22:00",
        quiet_to: "08:00",
        custom: ["בלי נעליים על השטיח", " "],
      },
    });
    expect(rulesLines(p, t)).toEqual([
      "עישון בחוץ בלבד",
      "חיות מחמד — בתיאום מראש — כלבים קטנים",
      "בלי אירועים ומסיבות",
      "שעות שקט: 22:00–08:00",
      "בלי נעליים על השטיח",
    ]);
  });

  it("contact and navigation links (no API, no keys)", () => {
    expect(telHref("050-000 0101")).toBe("tel:0500000101");
    expect(whatsappHref("050-0000101")).toBe("https://wa.me/972500000101");
    expect(whatsappHref("+972 50 0000101", "שלום")).toBe(
      "https://wa.me/972500000101?text=%D7%A9%D7%9C%D7%95%D7%9D",
    );
    expect(wazeHref({ lat: 33.01, lng: 35.5 }, "x")).toBe(
      "https://waze.com/ul?ll=33.01,35.5&navigate=yes",
    );
    expect(wazeHref(null, "מושב דלתון")).toContain("q=%D7%9E");
    expect(googleMapsHref(null, null)).toBeNull();
    expect(googleMapsHref({ lat: 1, lng: 2 }, null)).toBe(
      "https://www.google.com/maps/search/?api=1&query=1,2",
    );
  });

  it("finds a unit by its Hebrew slug, encoded or not", () => {
    const units = [unit("a", { slug: "צימר-הגפן" })];
    expect(findUnit(units, "צימר-הגפן")?.id).toBe("a");
    expect(findUnit(units, encodeURIComponent("צימר-הגפן"))?.id).toBe("a");
    expect(findUnit(units, "%E0%A4%A")).toBeUndefined();
    expect(unitPath("צימר-הגפן")).toBe(`/stay/units/${encodeURIComponent("צימר-הגפן")}`);
  });

  it("beds and the hero sentence", () => {
    expect(
      bedsText(
        [
          { bed_type: "queen", quantity: 1, room_label: null },
          { bed_type: "single", quantity: 2, room_label: null },
        ],
        t,
      ),
    ).toBe("קווין · 2 יחיד");
    expect(firstSentence("צימר זוגי עם ג׳קוזי. נוף לגליל.")).toBe("צימר זוגי עם ג׳קוזי.");
    expect(firstSentence("א".repeat(300)).length).toBe(178);
  });

  it("dates: nights, ranges and the month grid (Sunday first)", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(nightsBetween("2026-11-01", "2026-11-04")).toBe(3);
    const busy = new Set(["2026-11-03"]);
    expect(rangeHasBusy("2026-11-01", "2026-11-03", busy)).toBe(false); // יציאה ביום תפוס — מותר
    expect(rangeHasBusy("2026-11-01", "2026-11-04", busy)).toBe(true);
    const grid = monthGrid(2026, 10); // נובמבר 2026 מתחיל ביום ראשון
    expect(grid[0]![0]).toBe("2026-11-01");
    expect(grid.flat().filter(Boolean)).toHaveLength(30);
    expect(grid.every((w) => w.length === 7)).toBe(true);
  });

  it("chooses photos: site gallery first, then property, then units; whole property falls back to its units", () => {
    const s = site({
      properties: [property({ media: [media("prop")] })],
      units: [
        unit("a", { media: [media("unit-a")] }),
        unit("all", { kind: "whole_property", member_ids: ["a"] }),
      ],
    });
    expect(heroImage(s)?.id).toBe("prop");
    expect(heroImage({ ...s, gallery: [media("site")] })?.id).toBe("site");
    expect(unitCover(s.units[1]!, s)?.id).toBe("unit-a");
    expect(siteGallery({ ...s, gallery: [media("prop")] }).map((m) => m.id)).toEqual([
      "prop",
      "unit-a",
    ]);
    expect(heroImage(site())).toBeNull();
    expect(
      uniqueAmenities([
        { name: "Wi-Fi", icon: "wifi", category: "room", note: null },
        { name: "Wi-Fi", icon: "wifi", category: "room", note: "מהיר" },
      ]),
    ).toHaveLength(1);
  });
});

describe("themes and the fixed credit", () => {
  it("Luxury is the default; an unknown theme falls back to it", () => {
    expect(DEFAULT_THEME).toBe("luxury");
    expect(themeFor("nope").id).toBe("luxury");
    expect(themeFor(null).id).toBe("luxury");
    for (const theme of Object.values(THEMES)) {
      for (const key of ["--background", "--foreground", "--primary", "--site-gold", "--site-deep"])
        expect(theme.vars, `${theme.id} ${key}`).toHaveProperty(key);
    }
  });

  it("the Nuriel credit text and link are fixed (D6)", () => {
    expect(NURIEL_CREDIT_TEXT).toBe("כל הזכויות שמורות לנוריאל מחשבים");
    expect(NURIEL_CREDIT_URL).toBe("https://nuriel-app2.nuri1.fit");
  });

  it("the copy catalogue is complete Hebrew, RTL", () => {
    expect(he.dir).toBe("rtl");
    expect(siteCopy("xx")).toBe(he);
  });
});

describe("4b: booking flow helpers", () => {
  it("accepts only valid booking search params", async () => {
    const { validateBookSearch } = await import("@/engines/hospitality/website/lib/booking");
    expect(
      validateBookSearch({
        unit: "צימר-הגפן",
        from: "2026-11-20",
        to: "2026-11-22",
        adults: "2",
        children: 1,
      }),
    ).toEqual({ unit: "צימר-הגפן", from: "2026-11-20", to: "2026-11-22", adults: 2, children: 1 });
    expect(validateBookSearch({ from: "20/11/2026", adults: 0, children: -1, unit: 5 })).toEqual(
      {},
    );
    expect(validateBookSearch({ unit: "x".repeat(300) })).toEqual({});
  });

  it("the cancellation schedule comes from the server snapshot, with exact times", async () => {
    const { scheduleLines } = await import("@/engines/hospitality/website/lib/format");
    const lines = scheduleLines(
      {
        currency: "ILS",
        timezone: "Asia/Jerusalem",
        schedule: {
          periods: [
            { fee: 0, from: null, kind: "free", until: "2026-11-13T13:00:00Z" },
            {
              fee: 825,
              from: "2026-11-13T13:00:00Z",
              kind: "percent_total",
              until: "2026-11-18T13:00:00Z",
            },
            { fee: 1650, from: "2026-11-18T13:00:00Z", kind: "full", until: null },
          ],
          no_show_fee: 1650,
        },
      },
      siteCopy("he"),
    );
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^ביטול ללא עלות עד 13\.11\.2026/);
    expect(lines[0]).toContain("15:00");
    expect(lines[1]).toContain("825");
    expect(lines[3]).toMatch(/^אי-הגעה — /);
  });

  it("the guest email carries the manage link only for the guest, with a well-formed token", async () => {
    const { guestManageUrl, renderBookingEmail } =
      await import("@/engines/hospitality/outbox/templates");
    const token = "a".repeat(64);
    expect(guestManageUrl("guest", { manage_token: token }, "https://z.example")).toBe(
      `https://z.example/stay/my-booking#t=${token}`,
    );
    expect(guestManageUrl("owner", { manage_token: token }, "https://z.example")).toBeNull();
    expect(guestManageUrl("guest", { manage_token: "x" }, "https://z.example")).toBeNull();
    expect(guestManageUrl("guest", {}, "https://z.example")).toBeNull();
    expect(guestManageUrl("guest", { manage_token: token }, null)).toBeNull();
    const email = renderBookingEmail(
      "request_received",
      "guest",
      { booking_number: 1007, manage_token: token },
      {
        business: {
          name: "צימרי הגליל",
          phone: null,
          email: null,
          address: null,
          checkInTime: null,
          checkOutTime: null,
        },
        bookingUrl: null,
        siteOrigin: "https://z.example",
        escape: (s) => s,
      },
    );
    expect(email?.html).toContain(`/stay/my-booking#t=${token}`);
  });

  it("legal drafts are filled with the business details and carry the draft banner", async () => {
    const { LEGAL_DRAFT_BANNER, accessibilitySections, privacySections } =
      await import("@/engines/hospitality/website/lib/legal");
    expect(LEGAL_DRAFT_BANNER).toBe("טיוטה – טרם אושרה לפרסום (ממתינה לבדיקה משפטית)");
    const s = site();
    const privacy = privacySections(s)
      .flatMap((x) => x.body)
      .join(" ");
    expect(privacy).toContain("צימרי הגליל");
    expect(privacy).toContain("050-0000101");
    expect(privacy).toContain("אין באתר עוגיות פרסום או מעקב");
    const access = accessibilitySections(s).map((x) => x.title);
    expect(access).toContain("נגישות המקום");
    expect(access).toContain("פניות בנושא נגישות");
  });
});
