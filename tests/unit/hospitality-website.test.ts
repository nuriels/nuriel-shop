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
  unitFacts,
  unitHighlights,
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
import {
  DEFAULT_THEME,
  THEMES,
  themeFor,
  themeStyle,
} from "@/engines/hospitality/website/theme/themes";
import { contrast, ensureContrast } from "@/engines/hospitality/website/theme/color";
import {
  CORE_SECTIONS,
  defaultDesign,
  newSectionId,
  normalizeDesign,
} from "@/engines/hospitality/website/design/schema";
import { siteCopy } from "@/engines/hospitality/website/copy";
import { he } from "@/engines/hospitality/website/copy/he";
import { NURIEL_CREDIT_LINES, NURIEL_CREDIT_URL } from "@/platform/branding/credit";
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
  design: null,
  room_types: [],
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

describe("migration 41: the unit card — size and what is special", () => {
  const amenity = (name: string, category: string | null, icon: string | null = null) => ({
    name,
    category,
    icon,
    note: null,
  });
  it("the size joins the facts only when it is set", () => {
    expect(unitFacts(unit("u1", { size_sqm: 34 }), he)).toEqual([
      "עד 2 אורחים",
      "חדר שינה",
      "חדר רחצה",
      "34 מ״ר",
    ]);
    expect(unitFacts(unit("u1", { size_sqm: null }), he)).not.toContain("מ״ר");
    expect(unitFacts(unit("u1"), he).join(" ")).not.toContain("מ״ר");
  });
  it("pool / spa amenities: the unit's own first, then the shared ones, no repeats, at most three", () => {
    const u = unit("u1", {
      amenities: [amenity("ג׳קוזי", "pool_spa", "bath"), amenity("מיזוג", "room", "air-vent")],
    });
    const p = property({
      amenities: [
        amenity("בריכה", "pool_spa", "waves"),
        amenity("ג׳קוזי", "pool_spa", "bath"),
        amenity("Wi-Fi", "room", "wifi"),
      ],
    });
    expect(unitHighlights(u, p)).toEqual([
      { name: "ג׳קוזי", icon: "bath", where: "unit" },
      { name: "בריכה", icon: "waves", where: "property" },
    ]);
    expect(he.units.inUnit("ג׳קוזי")).toBe("ג׳קוזי ביחידה");
    expect(he.units.bedsCount(1)).toBe("מיטה אחת");
    expect(he.units.bedsCount(3)).toBe("3 מיטות");
    expect(he.units.inComplex("בריכה")).toBe("בריכה במתחם");
    expect(
      unitHighlights(
        unit("u2", {
          amenities: ["ג׳קוזי", "סאונה", "בריכה מחוממת", "מקלחת אדים"].map((n) =>
            amenity(n, "pool_spa"),
          ),
        }),
        undefined,
      ),
    ).toHaveLength(3);
    expect(unitHighlights(unit("u3"), property())).toEqual([]);
  });
});

describe("themes and the fixed credit", () => {
  it("Luxury is the default; an unknown theme falls back to it; four themes, all complete", () => {
    expect(DEFAULT_THEME).toBe("luxury");
    expect(themeFor("nope").id).toBe("luxury");
    expect(themeFor(null).id).toBe("luxury");
    expect(Object.keys(THEMES).sort()).toEqual(["luxury", "modern", "nature", "romantic"]);
    for (const theme of Object.values(THEMES)) {
      const style = themeStyle(theme) as Record<string, string>;
      for (const key of [
        "--background",
        "--foreground",
        "--primary",
        "--primary-foreground",
        "--site-gold",
        "--site-gold-ink",
        "--site-deep",
        "--radius",
        "--site-display-font",
      ])
        expect(style[key], `${theme.id} ${key}`).toBeTruthy();
      // טקסט קטן בצבע ההדגשה על הרקע, וטקסט על הכפתור — קריאים (4.5:1)
      expect(
        contrast(style["--site-gold-ink"]!, theme.palette.background),
        theme.id,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(style["--primary-foreground"]!, style["--primary"]!),
        theme.id,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(theme.palette.foreground, theme.palette.background),
        theme.id,
      ).toBeGreaterThanOrEqual(7);
    }
  });

  it("owner colours are guarded: unreadable choices are adjusted, invalid values ignored", () => {
    const lux = THEMES.luxury;
    const pale = themeStyle(lux, { primary: "#f5f0e6", accent: "#fff3c4" }) as Record<
      string,
      string
    >;
    expect(contrast(pale["--primary-foreground"]!, pale["--primary"]!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(pale["--site-gold-ink"]!, lux.palette.background)).toBeGreaterThanOrEqual(4.5);
    const bad = themeStyle(lux, { primary: "red;}body{x:y", accent: "url(x)" } as never) as Record<
      string,
      string
    >;
    expect(bad["--primary"]).toBe(lux.palette.primary);
    expect(ensureContrast("#c2a061", "#ffffff", 4.5)).not.toBe("#c2a061");
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });

  it("the Nuriel credit text and link are fixed (D6, wording of stage F1)", () => {
    expect(NURIEL_CREDIT_LINES).toEqual([
      "האתר נבנה באמצעות Nuriel Hospitality מבית נוריאל מחשבים",
      "© כל הזכויות שמורות לנוריאל מחשבים",
    ]);
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
    const { LEGAL_DRAFT_BANNER, accessibilityFallback, privacySections } =
      await import("@/engines/hospitality/website/lib/legal");
    expect(LEGAL_DRAFT_BANNER).toBe("טיוטה – טרם אושרה לפרסום (ממתינה לבדיקה משפטית)");
    const s = site();
    const privacy = privacySections(s)
      .flatMap((x) => x.body)
      .join(" ");
    expect(privacy).toContain("צימרי הגליל");
    expect(privacy).toContain("050-0000101");
    expect(privacy).toContain("אין באתר עוגיות פרסום או מעקב");
    // מיגרציה 60: הצהרה שלא פורסמה — רק הדרך לפנות ותפריט התצוגה; בלי הצהרת עמידה בתקן ובלי "המתחם נגיש"
    const access = accessibilityFallback(s);
    expect(access.map((x) => x.title)).toContain("פניות בנושא נגישות");
    const accessText = access.flatMap((x) => x.body).join(" ");
    expect(accessText).toContain("050-0000101");
    for (const claim of ["WCAG", "5568", "עומד בתקן", "נגיש לחלוטין"])
      expect(accessText).not.toContain(claim);
  });
});

describe("4c: platform switches", () => {
  it("the platform tab may switch the site and booking flags, and nothing else", async () => {
    const { parseSetFlag } = await import("@/engines/hospitality/validation/platform-admin");
    for (const key of ["backend", "management", "frontend", "booking"])
      expect(parseSetFlag({ key, enabled: true, siteId: null }).key).toBe(key);
    expect(() => parseSetFlag({ key: "themes", enabled: true })).toThrow("דגל לא מוכר");
    expect(() => parseSetFlag({ key: "hospitality_frontend_enabled", enabled: true })).toThrow();
    expect(() => parseSetFlag({ key: "frontend", enabled: "yes" })).toThrow();
  });
});

describe("5a: the site design document", () => {
  it("the default design has every core section once, in order, visible", () => {
    const d = defaultDesign();
    expect(d.theme).toBe("luxury");
    expect(d.sections.map((s) => s.type)).toEqual([...CORE_SECTIONS]);
    expect(d.sections.every((s) => !s.hidden)).toBe(true);
    expect(normalizeDesign(null)).toEqual(d);
    expect(normalizeDesign("not json")).toEqual(d);
  });

  it("normalises any input: unknown types and fields dropped, texts trimmed and capped, core sections kept once", () => {
    const d = normalizeDesign(
      JSON.stringify({
        theme: "modern",
        colors: {
          modern: { primary: "#112233", accent: "javascript:x" },
          nope: { primary: "#000000" },
        },
        sections: [
          { id: "units", type: "units", hidden: true, content: { title: "  החדרים  ", junk: 1 } },
          { id: "units", type: "units", content: {} },
          { id: "x", type: "script", content: {} },
          {
            id: "hero",
            type: "hero",
            content: { title: "א".repeat(500), overlay: "dark", image: "not-a-uuid" },
          },
          {
            id: "faq-1",
            type: "faq",
            content: { faq: [{ q: "מתי?", a: "תמיד" }, { q: "", a: "x" }, "bad"] },
          },
          { id: "BAD ID", type: "text", content: { body: "שלום\u0000עולם" } },
        ],
      }),
    );
    expect(d.theme).toBe("modern");
    expect(d.colors).toEqual({ modern: { primary: "#112233" } });
    const types = d.sections.map((s) => s.type);
    expect(types.filter((x) => x === "units")).toHaveLength(1);
    expect(types).not.toContain("script");
    expect(d.sections[0]).toEqual({
      id: "units",
      type: "units",
      hidden: true,
      content: { title: "החדרים" },
    });
    const hero = d.sections.find((s) => s.type === "hero")!;
    expect(hero.content.title).toHaveLength(120);
    expect(hero.content.overlay).toBeUndefined();
    expect(hero.content.image).toBeUndefined();
    expect(d.sections.find((s) => s.type === "faq")!.content.faq).toEqual([
      { q: "מתי?", a: "תמיד" },
    ]);
    const text = d.sections.find((s) => s.type === "text")!;
    expect(text.id).toMatch(/^text-\d+$/);
    expect(text.content.body).toBe("שלוםעולם");
    // מקטעים קבועים שחסרו — נוספו בסוף, מוסתרים
    for (const core of CORE_SECTIONS)
      expect(types.filter((x) => x === core).length).toBeLessThanOrEqual(1);
    expect(d.sections.find((s) => s.type === "about")!.hidden).toBe(true);
  });

  it("new custom sections get a fresh id; the custom section limit holds", () => {
    const d = defaultDesign();
    d.sections.push({ id: "faq-1", type: "faq", hidden: false, content: {} });
    expect(newSectionId(d, "faq")).toBe("faq-2");
    const many = normalizeDesign({
      sections: Array.from({ length: 40 }, (_, i) => ({
        id: `text-${i}`,
        type: "text",
        content: {},
      })),
    });
    expect(many.sections.filter((s) => s.type === "text")).toHaveLength(12);
  });
});

describe("5b: editor operations on the design", () => {
  it("move, hide, edit, add and remove sections — core sections are never removed", async () => {
    const ops = await import("@/engines/hospitality/management/website/labels");
    let d = defaultDesign();
    d = ops.moveSection(d, "units", 0);
    expect(d.sections[0]!.type).toBe("units");
    expect(ops.moveSection(d, "units", -5).sections[0]!.type).toBe("units");
    d = ops.toggleHidden(d, "gallery");
    expect(d.sections.find((s) => s.id === "gallery")!.hidden).toBe(true);
    d = ops.updateContent(d, "hero", { title: "צימרי הגליל", subtitle: "" });
    expect(d.sections.find((s) => s.id === "hero")!.content).toEqual({ title: "צימרי הגליל" });
    d = ops.updateContent(d, "hero", { title: undefined });
    expect(d.sections.find((s) => s.id === "hero")!.content).toEqual({});
    d = ops.addSection(d, "faq", "hero");
    const at = d.sections.findIndex((s) => s.type === "faq");
    expect(d.sections[at - 1]!.id).toBe("hero");
    expect(d.sections[at]!.content.faq).toHaveLength(1);
    expect(ops.removeSection(d, "hero")).toBe(d);
    d = ops.removeSection(d, d.sections[at]!.id);
    expect(d.sections.some((s) => s.type === "faq")).toBe(false);
    // the result always survives normalisation unchanged
    expect(normalizeDesign(JSON.stringify(d))).toEqual(d);
  });
});

describe("RT: room types on the site", () => {
  it("a type replaces its rooms in the listing, at the place of its first room; other units stay", async () => {
    const { siteListing, findType, listingId } =
      await import("@/engines/hospitality/website/lib/listing");
    const s = site({
      units: [
        unit("suite", { base_price: 1200 }),
        unit("r101", { base_price: 600, capacity: 2 }),
        unit("r102", { base_price: 650, capacity: 3, min_nights: 2 }),
        unit("r201", { base_price: 0 }),
      ],
      room_types: [
        {
          id: "t1",
          slug: "זוגי",
          name: "זוגי",
          description: null,
          property_id: "p1",
          sort_order: 0,
          revision: 1,
          room_ids: ["r101", "r102", "gone"],
        },
        {
          id: "t2",
          slug: "ריק",
          name: "ריק",
          description: null,
          property_id: "p1",
          sort_order: 1,
          revision: 1,
          room_ids: [],
        },
      ],
    });
    const items = siteListing(s);
    expect(items.map(listingId)).toEqual(["suite", "t1", "r201"]);
    const t = findType(s, encodeURIComponent("זוגי"))!;
    expect(t.rooms.map((r) => r.id)).toEqual(["r101", "r102"]);
    expect(t.capacity).toBe(3);
    expect(t.fromPrice).toBe(600);
    expect(t.minNights).toBe(1);
    expect(findType(s, "ריק")).toBeUndefined();
  });

  it("the calendar groups rooms of a type under the type header", async () => {
    const { buildRows } = await import("@/engines/hospitality/management/calendar/model");
    const u = (id: string, name: string) => ({
      id,
      name,
      property_id: "p",
      kind: "room",
      unit_type: "room",
      is_active: true,
      member_ids: null,
    });
    const view = {
      from: "2026-11-01",
      to: "2026-11-08",
      today: "2026-11-01",
      timezone: "Asia/Jerusalem",
      stamp: "s",
      properties: [{ id: "p", name: "מלון" }],
      units: [u("a", "101"), u("x", "סוויטה"), u("b", "102")],
      bookings: [],
      blocks: [],
    } as never;
    const rows = buildRows(view, { propertyId: "", unitId: "", unitType: "", tone: "" }, [
      { id: "t", name: "זוגי", room_ids: ["a", "b"] },
    ]);
    expect(rows.map((r) => (r.type === "unit" ? r.unit.name : r.name))).toEqual([
      "מלון",
      "זוגי · 2 חדרים",
      "101",
      "102",
      "סוויטה",
    ]);
  });
});
