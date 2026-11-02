// שלב E5: מפת אתר, robots.txt והגדרות גוגל ושיתוף לאתרי האירוח — רק העמודים הציבוריים, כתובת
// קנונית, XML תקין, בלי הזרקת HTML מהגדרות העסק, וכל אתר רק עם הנתונים שלו.
import { describe, expect, it, vi } from "vitest";
import type { SiteRef } from "@/platform/engines/contract";
import { hospitalityGate } from "@/engines/hospitality/edge/gate";
import type { PublicSite, PublicUnit } from "@/engines/hospitality/types/website";
import { defaultDesign, normalizeDesign } from "@/engines/hospitality/website/design/schema";
import { siteHomeHead, siteUnitHead } from "@/engines/hospitality/website/head";
import {
  buildSitemap,
  canonicalOrigin,
  extractGoogleToken,
  robotsTxt,
  sitemapEntries,
} from "@/engines/hospitality/website/seo";

const HOSP: SiteRef = {
  id: "11111111-1111-4111-8111-111111111111",
  siteType: "hospitality",
  status: "active",
};
const get = (pathname: string, method = "GET") => ({ pathname, method });
const TOKEN = "AbCdEf123_-xyzXYZ0987654321abcdefGHIJKLmnop";
const IMG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HERO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function unit(id: string, slug: string, extra: Partial<PublicUnit> = {}): PublicUnit {
  return {
    id,
    slug,
    name: `יחידה ${slug}`,
    description: "יחידה מקסימה עם נוף.",
    base_price: 500,
    capacity: 4,
    min_nights: 1,
    media: [],
    seo_title: null,
    seo_description: null,
    ...extra,
  } as unknown as PublicUnit;
}

function site(over: Partial<PublicSite> = {}, seo?: Record<string, unknown>): PublicSite {
  return {
    business: { name: "צימרי הגליל", phone: null, email: null, address: null, currency: "ILS" },
    today: "2026-11-02",
    booking_open: true,
    gallery: [
      { id: HERO, kind: "image", url: "https://cdn.test/hero.webp", alt: "", sort_order: 0 },
      { id: IMG, kind: "image", url: "https://cdn.test/share.webp", alt: "", sort_order: 1 },
    ],
    policy: null,
    properties: [
      {
        id: "p1",
        description: "בקתות עץ בגליל העליון. נוף לחרמון.",
        property_type: "zimmer",
        media: [],
      },
    ],
    units: [unit("u1", "oak"), unit("u2", "olive"), unit("r1", "room-101"), unit("r2", "room-102")],
    room_types: [
      {
        id: "t1",
        slug: "deluxe",
        name: "דלוקס",
        description: null,
        property_id: "p1",
        sort_order: 0,
        revision: 1,
        room_ids: ["r1", "r2"],
      },
    ],
    design: {
      kind: "published",
      version: 3,
      revision: 1,
      theme: "luxury",
      document: JSON.stringify({ ...defaultDesign(), ...(seo ? { seo } : {}) }),
      updated_at: "2026-11-01T10:00:00Z",
    },
    origin: "https://galil.example",
    ...over,
  } as unknown as PublicSite;
}

const metaValue = (meta: Record<string, unknown>[], key: string, attr = "name") =>
  meta.filter((m) => m[attr] === key).map((m) => m["content"]);

describe("SEO settings in the site document: only safe values are kept", () => {
  it("title / description: one line, no tag brackets, length limits; image is an id; token validated", () => {
    const d = normalizeDesign({
      ...defaultDesign(),
      seo: {
        title: '  צימר <script>alert("x")</script>\nבגליל  ',
        description: "א".repeat(400),
        image: IMG.toUpperCase(),
        google: '"><script>alert(1)</script>',
        canonical: "evil.example",
        extra: "dropped",
      },
    });
    expect(d.seo?.title).toBe('צימר scriptalert("x")/script בגליל');
    expect(d.seo?.description).toHaveLength(200);
    expect(d.seo?.image).toBe(IMG);
    expect(d.seo?.google).toBeUndefined();
    expect(d.seo?.canonical).toBeUndefined();
    expect(d.seo).not.toHaveProperty("extra");
    expect(
      normalizeDesign({ ...defaultDesign(), seo: { google: TOKEN, canonical: "subdomain" } }).seo,
    ).toEqual({
      google: TOKEN,
      canonical: "subdomain",
    });
    expect(normalizeDesign({ ...defaultDesign(), seo: { title: "  " } }).seo).toBeUndefined();
  });

  it("the Search Console code: from the full tag or the code alone; anything else is refused", () => {
    expect(extractGoogleToken(`<meta name="google-site-verification" content="${TOKEN}" />`)).toBe(
      TOKEN,
    );
    expect(extractGoogleToken(` ${TOKEN} `)).toBe(TOKEN);
    expect(extractGoogleToken(`<meta content='${TOKEN}'>`)).toBe(TOKEN);
    expect(extractGoogleToken('<meta content="x" onload="alert(1)">')).toBeNull();
    expect(extractGoogleToken("javascript:alert(1)")).toBeNull();
    expect(extractGoogleToken("short")).toBeNull();
    expect(extractGoogleToken("")).toBeNull();
  });
});

describe("canonical address", () => {
  const both = { primary: "https://galil.co.il", subdomain: "https://galil.nuri1.fit" };
  it("the business's own domain by default; the platform address on request; a fallback when missing", () => {
    expect(canonicalOrigin(both, undefined)).toBe("https://galil.co.il");
    expect(canonicalOrigin(both, { canonical: "subdomain" })).toBe("https://galil.nuri1.fit");
    expect(
      canonicalOrigin({ primary: null, subdomain: "https://galil.nuri1.fit" }, undefined),
    ).toBe("https://galil.nuri1.fit");
    expect(
      canonicalOrigin(
        { primary: "https://galil.co.il", subdomain: null },
        { canonical: "subdomain" },
      ),
    ).toBe("https://galil.co.il");
    expect(
      canonicalOrigin({ primary: "javascript:alert(1)", subdomain: null }, undefined),
    ).toBeNull();
  });
});

describe("sitemap.xml", () => {
  it("public pages only: home, units and room types; a room of a type is not listed on its own", () => {
    const paths = sitemapEntries(site()).map((e) => e.path);
    expect(paths).toEqual(["/stay", "/stay/units/oak", "/stay/units/olive", "/stay/rooms/deluxe"]);
    for (const p of paths)
      expect(p).not.toMatch(/manage|book|my-booking|privacy|accessibility|room-10/);
    expect(sitemapEntries(site())[0]?.lastmod).toBe("2026-11-01");
  });

  it("each address once; slugs are encoded", () => {
    const s = site({
      units: [unit("u1", "oak"), unit("u1", "oak"), unit("u3", "חדר זוגי")],
      room_types: [],
    });
    expect(sitemapEntries(s).map((e) => e.path)).toEqual([
      "/stay",
      "/stay/units/oak",
      `/stay/units/${encodeURIComponent("חדר זוגי")}`,
    ]);
  });

  it("valid XML with absolute canonical addresses, escaped", () => {
    const xml = buildSitemap("https://galil.example/", [
      { path: "/stay", lastmod: "2026-11-01" },
      { path: "/stay/units/a&b" },
      { path: "/stay/units/x", lastmod: "not-a-date" },
    ]);
    expect(
      xml.startsWith(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ),
    ).toBe(true);
    expect(xml).toContain("<loc>https://galil.example/stay</loc>");
    expect(xml).toContain("<lastmod>2026-11-01</lastmod>");
    expect(xml).toContain("<loc>https://galil.example/stay/units/a&amp;b</loc>");
    expect(xml.match(/<url>/g)).toHaveLength(3);
    expect(xml.match(/<lastmod>/g)).toHaveLength(1);
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
    expect(() => buildSitemap("javascript:alert(1)", [])).toThrow();
  });

  it("each site's map is built only from its own data and its own address", () => {
    const a = buildSitemap(
      "https://a.example",
      sitemapEntries(site({ units: [unit("u1", "a-only")], room_types: [] })),
    );
    const b = buildSitemap(
      "https://b.example",
      sitemapEntries(site({ units: [unit("u9", "b-only")], room_types: [] })),
    );
    expect(a).toContain("a-only");
    expect(a).not.toContain("b-only");
    expect(a).not.toContain("b.example");
    expect(b).not.toContain("a-only");
  });
});

describe("robots.txt and the gate", () => {
  it("closed: everything blocked, no sitemap line; open: site pages, page assets and the sitemap", () => {
    expect(robotsTxt(false, "https://galil.example")).toBe("User-agent: *\nDisallow: /\n");
    const open = robotsTxt(true, "https://galil.example");
    expect(open).toContain(
      "Allow: /stay$\nAllow: /stay/units/\nAllow: /stay/rooms/\nAllow: /assets/\nAllow: /fonts/\nAllow: /sitemap.xml\nDisallow: /\n",
    );
    expect(open).toContain("\nSitemap: https://galil.example/sitemap.xml\n");
    expect(open).not.toContain("/manage");
    expect(robotsTxt(true, null)).not.toContain("Sitemap:");
  });

  it("the gate serves the map only while the site is open (GET); closed → 404 without building it", async () => {
    const sitemap = vi.fn(async () => new Response("<urlset/>", { status: 200 }));
    const siteOrigin = vi.fn(async () => "https://galil.example");
    const open = {
      managementOpen: async () => true,
      siteOpen: async () => true,
      sitemap,
      siteOrigin,
    };
    const closed = { ...open, siteOpen: async () => false };
    expect((await hospitalityGate(HOSP, get("/sitemap.xml"), open))?.status).toBe(200);
    expect(sitemap).toHaveBeenCalledTimes(1);
    expect((await hospitalityGate(HOSP, get("/sitemap.xml"), closed))?.status).toBe(404);
    expect((await hospitalityGate(HOSP, get("/sitemap.xml", "POST"), open))?.status).toBe(404);
    expect(
      (await hospitalityGate({ ...HOSP, status: "suspended" }, get("/sitemap.xml"), open))?.status,
    ).toBe(404);
    expect(sitemap).toHaveBeenCalledTimes(1);
    const robots = await (await hospitalityGate(HOSP, get("/robots.txt"), open))?.text();
    expect(robots).toContain("Sitemap: https://galil.example/sitemap.xml");
    siteOrigin.mockClear();
    expect(await (await hospitalityGate(HOSP, get("/robots.txt"), closed))?.text()).toBe(
      "User-agent: *\nDisallow: /\n",
    );
    expect(siteOrigin).not.toHaveBeenCalled();
    // הכשל בבניית המפה → "העמוד לא נמצא" (לא שגיאת שרת)
    const broken = { ...open, sitemap: async () => null };
    expect((await hospitalityGate(HOSP, get("/sitemap.xml"), broken))?.status).toBe(404);
  });
});

describe("page head: title, description, share image, canonical, Open Graph, Twitter, verification", () => {
  it("defaults when nothing is set: business name + type, the first sentence, the hero image", () => {
    const h = siteHomeHead(site());
    const title = h.meta.find((m) => "title" in m)?.["title"];
    expect(title).toBe("צימרי הגליל | צימר");
    expect(metaValue(h.meta, "description")).toEqual(["בקתות עץ בגליל העליון."]);
    expect(metaValue(h.meta, "og:image", "property")).toEqual(["https://cdn.test/hero.webp"]);
    expect(metaValue(h.meta, "google-site-verification")).toEqual([]);
    expect(h.links).toEqual([{ rel: "canonical", href: "https://galil.example/stay" }]);
    expect(metaValue(h.meta, "og:url", "property")).toEqual(["https://galil.example/stay"]);
    expect(metaValue(h.meta, "og:locale", "property")).toEqual(["he_IL"]);
    expect(metaValue(h.meta, "twitter:card")).toEqual(["summary_large_image"]);
  });

  it("the business's settings (published) win; the verification tag carries only the code", () => {
    const h = siteHomeHead(
      site(
        {},
        {
          title: "צימר יוקרה בגליל — ג׳קוזי ונוף",
          description: "שלוש בקתות עץ פרטיות.",
          image: IMG,
          google: TOKEN,
        },
      ),
    );
    expect(h.meta.find((m) => "title" in m)?.["title"]).toBe("צימר יוקרה בגליל — ג׳קוזי ונוף");
    expect(metaValue(h.meta, "description")).toEqual(["שלוש בקתות עץ פרטיות."]);
    expect(metaValue(h.meta, "twitter:title")).toEqual(["צימר יוקרה בגליל — ג׳קוזי ונוף"]);
    expect(metaValue(h.meta, "og:image", "property")).toEqual(["https://cdn.test/share.webp"]);
    expect(metaValue(h.meta, "google-site-verification")).toEqual([TOKEN]);
  });

  it("a broken document falls back to the defaults (the public data is always the published version)", () => {
    const h = siteHomeHead(
      site({
        design: {
          kind: "published",
          version: 1,
          revision: 1,
          theme: "luxury",
          document: "{oops",
          updated_at: "2026-11-01T00:00:00Z",
        },
      }),
    );
    expect(h.meta.find((m) => "title" in m)?.["title"]).toBe("צימרי הגליל | צימר");
  });

  it("no address known → no canonical link and no og:url (never a wrong host)", () => {
    const h = siteHomeHead(site({ origin: null }));
    expect(h.links).toEqual([]);
    expect(metaValue(h.meta, "og:url", "property")).toEqual([]);
  });

  it("a hotel room's own page points to its room type page (no duplicate content)", () => {
    const s = site();
    const h = siteUnitHead(s, s.units[2]!, "/stay/rooms/deluxe");
    expect(h.links).toEqual([
      { rel: "canonical", href: "https://galil.example/stay/rooms/deluxe" },
    ]);
    expect(h.meta.find((m) => "title" in m)?.["title"]).toBe("יחידה room-101 | צימרי הגליל");
  });
});
