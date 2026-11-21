import { describe, expect, it } from "vitest";
import {
  cleanText,
  extractSignals,
  isPathAllowed,
  parseRobots,
  parseSitemap,
} from "@/platform/seo/audit/html";
import { auditPage, auditSite, healthScore, type FetchedPage } from "@/platform/seo/audit/rules";
import { crawlSite } from "@/platform/seo/audit/crawl";
import type { Fetcher } from "@/platform/seo/audit/fetch.server";

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
const ctx = {
  origin: "https://nofi-dorit.nuri1.fit",
  engine: "hospitality" as const,
  hebrew: true,
};

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
    expect(s.links.map((l) => l.href)).toEqual([
      "/stay/gallery",
      "https://nofi-dorit.nuri1.fit/stay",
    ]);
    expect(s.wordCount).toBeGreaterThan(80);
  });

  it("decodes entities, drops invisible direction marks, reports broken JSON-LD", () => {
    expect(cleanText("&#x200F;4,000&nbsp;&#8362; &amp; עוד")).toBe("4,000 ₪ & עוד");
    const s = extractSignals(
      `<html><head><script type="application/ld+json">{bad</script></head></html>`,
    );
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
    expect(
      parseSitemap(
        "<urlset><url><loc>https://a/x?a=1&amp;b=2</loc></url><url><loc><![CDATA[https://a/y]]></loc></url></urlset>",
      ),
    ).toEqual({
      urls: ["https://a/x?a=1&b=2", "https://a/y"],
      sitemaps: [],
    });
    expect(
      parseSitemap("<sitemapindex><sitemap><loc>https://a/s1.xml</loc></sitemap></sitemapindex>")
        .sitemaps,
    ).toEqual(["https://a/s1.xml"]);
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
    const issues = auditPage(page({ html, kind: "product" }), extractSignals(html), {
      ...ctx,
      engine: "ecommerce",
    });
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
    const many = Array.from({ length: 50 }, () => ({
      code: "images.alt_missing",
      severity: "medium" as const,
      url: null,
      message: "",
    }));
    expect(healthScore(many).score).toBe(91);
    expect(
      healthScore([{ code: "page.noindex", severity: "critical", url: null, message: "" }]).score,
    ).toBe(80);
    expect(healthScore([]).score).toBe(100);
  });
});

// ------------------------------------------------------------------------------------------------------------
// Hostile input: the pages, robots.txt and sitemaps come from the business's own address — a business with its
// own domain controls them. Every parse must stay linear, or one site could stall the whole server (the worker
// runs inside the web process). Each case below took effectively forever with the old backtracking regexes.
// ------------------------------------------------------------------------------------------------------------
const timed = <T>(fn: () => T): { value: T; ms: number } => {
  const t0 = performance.now();
  const value = fn();
  return { value, ms: performance.now() - t0 };
};
const LIMIT_MS = 1500; // generous for a slow CI machine; the linear scans take a few ms here

/** the old robots semantics (a regex per rule) — the reference for the new matcher, on small inputs only */
function referenceRuleMatches(rule: string, path: string): number {
  const anchored = rule.endsWith("$");
  const body = anchored ? rule.slice(0, -1) : rule;
  const re = new RegExp(
    "^" +
      body
        .split("*")
        .map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*") +
      (anchored ? "$" : ""),
  );
  return re.test(path) ? body.length : -1;
}
function referenceAllowed(rules: { disallow: string[]; allow: string[] }, path: string): boolean {
  let best = -1;
  let allowed = true;
  for (const r of rules.disallow) {
    const n = referenceRuleMatches(r, path);
    if (n > best) {
      best = n;
      allowed = false;
    }
  }
  for (const r of rules.allow) {
    const n = referenceRuleMatches(r, path);
    if (n >= best && n >= 0) {
      best = n;
      allowed = true;
    }
  }
  return allowed;
}

describe("SEO engine — hostile input stays fast (linear scans)", () => {
  it("robots.txt: a rule full of wildcards does not backtrack (the case from the security review)", () => {
    const rule = "/" + Array.from({ length: 20 }, () => "*a").join("") + "*b";
    const rules = parseRobots(`User-agent: *\nDisallow: ${rule}\n`);
    const { value, ms } = timed(() => isPathAllowed(rules, "/" + "a".repeat(60)));
    expect(value).toBe(true); // no "b" in the path: the rule does not match
    expect(ms).toBeLessThan(LIMIT_MS);
    expect(isPathAllowed(rules, "/" + "a".repeat(60) + "b")).toBe(false);
  });

  it("robots.txt: the new matcher agrees with the old regex semantics (random rules and paths)", () => {
    let seed = 20261122;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const pick = (alphabet: string, len: number) =>
      Array.from({ length: len }, () => alphabet[rnd(alphabet.length)]).join("");
    for (let i = 0; i < 4000; i += 1) {
      const disallow = Array.from(
        { length: 1 + rnd(3) },
        () => "/" + pick("ab/*.", rnd(7)) + (rnd(4) === 0 ? "$" : ""),
      );
      const allow = Array.from(
        { length: rnd(3) },
        () => "/" + pick("ab/*.", rnd(7)) + (rnd(4) === 0 ? "$" : ""),
      );
      const rules = { disallow, allow, sitemaps: [] };
      const path = "/" + pick("ab/.", rnd(9));
      expect(isPathAllowed(rules, path), JSON.stringify({ rules, path })).toBe(
        referenceAllowed(rules, path),
      );
    }
  });

  it("robots.txt: absurd rules are not evaluated (length and count caps)", () => {
    const long = "/" + "x".repeat(600);
    expect(parseRobots(`User-agent: *\nDisallow: ${long}\n`).disallow).toEqual([]);
    const many = Array.from({ length: 1500 }, (_, i) => `Disallow: /p${i}`).join("\n");
    expect(parseRobots(`User-agent: *\n${many}\n`).disallow).toHaveLength(1000);
  });

  it("sitemap: an unclosed <loc>, or <loc> followed by a sea of spaces, ends the scan quickly", () => {
    const spaces = timed(() => parseSitemap("<urlset><loc>" + " ".repeat(300_000)));
    expect(spaces.value).toEqual({ urls: [], sitemaps: [] });
    expect(spaces.ms).toBeLessThan(LIMIT_MS);
    const unclosed = timed(() => parseSitemap("<loc> ".repeat(150_000)));
    expect(unclosed.ms).toBeLessThan(LIMIT_MS);
    const fine = parseSitemap(
      "<urlset><url><LOC> https://a/x </LOC></url><url><loc>https://a/y</loc ></url></urlset>",
    );
    expect(fine.urls).toEqual(["https://a/x", "https://a/y"]);
  });

  it("pages: unclosed tags, runs of '<' and unclosed comments are parsed in linear time", () => {
    const cases: Record<string, string> = {
      "<a without >": "<a".repeat(300_000),
      "<a> without </a>": "<a>".repeat(250_000),
      "unclosed comments": "<!--".repeat(250_000),
      "<script> without </script>": "<script>".repeat(120_000),
      "a sea of <": "<".repeat(1_000_000),
      "<title> without </title>": "<title>".repeat(140_000),
      "<body> without </body>": "<body>".repeat(140_000),
      "<meta without >": "<meta ".repeat(160_000),
      "<html + 1 MB": "<html " + "a".repeat(1_000_000),
      "</a + spaces": "<a href=x>" + "</a ".repeat(200_000),
    };
    for (const [name, html] of Object.entries(cases)) {
      const { ms } = timed(() => extractSignals(html));
      expect(ms, name).toBeLessThan(LIMIT_MS);
    }
  });

  it("pages: one heading level left unclosed does not hide the others (and stays linear)", () => {
    const html = "<h1>".repeat(150_000) + "<h2>עוד מידע</h2><h3>פרטים</h3>";
    const { value, ms } = timed(() => extractSignals(html));
    expect(ms).toBeLessThan(LIMIT_MS);
    expect(value.headings).toEqual([
      { level: 2, text: "עוד מידע" },
      { level: 3, text: "פרטים" },
    ]);
  });

  it("pages: the same answers as before on ordinary markup (case, spaces in closing tags, nesting, body)", () => {
    const s = extractSignals(
      `<HTML LANG="he"><HEAD><TITLE>כותרת</TITLE ></HEAD><BODY><H1>ראשי</h1 ><A HREF="/x">קישור</A>` +
        `<a href="/1">אחד <a href="/2">שתיים</a><p>טקסט אחרון</p></BODY></HTML>`,
    );
    expect(s.lang).toBe("he");
    expect(s.titles).toEqual(["כותרת"]);
    expect(s.headings).toEqual([{ level: 1, text: "ראשי" }]);
    expect(s.links.map((l) => [l.href, l.text])).toEqual([
      ["/x", "קישור"],
      ["/1", "אחד שתיים"],
    ]);
    expect(s.wordCount).toBe(6); // the body only — the title is in the head
  });

  it("pages: an unclosed comment hides the rest (as in a browser); <svg/> does not swallow the page", () => {
    expect(extractSignals("<title>א</title><!-- <title>ב</title>").titles).toEqual(["א"]);
    const svg = extractSignals(
      '<body><svg viewBox="0 0 1 1"/><h1>כותרת</h1><svg><path/></svg><p>מילה</p></body>',
    );
    expect(svg.headings).toEqual([{ level: 1, text: "כותרת" }]);
    expect(svg.wordCount).toBe(2);
  });
});

describe("SEO engine — the crawl has one overall budget", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const html = `<html lang="he"><head><title>דף</title></head><body><h1>דף</h1></body></html>`;
  const fetcherWithDelay =
    (ms: number): Fetcher =>
    async (url) => {
      await sleep(ms);
      if (url.endsWith("/robots.txt"))
        return { status: 404, headers: {}, body: null, finalUrl: url };
      if (url.endsWith("/sitemap.xml"))
        return {
          status: 200,
          headers: { "content-type": "application/xml" },
          body: `<urlset>${Array.from({ length: 10 }, (_, i) => `<url><loc>https://s.example/p${i}</loc></url>`).join("")}</urlset>`,
          finalUrl: url,
        };
      return { status: 200, headers: { "content-type": "text/html" }, body: html, finalUrl: url };
    };
  const opts = {
    origin: "https://s.example",
    engine: "ecommerce" as const,
    startPaths: ["/"],
    maxPages: 30,
    kindOf: () => "home" as const,
    concurrency: 2,
  };

  it("a slow host: the crawl stops at the budget; pages it did not reach are left out, not reported as broken", async () => {
    const r = await crawlSite({ ...opts, deadlineMs: 150 }, fetcherWithDelay(60));
    expect(r.stoppedEarly).toBe(true);
    expect(r.pagesAudited).toBeLessThan(11);
    expect(r.pages.every((p) => p.status === 200)).toBe(true);
  });

  it("a normal host finishes everything inside the budget", async () => {
    const r = await crawlSite({ ...opts, deadlineMs: 60_000 }, fetcherWithDelay(0));
    expect(r.stoppedEarly).toBe(false);
    expect(r.pagesAudited).toBe(11);
  });
});
