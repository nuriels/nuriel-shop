import { describe, expect, it } from "vitest";
import { cleanText, extractSignals, isPathAllowed, parseRobots, parseSitemap } from "@/platform/seo/audit/html";
import { auditPage, auditSite, healthScore, type FetchedPage } from "@/platform/seo/audit/rules";

const GOOD = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>צימר זוגי עם בריכה | נופי דורית — ישעי, מול בית שמש</title>
<meta name="description" content="יחידת גן עדן VIP בנופי דורית: מיטה זוגית, חצר ויציאה ישירה לבריכה המשותפת. במושב ישעי, מול בית שמש. בדיקת תאריכים והזמנה באתר.">
<link rel="canonical" href="https://nofi-dorit.nuri1.fit/stay/units/vip">
<meta property="og:title" content="גן עדן VIP"><meta property="og:image" content="https://x/y.webp">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"LodgingBusiness","name":"נופי דורית"},{"@type":"BreadcrumbList","itemListElement":[]}]}</script>
<!-- <title>commented out</title> -->
</head><body><h1>גן עדן <span>VIP</span></h1><h2>מה ביחידה</h2><p>${"מילה ".repeat(80)}</p>
<img src="/a.webp" alt="המיטה הזוגית" width="600" height="400"><img src="/b.webp" alt="" width="1" height="1">
<a href="/stay/gallery">גלריה</a><a href="https://nofi-dorit.nuri1.fit/stay">בית</a>
<script>var x = "<h1>not a heading</h1>";</script></body></html>`;

const page = (over: Partial<FetchedPage> = {}): FetchedPage => ({
  url: "https://nofi-dorit.nuri1.fit/stay/units/vip",
  status: 200,
  headers: {},
  html: GOOD,
  kind: "unit",
  inSitemap: true,
  finalUrl: null,
  ...over,
});
const ctx = { origin: "https://nofi-dorit.nuri1.fit", engine: "hospitality" as const, hebrew: true };

describe("SEO engine — page signals", () => {
  it("reads title, description, canonical, viewport, lang/dir, OG and JSON-LD types; ignores comments and scripts", () => {
    const s = extractSignals(GOOD);
    expect(s.titles).toEqual(["צימר זוגי עם בריכה | נופי דורית — ישעי, מול בית שמש"]);
    expect(s.metaDescriptions[0]).toContain("גן עדן VIP");
    expect(s.canonicals).toEqual(["https://nofi-dorit.nuri1.fit/stay/units/vip"]);
    expect(s.viewport).toContain("width=device-width");
    expect([s.lang, s.dir, s.charset]).toEqual(["he", "rtl", true]);
    expect(s.og["og:title"]).toBe("גן עדן VIP");
    expect(s.jsonLd[0]?.types.sort()).toEqual(["BreadcrumbList", "LodgingBusiness"]);
    expect(s.headings).toEqual([
      { level: 1, text: "גן עדן VIP" },
      { level: 2, text: "מה ביחידה" },
    ]);
    expect(s.images.map((i) => [i.src, i.alt, i.hasAlt])).toEqual([
      ["/a.webp", "המיטה הזוגית", true],
      ["/b.webp", "", true],
    ]);
    expect(s.links.map((l) => l.href)).toEqual(["/stay/gallery", "https://nofi-dorit.nuri1.fit/stay"]);
    expect(s.wordCount).toBeGreaterThan(80);
  });

  it("decodes entities, drops invisible direction marks, reports broken JSON-LD", () => {
    expect(cleanText("&#x200F;4,000&nbsp;&#8362; &amp; עוד")).toBe("4,000 ₪ & עוד");
    const s = extractSignals(`<html><head><script type="application/ld+json">{bad</script></head></html>`);
    expect(s.jsonLd[0]?.error).toBeTruthy();
    expect(s.jsonLd[0]?.types).toEqual([]);
  });

  it("robots.txt: Googlebot group wins over *, longest rule wins, Allow wins a tie, wildcards and $", () => {
    const r = parseRobots(
      "User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nDisallow: /manage\nDisallow: /*.pdf$\nAllow: /manage/public\nSitemap: https://x/sitemap.xml",
    );
    expect(r.sitemaps).toEqual(["https://x/sitemap.xml"]);
    expect(isPathAllowed(r, "/stay")).toBe(true);
    expect(isPathAllowed(r, "/manage/login")).toBe(false);
    expect(isPathAllowed(r, "/manage/public/x")).toBe(true);
    expect(isPathAllowed(r, "/files/a.pdf")).toBe(false);
    expect(isPathAllowed(r, "/files/a.pdf?x=1")).toBe(true);
    expect(isPathAllowed(parseRobots("User-agent: *\nDisallow:\n"), "/anything")).toBe(true);
  });

  it("sitemap: urlset URLs, index entries, CDATA and entities", () => {
    expect(parseSitemap("<urlset><url><loc>https://a/x?a=1&amp;b=2</loc></url><url><loc><![CDATA[https://a/y]]></loc></url></urlset>")).toEqual({
      urls: ["https://a/x?a=1&b=2", "https://a/y"],
      sitemaps: [],
    });
    expect(parseSitemap("<sitemapindex><sitemap><loc>https://a/s1.xml</loc></sitemap></sitemapindex>").sitemaps).toEqual([
      "https://a/s1.xml",
    ]);
  });
});

describe("SEO engine — audit rules", () => {
  it("a well-built page has no critical / high issues", () => {
    const issues = auditPage(page(), extractSignals(GOOD), ctx);
    expect(issues.filter((i) => i.severity === "critical" || i.severity === "high")).toEqual([]);
  });

  it("flags the real problems: noindex, missing title / description / H1 / canonical / viewport, alt, broken schema", () => {
    const html = `<html><head><meta name="robots" content="noindex"><script type="application/ld+json">{x</script></head>
      <body><img src="/a.jpg"><a href="https://other.example/">x</a></body></html>`;
    const codes = auditPage(page({ html }), extractSignals(html), ctx).map((i) => i.code);
    for (const c of [
      "page.noindex",
      "title.missing",
      "description.missing",
      "h1.missing",
      "canonical.missing",
      "mobile.viewport",
      "lang.missing",
      "images.alt_missing",
      "links.no_internal",
      "schema.invalid_json",
      "schema.breadcrumbs_missing",
      "content.thin",
    ])
      expect(codes).toContain(c);
  });

  it("lengths are hints (low), never failures; a product page needs Product + Offer", () => {
    const html = GOOD.replace(/<title>[^<]*<\/title>/, "<title>קצר</title>");
    const issues = auditPage(page({ html, kind: "product" }), extractSignals(html), { ...ctx, engine: "ecommerce" });
    expect(issues.find((i) => i.code === "title.length_hint")?.severity).toBe("low");
    expect(issues.map((i) => i.code)).toContain("schema.product_missing");
  });

  it("error pages stop the page checks; an error URL inside the sitemap is called out", () => {
    const issues = auditPage(page({ status: 404, html: null }), null, ctx);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("page.error_in_sitemap");
  });

  it("site level: robots blocking a page, duplicate titles, pages missing from the sitemap", () => {
    const s = extractSignals(GOOD);
    const p1 = page();
    const p2 = page({ url: "https://nofi-dorit.nuri1.fit/stay/units/other", inSitemap: false });
    const issues = auditSite(
      [
        { page: p1, signals: s },
        { page: p2, signals: s },
      ],
      {
        origin: ctx.origin,
        robotsStatus: 200,
        robots: parseRobots("User-agent: *\nDisallow: /stay/units/other\n"),
        sitemapStatus: 200,
        sitemapUrls: [p1.url],
      },
    );
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("robots.blocks_page");
    expect(codes).toContain("robots.no_sitemap");
    expect(codes).toContain("title.duplicate");
    expect(codes).toContain("sitemap.missing_pages");
  });

  it("health score caps each issue code (50 pages without alt do not sink the site)", () => {
    const many = Array.from({ length: 50 }, () => ({ code: "images.alt_missing", severity: "medium" as const, url: null, message: "" }));
    expect(healthScore(many).score).toBe(91);
    expect(healthScore([{ code: "page.noindex", severity: "critical", url: null, message: "" }]).score).toBe(80);
    expect(healthScore([]).score).toBe(100);
  });
});
