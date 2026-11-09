// כלי ה-Snapshot של SEO (scripts/seo/lib.mjs): קריאת robots.txt כמו Google, sitemap, ה-head של דף,
// וההשוואה בין שני צילומים — מה נחשב CRITICAL ומה רק שינוי שגרתי.
import { describe, expect, it } from "vitest";
import {
  compareSnapshots,
  parseHead,
  parseRobots,
  parseSitemap,
  robotsAllows,
} from "../../scripts/seo/lib.mjs";

// robots.txt של אתר Hospitality פתוח, כפי שהוא היום בייצור (נופי דורית, 2026-11-09)
const HOSP_ROBOTS = [
  "User-agent: *",
  "Allow: /stay$",
  "Allow: /stay/units/",
  "Allow: /stay/rooms/",
  "Allow: /assets/",
  "Allow: /fonts/",
  "Allow: /sitemap.xml",
  "Disallow: /",
  "",
  "Sitemap: https://nofi-dorit.nuri1.fit/sitemap.xml",
].join("\n");

describe("robots.txt כמו Google", () => {
  const robots = parseRobots(HOSP_ROBOTS);

  it("דף הבית, היחידות, הנכסים וה-sitemap מותרים", () => {
    expect(robotsAllows(robots, "/stay")).toBe(true);
    expect(robotsAllows(robots, "/stay/units/%D7%90%D7%93%D7%99%D7%A8")).toBe(true);
    expect(robotsAllows(robots, "/stay/rooms/deluxe")).toBe(true);
    expect(robotsAllows(robots, "/assets/app.js")).toBe(true);
    expect(robotsAllows(robots, "/sitemap.xml")).toBe(true);
    expect(robots.sitemaps).toEqual(["https://nofi-dorit.nuri1.fit/sitemap.xml"]);
  });

  it("מה שהבדיקה מצאה חסום: החבילות, ה-favicon ותמונת השיתוף; וגם /stay/ עם לוכסן", () => {
    expect(robotsAllows(robots, "/stay/packages/bride")).toBe(false);
    expect(robotsAllows(robots, "/stay/brand/icon-192")).toBe(false);
    expect(robotsAllows(robots, "/stay/brand/og-image")).toBe(false);
    expect(robotsAllows(robots, "/stay/")).toBe(false);
    expect(robotsAllows(robots, "/manage")).toBe(false);
  });

  it("הכלל הארוך קובע, ובשוויון Allow; קבוצה של הסורק עצמו גוברת על *", () => {
    const r = parseRobots(
      "User-agent: *\nDisallow: /a\nAllow: /a/b\n\nUser-agent: Googlebot-Image\nDisallow: /",
    );
    expect(robotsAllows(r, "/a/b/c")).toBe(true);
    expect(robotsAllows(r, "/a/c")).toBe(false);
    expect(robotsAllows(r, "/a/b/c", "googlebot-image")).toBe(false);
    expect(robotsAllows(parseRobots("User-agent: *\nAllow: /p\nDisallow: /p"), "/p")).toBe(true);
    expect(robotsAllows(parseRobots("User-agent: *\nDisallow: /*?q="), "/shop?q=1")).toBe(false);
    expect(robotsAllows(parseRobots(""), "/anything")).toBe(true);
  });
});

describe("sitemap ו-head", () => {
  it("כתובות ו-lastmod לפי הסדר", () => {
    const xml =
      '<?xml version="1.0"?><urlset><url><loc>https://x.test/stay</loc><lastmod>2026-11-08</lastmod></url>' +
      "<url><loc>https://x.test/stay/units/a&amp;b</loc></url></urlset>";
    expect(parseSitemap(xml)).toEqual([
      { loc: "https://x.test/stay", lastmod: "2026-11-08" },
      { loc: "https://x.test/stay/units/a&b", lastmod: null },
    ]);
  });

  it("כותרת, תיאור, robots, canonical, אימות Google, JSON-LD ו-H1", () => {
    const html =
      '<html lang="he"><head><title>נופי | צימרים</title><meta name="description" content="תיאור &amp; עוד"/>' +
      '<meta name="robots" content="index, follow"/><meta name="google-site-verification" content="abc123"/>' +
      '<link rel="canonical" href="https://x.test/stay"/><link rel="icon" href="/stay/brand/icon-192"/>' +
      '<script type="application/ld+json">{"@context":"https://schema.org","@type":"LodgingBusiness","name":"נופי"}</script>' +
      '</head><body><h1>נופי <b>דורית</b></h1><a href="/stay/book">הזמנה</a></body></html>';
    const head = parseHead(html);
    expect(head.title).toBe("נופי | צימרים");
    expect(head.lang).toBe("he");
    expect(head.description).toBe("תיאור & עוד");
    expect(head.robots).toBe("index, follow");
    expect(head.googleVerification).toBe("abc123");
    expect(head.canonical).toBe("https://x.test/stay");
    expect(head.icons).toEqual(["/stay/brand/icon-192"]);
    expect(head.jsonld.map((j: { types: string[] }) => j.types)).toEqual([["LodgingBusiness"]]);
    expect(head.h1).toEqual(["נופי דורית"]);
    expect(head.internalLinks).toEqual(["/stay/book"]);
  });

  it("אותו JSON-LD בסדר מפתחות אחר — אותו hash", () => {
    const a = parseHead(
      '<script type="application/ld+json">{"@type":"X","name":"a","url":"u"}</script>',
    );
    const b = parseHead(
      '<script type="application/ld+json">{"url":"u","name":"a","@type":"X"}</script>',
    );
    expect(a.jsonld).toEqual(b.jsonld);
  });
});

describe("השוואה בין שני צילומים", () => {
  const page = (over: Record<string, unknown> = {}) => ({
    url: "https://x.test/stay",
    status: 200,
    location: null,
    xRobotsTag: null,
    robotsAllowed: true,
    head: parseHead(
      '<title>T</title><meta name="robots" content="index, follow"/><link rel="canonical" href="https://x.test/stay"/>',
    ),
    ...over,
  });
  const snap = (over: Record<string, unknown> = {}) => ({
    origin: "https://x.test",
    robots: { status: 200, body: HOSP_ROBOTS },
    sitemap: { status: 200, urls: [{ loc: "https://x.test/stay", lastmod: null }] },
    redirects: [{ path: "/", status: 302, location: "/stay" }],
    pages: [page()],
    assets: [{ path: "/stay/brand/icon-192", status: 200, robotsAllowed: false }],
    ...over,
  });

  it("שני צילומים זהים — אין הבדלים", () => {
    expect(compareSnapshots(snap(), snap())).toEqual([]);
  });

  it("CRITICAL: דף שנעלם מה-sitemap, noindex, canonical אחר, חסימה ב-robots, הפניה אחרת", () => {
    const after = snap({
      sitemap: { status: 200, urls: [] },
      redirects: [{ path: "/", status: 301, location: "/stay" }],
      pages: [
        page({
          robotsAllowed: false,
          head: parseHead(
            '<title>T</title><meta name="robots" content="noindex"/><link rel="canonical" href="https://y.test/stay"/>',
          ),
        }),
      ],
    });
    const critical = compareSnapshots(snap(), after).filter(
      (d: { severity: string }) => d.severity === "CRITICAL",
    );
    expect(critical.map((d: { key: string }) => d.key)).toEqual(
      expect.arrayContaining([
        "url removed",
        "/",
        "meta robots https://x.test/stay",
        "canonical https://x.test/stay",
        "robots.txt verdict https://x.test/stay",
      ]),
    );
  });

  it("פתיחת favicon לסריקה — INFO; שינוי כותרת — WARNING; קוד אימות שנעלם — CRITICAL", () => {
    const withCode = snap({
      pages: [page({ head: { ...page().head, googleVerification: "abc" } })],
    });
    const after = snap({
      assets: [{ path: "/stay/brand/icon-192", status: 200, robotsAllowed: true }],
      pages: [page({ head: { ...page().head, title: "T2" } })],
    });
    const diffs = compareSnapshots(withCode, after);
    const severityOf = (key: string) => diffs.find((d: { key: string }) => d.key === key)?.severity;
    expect(severityOf("robots.txt verdict /stay/brand/icon-192")).toBe("INFO");
    expect(severityOf("title https://x.test/stay")).toBe("WARNING");
    expect(severityOf("google-site-verification https://x.test/stay")).toBe("CRITICAL");
  });
});
