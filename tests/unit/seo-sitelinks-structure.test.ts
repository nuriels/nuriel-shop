// מבנה האתר בשביל Sitelinks (Google Search Central — sitelinks, site names, links-crawlable, ecommerce structure):
// סוג העמוד לפי הכתובת (כולל ?category=), דגימה הוגנת של מפת האתר, כללי המבנה (דף הבית מקשר לאגפים, קטגוריה
// מקשרת למוצרים, טקסט קישור קצר, שם האתר בכותרות), WebSite בדף הבית, ו"תוכן דל" בלי התפריט והתחתית.
// הכללים נמדדים רק על מה שהסורק באמת הוריד — כאן: HTML קבוע, בלי רשת.
import { describe, expect, it } from "vitest";
import { extractSignals } from "@/platform/seo/audit/html";
import {
  ANCHOR_MAX,
  auditPage,
  auditSite,
  declaredSiteName,
  healthScore,
  kindOfPath,
  linkKey,
  type FetchedPage,
  type PageKind,
  type SiteEngine,
} from "@/platform/seo/audit/rules";
import { fairSample } from "@/platform/seo/audit/crawl";

const STORE = "https://shop.example.co.il";
const ZIMMER = "https://zimmer.example.co.il";
const cat = (name: string) => `${STORE}/?category=${encodeURIComponent(name)}`;
const CATEGORIES = ["מחשבים מחודשים", "ניידים", "מסכים", "תקשורת"];

const doc = (opts: { title: string; head?: string; body: string }) =>
  `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${opts.title}</title>${opts.head ?? ""}</head><body>${opts.body}</body></html>`;
const websiteLd = (name: string, url: string) =>
  `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "WebSite", name, url })}</script>`;

function fetched(
  url: string,
  kind: PageKind,
  html: string,
): { page: FetchedPage; signals: ReturnType<typeof extractSignals> } {
  return {
    page: { url, status: 200, headers: {}, html, kind, inSitemap: true, finalUrl: null },
    signals: extractSignals(html),
  };
}

function site(engine: SiteEngine, origin: string, sitemapUrls: string[]) {
  return { origin, robotsStatus: 200, robots: null, sitemapStatus: 200, sitemapUrls, engine };
}

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe("page kind by address — the query string matters", () => {
  it("a store category is /?category=<name>, not the home page", () => {
    expect(kindOfPath("ecommerce", "/", "?category=%D7%9E%D7%A1%D7%9B%D7%99%D7%9D")).toBe(
      "category",
    );
    expect(kindOfPath("ecommerce", "/", "")).toBe("home");
    expect(kindOfPath("ecommerce", "/", "?utm_source=x")).toBe("home");
    expect(kindOfPath("ecommerce", "/product/123")).toBe("product");
    expect(kindOfPath("ecommerce", "/cart")).toBe("other");
    expect(kindOfPath("ecommerce", "/about")).toBe("content");
  });

  it("a zimmer site: units and room types are units, packages are packages, the guest area is technical", () => {
    expect(kindOfPath("hospitality", "/stay")).toBe("home");
    expect(kindOfPath("hospitality", "/stay/units/vip")).toBe("unit");
    expect(kindOfPath("hospitality", "/stay/rooms/deluxe")).toBe("unit");
    expect(kindOfPath("hospitality", "/stay/packages/bride")).toBe("package");
    expect(kindOfPath("hospitality", "/stay/account")).toBe("other");
    expect(kindOfPath("hospitality", "/stay/book")).toBe("other");
    expect(kindOfPath("hospitality", "/stay/gallery")).toBe("content");
  });

  it("links and sitemap addresses compare decoded (%20, + and the raw Hebrew are the same address)", () => {
    expect(linkKey("/?category=מחשבים מחודשים", STORE)).toBe("/?category=מחשבים מחודשים");
    expect(linkKey(cat("מחשבים מחודשים"), STORE)).toBe("/?category=מחשבים מחודשים");
    expect(linkKey("/?category=מחשבים+מחודשים", STORE)).toBe("/?category=מחשבים מחודשים");
    expect(linkKey("https://other.example/?category=x", STORE)).toBeNull();
    expect(linkKey("/product/1/", STORE)).toBe("/product/1");
  });
});

describe("fair sample of the sitemap", () => {
  it("takes one page of each kind in turn, so 300 products never push the categories out", () => {
    const urls = [
      ...Array.from({ length: 5 }, (_, i) => `${STORE}/product/${i}`),
      cat("מסכים"),
      cat("ניידים"),
      `${STORE}/`,
      `${STORE}/about`,
    ];
    const kindOf = (p: string, s?: string) => kindOfPath("ecommerce", p, s ?? "");
    const order = fairSample(urls, kindOf);
    expect(order.slice(0, 4)).toEqual([
      `${STORE}/`,
      cat("מסכים"),
      `${STORE}/product/0`,
      `${STORE}/about`,
    ]);
    expect(order[4]).toBe(cat("ניידים"));
    expect(order).toHaveLength(urls.length);
    expect(new Set(order).size).toBe(urls.length);
  });
});

describe("site structure — what Google reads for sitelinks", () => {
  const sitemap = [`${STORE}/`, ...CATEGORIES.map(cat), `${STORE}/product/1`];
  const homeWith = (links: string) =>
    fetched(
      `${STORE}/`,
      "home",
      doc({
        title: "נוריאל שופ — מחשבים מחודשים",
        head: websiteLd("נוריאל שופ", `${STORE}/`),
        body: `<main>${links}</main>`,
      }),
    );

  it("a home page whose categories are buttons (no <a href>) links to none of them — high, with the addresses", () => {
    const home = homeWith(CATEGORIES.map((c) => `<button type="button">${c}</button>`).join(""));
    const issues = auditSite([home], site("ecommerce", STORE, sitemap));
    const found = issues.find((i) => i.code === "structure.home_links");
    expect(found?.severity).toBe("high");
    expect(found?.count).toBe(4);
    expect(found?.urls).toEqual(CATEGORIES.map(cat));
  });

  it("crawlable links to every category (any encoding) — no structure finding", () => {
    const home = homeWith(
      CATEGORIES.map((c, i) =>
        i % 2
          ? `<a href="/?category=${encodeURIComponent(c)}">${c}</a>`
          : `<a href="/?category=${c}">${c}</a>`,
      ).join(""),
    );
    const issues = auditSite([home], site("ecommerce", STORE, sitemap));
    expect(codes(issues)).not.toContain("structure.home_links");
    expect(codes(issues)).not.toContain("links.anchor_long");
  });

  it("only 1 of 4 categories linked — medium; 2 of 4 is enough", () => {
    const one = homeWith(`<a href="${cat("מסכים")}">מסכים</a>`);
    expect(
      auditSite([one], site("ecommerce", STORE, sitemap)).find(
        (i) => i.code === "structure.home_links",
      )?.severity,
    ).toBe("medium");
    const two = homeWith(
      `<a href="${cat("מסכים")}">מסכים</a><a href="${cat("ניידים")}">ניידים</a>`,
    );
    expect(codes(auditSite([two], site("ecommerce", STORE, sitemap)))).not.toContain(
      "structure.home_links",
    );
  });

  it("a whole card wrapped in one link — the link text is too long for a sitelink (low)", () => {
    const card = (c: string) =>
      `<a href="${cat(c)}"><img src="/x.webp" alt=""><span>${c}</span><span>המבחר הגדול ביותר של ${c} במחירים הטובים ביותר, עם אחריות ומשלוח מהיר</span></a>`;
    const home = homeWith(CATEGORIES.map(card).join(""));
    const found = auditSite([home], site("ecommerce", STORE, sitemap)).find(
      (i) => i.code === "links.anchor_long",
    );
    expect(found?.severity).toBe("low");
    expect(found?.count).toBe(4);
    expect((found?.detail ?? "").length).toBeGreaterThan(ANCHOR_MAX);
  });

  it("a store category page must link to its products (not only the sitemap) — high", () => {
    const home = homeWith(CATEGORIES.map((c) => `<a href="${cat(c)}">${c}</a>`).join(""));
    const bare = fetched(
      cat("מסכים"),
      "category",
      doc({ title: "מסכים | נוריאל שופ", body: "<main><h1>מסכים</h1></main>" }),
    );
    const linked = fetched(
      cat("ניידים"),
      "category",
      doc({
        title: "ניידים | נוריאל שופ",
        body: `<main><h1>ניידים</h1><a href="/product/1">לנובו ThinkPad</a></main>`,
      }),
    );
    const issues = auditSite([home, bare, linked], site("ecommerce", STORE, sitemap));
    const found = issues.find((i) => i.code === "structure.category_no_product_links");
    expect(found?.severity).toBe("high");
    expect(found?.urls).toEqual([cat("מסכים")]);
  });

  it("the site name in some titles but not others — low; in all (or none) — nothing", () => {
    const home = homeWith(CATEGORIES.map((c) => `<a href="${cat(c)}">${c}</a>`).join(""));
    const page = (path: string, title: string) =>
      fetched(`${STORE}${path}`, "content", doc({ title, body: "<main><h1>x</h1></main>" }));
    const mixed = auditSite(
      [home, page("/about", "אודות | נוריאל שופ"), page("/contact", "צור קשר")],
      site("ecommerce", STORE, sitemap),
    );
    const found = mixed.find((i) => i.code === "title.brand_inconsistent");
    expect(found?.severity).toBe("low");
    expect(found?.urls).toEqual([`${STORE}/contact`]);
    const all = auditSite(
      [home, page("/about", "אודות | נוריאל שופ"), page("/contact", "צור קשר | נוריאל שופ")],
      site("ecommerce", STORE, sitemap),
    );
    expect(codes(all)).not.toContain("title.brand_inconsistent");
  });

  it("a zimmer site: the home page must link to the units and the packages", () => {
    const zSitemap = [
      `${ZIMMER}/stay`,
      `${ZIMMER}/stay/units/moriah`,
      `${ZIMMER}/stay/units/eden`,
      `${ZIMMER}/stay/packages/bride`,
    ];
    const home = fetched(
      `${ZIMMER}/stay`,
      "home",
      doc({
        title: "נופי דורית",
        head: websiteLd("נופי דורית", `${ZIMMER}/stay`),
        body: `<main><h3><a href="/stay/units/moriah">מוריה</a></h3><h3><a href="/stay/units/eden">גן עדן</a></h3></main>`,
      }),
    );
    const issues = auditSite([home], site("hospitality", ZIMMER, zSitemap));
    // 2 of 3 linked: enough (the package is missing — reported only when fewer than half are linked)
    expect(codes(issues)).not.toContain("structure.home_links");
    const none = fetched(
      `${ZIMMER}/stay`,
      "home",
      doc({ title: "נופי דורית", body: "<main><p>ברוכים הבאים</p></main>" }),
    );
    const found = auditSite([none], site("hospitality", ZIMMER, zSitemap)).find(
      (i) => i.code === "structure.home_links",
    );
    expect(found?.severity).toBe("high");
    expect(found?.message).toContain("היחידות והחבילות");
  });

  it("without the engine (an old call) the structure rules do not run — nothing guessed", () => {
    const home = homeWith("");
    const issues = auditSite([home], {
      origin: STORE,
      robotsStatus: 200,
      robots: null,
      sitemapStatus: 200,
      sitemapUrls: sitemap,
    });
    expect(
      codes(issues).filter((c) => c.startsWith("structure.") || c === "links.anchor_long"),
    ).toEqual([]);
  });
});

describe("home page: the site name and the business", () => {
  const ctx = { origin: ZIMMER, engine: "hospitality" as const, hebrew: true };
  const homeHtml = (head: string) =>
    doc({
      title: "נופי דורית — צימרים במושב ישעי",
      head: `<meta name="description" content="${"תיאור ".repeat(20)}">${head}`,
      body: `<main><h1>נופי דורית</h1><p>${"מילה ".repeat(80)}</p></main>`,
    });
  const lodging = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"LodgingBusiness","name":"נופי דורית"}</script>`;

  it("WebSite structured data missing on the home page — medium (Google takes the site name from it)", () => {
    const page: FetchedPage = {
      url: `${ZIMMER}/stay`,
      status: 200,
      headers: {},
      html: homeHtml(lodging),
      kind: "home",
      inSitemap: true,
      finalUrl: null,
    };
    expect(codes(auditPage(page, extractSignals(page.html ?? ""), ctx))).toContain(
      "schema.website_missing",
    );
    const withSite = {
      ...page,
      html: homeHtml(lodging + websiteLd("נופי דורית", `${ZIMMER}/stay`)),
    };
    expect(codes(auditPage(withSite, extractSignals(withSite.html ?? ""), ctx))).not.toContain(
      "schema.website_missing",
    );
    // not asked of inner pages
    const inner = { ...page, url: `${ZIMMER}/stay/units/moriah`, kind: "unit" as const };
    expect(codes(auditPage(inner, extractSignals(inner.html ?? ""), ctx))).not.toContain(
      "schema.website_missing",
    );
  });

  it("the declared site name: WebSite first, then og:site_name", () => {
    expect(declaredSiteName(extractSignals(homeHtml(websiteLd("נופי דורית", ZIMMER))))).toBe(
      "נופי דורית",
    );
    expect(
      declaredSiteName(extractSignals(homeHtml(`<meta property="og:site_name" content="נופי">`))),
    ).toBe("נופי");
    expect(declaredSiteName(extractSignals(homeHtml("")))).toBeNull();
  });
});

describe("thin content is measured without the menu and the footer", () => {
  const ctx = { origin: STORE, engine: "ecommerce" as const, hebrew: true };
  const chrome = `<header><nav>${"קישור ".repeat(60)}</nav></header>`;
  const footer = `<footer>${"תחתית ".repeat(120)}</footer>`;

  it("a category page with a big menu and footer but almost nothing of its own is thin", () => {
    const html = doc({
      title: "מסכים | נוריאל שופ",
      body: `${chrome}<main><h1>מסכים</h1><p>אין מוצרים</p></main>${footer}`,
    });
    const s = extractSignals(html);
    expect(s.wordCount).toBeGreaterThan(150);
    expect(s.mainWordCount).toBeLessThan(10);
    const page: FetchedPage = {
      url: cat("מסכים"),
      status: 200,
      headers: {},
      html,
      kind: "category",
      inSitemap: true,
      finalUrl: null,
    };
    expect(auditPage(page, s, ctx).find((i) => i.code === "content.thin")?.count).toBe(
      s.mainWordCount,
    );
  });

  it("without a <main>: the body minus header / nav / footer / aside", () => {
    const html = doc({
      title: "מסכים",
      body: `${chrome}<section><h1>מסכים</h1><p>${"מילה ".repeat(70)}</p></section>${footer}`,
    });
    const s = extractSignals(html);
    expect(s.mainWordCount).toBeGreaterThanOrEqual(70);
    expect(s.mainWordCount).toBeLessThan(80);
  });
});

describe("the score follows real fixes, not weights", () => {
  it("the same weights as before: fixing the structure raises the score by exactly what it cost", () => {
    const sitemap = [`${STORE}/`, ...CATEGORIES.map(cat)];
    const html = (links: string) =>
      doc({
        title: "נוריאל שופ — מחשבים מחודשים",
        head: websiteLd("נוריאל שופ", `${STORE}/`),
        body: `<main>${links}</main>`,
      });
    const before = auditSite(
      [fetched(`${STORE}/`, "home", html(""))],
      site("ecommerce", STORE, sitemap),
    );
    const after = auditSite(
      [
        fetched(
          `${STORE}/`,
          "home",
          html(CATEGORIES.map((c) => `<a href="${cat(c)}">${c}</a>`).join("")),
        ),
      ],
      site("ecommerce", STORE, sitemap),
    );
    expect(healthScore(after).score - healthScore(before).score).toBe(8); // one "high" finding
  });
});
