import { describe, expect, it } from "vitest";
import type { SiteRef } from "@/platform/engines/contract";
import { renderLlms } from "@/platform/seo/llms";
import { hospitalityGate } from "@/engines/hospitality/edge/gate";
import { siteLlmsTxt } from "@/engines/hospitality/website/llms";
import { robotsTxt } from "@/engines/hospitality/website/seo";
import { parseRobots, robotsAllows } from "../../scripts/seo/lib.mjs";
import type { PublicSite, PublicUnit } from "@/engines/hospitality/types/website";
import { defaultDesign } from "@/engines/hospitality/website/design/schema";
import { businessLlmsTxt } from "@/engines/business-profile/data/seo.server";
import { businessProfileGate, hostRedirect } from "@/engines/business-profile/edge/gate";
import { initialDocument } from "@/engines/business-profile/document/defaults";
import { normalizeDocument } from "@/engines/business-profile/document/normalize";
import { renderLlmsTxt } from "@/lib/feeds.server";

// llms.txt בכל המנועים — רק מה שכבר מפורסם באתר לכל גולש: בלי מחירים, בלי זמינות, בלי ניהול, בלי נתוני
// לקוחות. Google Search מתעלם מהקובץ (אין "קובץ ל-AI" בגוגל); הוא תקציר עזר לכלי AI אחרים.

const unit = (id: string, slug: string, extra: Partial<PublicUnit> = {}): PublicUnit =>
  ({
    id,
    slug,
    name: `סוויטת ${slug}`,
    description: "סוויטה עם ג'קוזי",
    base_price: 1450,
    capacity: 2,
    bedrooms: 1,
    size_sqm: 45,
    min_nights: 1,
    media: [],
    seo_title: null,
    seo_description: null,
    ...extra,
  }) as unknown as PublicUnit;

function site(over: Partial<PublicSite> = {}): PublicSite {
  return {
    business: {
      name: "נופי דורית",
      phone: "050-1234567",
      whatsapp: "972501234567",
      email: "hello@zimmer.test",
      address: "מושב דוגמה",
      check_in_time: "15:00:00",
      check_out_time: "11:00:00",
      currency: "ILS",
      timezone: "Asia/Jerusalem",
      booking_mode: "request",
      approval_hours: 24,
      shabbat_observant: true,
    },
    today: "2026-11-27",
    booking_open: true,
    gallery: [],
    policy: null,
    properties: [
      { id: "p1", description: "מתחם צימרים בגליל. נוף פתוח.", address: null, media: [] },
    ],
    units: [unit("u1", "moriah"), unit("u2", "hermon")],
    room_types: [],
    packages: [
      {
        id: "k1",
        slug: "bride",
        kind: "special",
        name: "חבילת כלה",
        description: null,
        terms: null,
        nights: 2,
        price: 3900,
        max_guests: 2,
        stay_from: null,
        stay_to: null,
        unit_id: "u1",
        media_ids: [],
        sort_order: 0,
      },
    ],
    documents: [
      { kind: "cancellation", title: "מדיניות ביטולים", version: 2, published_at: "2026-11-01" },
      { kind: "privacy", title: "מדיניות פרטיות", version: 1, published_at: "2026-11-01" },
    ],
    design: {
      kind: "published",
      version: 3,
      revision: 1,
      theme: "luxury",
      document: JSON.stringify({
        ...defaultDesign(),
        seo: { description: "צימרים יוקרתיים עם ג'קוזי." },
      }),
      updated_at: "2026-11-01T10:00:00Z",
    },
    ...over,
  } as unknown as PublicSite;
}

describe("the shared llms.txt renderer", () => {
  it("one-line texts, no Markdown breakers, only http(s) links, empty facts / sections left out", () => {
    const out = renderLlms({
      name: "עסק [בדיקה]\n#1",
      summary: "  תיאור <b>מודגש</b>  ",
      facts: [
        ["טלפון", "050"],
        ["אימייל", ""],
        ["כתובת", null],
      ],
      sections: [
        {
          title: "עמודים",
          links: [
            { title: "בית", url: "https://x.test/" },
            { title: "רע", url: "javascript:alert(1)" },
          ],
        },
        { title: "ריק", links: [] },
      ],
      sitemap: "https://x.test/sitemap.xml",
    });
    expect(out.split("\n")[0]).toBe("# עסק בדיקה 1");
    expect(out).toContain("> תיאור מודגש");
    expect(out).toContain("- טלפון: 050");
    expect(out).not.toContain("אימייל");
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("## ריק");
    expect(out.trimEnd().endsWith("מפת האתר: https://x.test/sitemap.xml")).toBe(true);
  });
});

describe("zimmer site llms.txt (public site data only)", () => {
  const out = siteLlmsTxt(site(), "https://nofi.example/");

  it("name, the site's own description, the public contact details, check-in / out, how booking works", () => {
    expect(out.startsWith("# נופי דורית\n")).toBe(true);
    expect(out).toContain("> צימרים יוקרתיים עם ג'קוזי.");
    for (const line of [
      "- כתובת: מושב דוגמה",
      "- טלפון: 050-1234567",
      "- אימייל: hello@zimmer.test",
      "- שעת כניסה: 15:00",
      "- שעת יציאה: 11:00",
      "- הזמנה: בקשת הזמנה באתר — בעל המקום מאשר",
      "- שבת: המתחם שומר שבת",
    ])
      expect(out).toContain(line);
  });

  it("units and packages — as real links on the canonical origin; only pages a crawler may read", () => {
    expect(out).toContain(
      '- [סוויטת moriah](https://nofi.example/stay/units/moriah): עד 2 אורחים, 1 חדרי שינה, 45 מ"ר',
    );
    expect(out).toContain("- [חבילת כלה](https://nofi.example/stay/packages/bride): 2 לילות");
    expect(out).toContain("מפת האתר: https://nofi.example/sitemap.xml");
    // the documents are private pages on purpose (noindex + Disallow in robots.txt) — not listed
    expect(out).not.toContain("/stay/docs/");
    expect(out).not.toContain("/stay/privacy");
    expect(out).not.toContain("מדיניות ביטולים");
    // every link in the file is one robots.txt lets a crawler read — and the file itself too
    const robots = parseRobots(robotsTxt(true, "https://nofi.example"));
    expect(robotsAllows(robots, "/llms.txt")).toBe(true);
    for (const [, url] of out.matchAll(/\]\((https:\/\/nofi\.example[^)]*)\)/g)) {
      expect(robotsAllows(robots, new URL(url!).pathname), url).toBe(true);
    }
    // closed site: robots.txt blocks everything (and the gate answers 404 for llms.txt)
    expect(robotsAllows(parseRobots(robotsTxt(false, null)), "/llms.txt")).toBe(false);
  });

  it("never a price, never the package's price, never the management area", () => {
    expect(out).not.toMatch(/1450|3900|₪|מחיר/);
    expect(out).not.toContain("/manage");
  });

  it("a package of a hidden unit is not listed (same rule as the site and the sitemap)", () => {
    const hidden = siteLlmsTxt(site({ units: [unit("u2", "hermon")] }), "https://nofi.example");
    expect(hidden).not.toContain("חבילת כלה");
  });

  it("the gate serves it only when the site is open; closed → 404 noindex", async () => {
    const SITE: SiteRef = {
      id: "11111111-1111-4111-8111-111111111111",
      siteType: "hospitality",
      status: "active",
    };
    const llms = async () => new Response("# x", { status: 200 });
    const open = await hospitalityGate(
      SITE,
      { pathname: "/llms.txt", method: "GET" },
      {
        managementOpen: async () => false,
        siteOpen: async () => true,
        llms,
      },
    );
    expect(open?.status).toBe(200);
    const closed = await hospitalityGate(
      SITE,
      { pathname: "/llms.txt", method: "GET" },
      {
        managementOpen: async () => true,
        siteOpen: async () => false,
        llms,
      },
    );
    expect(closed?.status).toBe(404);
    expect(closed?.headers.get("x-robots-tag")).toBe("noindex");
    const suspended = await hospitalityGate(
      { ...SITE, status: "suspended" },
      { pathname: "/llms.txt", method: "GET" },
      {
        managementOpen: async () => false,
        siteOpen: async () => true,
        llms,
      },
    );
    expect(suspended?.status).toBe(404);
  });
});

describe("business site llms.txt (the published version only)", () => {
  it("the business name, tagline, public contact, its pages and the accessibility statement", () => {
    const base = initialDocument("elegant", "אפרת אדיר");
    const doc = normalizeDocument({
      ...base,
      business: {
        ...base.business,
        tagline: { he: "מאמנת כושר אישית" },
        phone: "050-7654321",
        email: "e@x.test",
      },
      pages: [...base.pages, { id: "about", slug: "about", title: { he: "אודות" }, blocks: [] }],
    });
    const out = businessLlmsTxt("https://efrat.example", doc, "אפרת");
    expect(out.startsWith("# אפרת אדיר\n")).toBe(true);
    expect(out).toContain("> מאמנת כושר אישית");
    expect(out).toContain("- טלפון: 050-7654321");
    expect(out).toContain("- אימייל: e@x.test");
    expect(out).toContain("- [אודות](https://efrat.example/about)");
    expect(out).toContain("- [הצהרת נגישות](https://efrat.example/accessibility)");
    expect(out).not.toContain("/studio");
  });

  it("the gate serves it only for a published, active site (GET); otherwise 404 noindex — like sitemap.xml", async () => {
    const SITE: SiteRef = {
      id: "22222222-2222-4222-8222-222222222222",
      siteType: "business_profile",
      status: "active",
    };
    let calls = 0;
    const opts = (open: boolean) => ({
      studioOpen: async () => true,
      siteOpen: async () => open,
      llms: async () => {
        calls += 1;
        return new Response("# אפרת אדיר\n", { status: 200 });
      },
    });
    const at = (site: SiteRef, open: boolean, method = "GET") =>
      businessProfileGate(site, { pathname: "/llms.txt", method }, opts(open));

    const published = await at(SITE, true);
    expect(published?.status).toBe(200);
    expect(await published?.text()).toBe("# אפרת אדיר\n");
    expect(calls).toBe(1);
    for (const res of [
      await at(SITE, false), // not published yet
      await at({ ...SITE, status: "suspended" }, true), // suspended
      await at(SITE, true, "HEAD"), // the file itself only on GET, as sitemap.xml
    ]) {
      expect(res?.status).toBe(404);
      expect(res?.headers.get("x-robots-tag")).toBe("noindex");
    }
    expect(calls).toBe(1); // never built for a site that is not open
  });

  it("with an active custom domain, the slug host sends llms.txt there (301) — one address per file", () => {
    const hosts = {
      requestHost: "efrat.nuri1.fit",
      slugHost: "efrat.nuri1.fit",
      canonicalOrigin: "https://www.efratadir.com",
      customDomain: "www.efratadir.com",
    };
    expect(hostRedirect("/llms.txt", "", hosts)).toBe("https://www.efratadir.com/llms.txt");
    expect(
      hostRedirect("/llms.txt", "", { ...hosts, requestHost: "www.efratadir.com" }),
    ).toBeNull();
  });
});

describe("store llms.txt: the business details the store already shows", () => {
  it("adds the public contact details; empty ones are left out", () => {
    const out = renderLlmsTxt({
      origin: "https://shop.example",
      name: "נוריאל מחשבים",
      description: "מחשבים ניידים ונייחים",
      keywords: "",
      facts: [
        ["כתובת", "בית שמש"],
        ["טלפון", "050-5492178"],
        ["אימייל", ""],
        ["שעות פעילות", "א-ה 9:00-19:00\nו 9:00-13:00"],
      ],
      pages: [],
      categories: [],
      products: [],
    });
    expect(out).toContain(
      "## פרטי העסק\n- כתובת: בית שמש\n- טלפון: 050-5492178\n- שעות פעילות: א-ה 9:00-19:00 ו 9:00-13:00",
    );
    expect(out).not.toContain("אימייל");
  });
});
