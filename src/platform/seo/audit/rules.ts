// NURIEL AI SEO ENGINE — technical audit rules over rendered pages (per page) and the whole site.
// Built from the reviewed `seo` skill checklist (addyosmani/web-quality-skills): crawl/index controls, titles,
// descriptions, headings, canonical, mobile viewport, language, images, links, structured data.
// Rules of honesty (same skill): lengths are lint hints, never pass/fail; structured data is "eligible", never a
// promised rich result; the health score is a technical checklist score — NOT a ranking prediction.
import type { PageSignals, RobotsRules } from "./html";
import { isPathAllowed } from "./html";

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type PageKind = "home" | "product" | "category" | "unit" | "package" | "content" | "other";
export type SiteEngine = "ecommerce" | "hospitality" | "business_profile";

export interface AuditIssue {
  code: string;
  severity: Severity;
  url: string | null;
  message: string;
  detail?: string;
  count?: number;
  /** a finding that spans pages (the same title on 3 pages): every page, so each one can be fixed */
  urls?: string[];
}

export interface FetchedPage {
  url: string;
  status: number;
  headers: Record<string, string>;
  html: string | null;
  kind: PageKind;
  inSitemap: boolean;
  /** final URL after redirects (null when there were none) */
  finalUrl: string | null;
}

/** an address without the fragment and the trailing slash — how two URLs are compared */
export const addressKey = (u: string) => u.replace(/#.*$/, "").replace(/\/$/, "");

/** where the page landed after redirects — null when it did not move (or the fetcher echoed the same URL) */
export function landedAt(page: Pick<FetchedPage, "url" | "finalUrl">): string | null {
  return page.finalUrl && addressKey(page.finalUrl) !== addressKey(page.url) ? page.finalUrl : null;
}

export interface AuditContext {
  origin: string;
  engine: SiteEngine;
  /** the site is in Hebrew (all NURIEL sites are, today) */
  hebrew: boolean;
}

export const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low", "info"];

// linting proxies only (skill: "Use 50–60 characters only as a rough linting proxy, not a pass/fail limit")
export const TITLE_HINT = { min: 25, max: 65 } as const;
export const DESCRIPTION_HINT = { min: 70, max: 160 } as const;

/** structured-data types that count as "the business" on a home page, per engine */
const BUSINESS_TYPES: Record<SiteEngine, string[]> = {
  ecommerce: ["Organization", "OnlineStore", "Store", "WebSite", "LocalBusiness"],
  hospitality: [
    "LodgingBusiness",
    "Hotel",
    "Motel",
    "BedAndBreakfast",
    "Resort",
    "VacationRental",
    "Campground",
    "Hostel",
    "LocalBusiness",
  ],
  business_profile: ["LocalBusiness", "ProfessionalService", "Organization", "Person", "WebSite"],
};

/**
 * How a URL maps to a page kind, per engine (used by the crawler, the site rules and the reports). The query string
 * matters: a store's category page is "/?category=<name>" — the path alone ("/") would make it the home page.
 */
export function kindOfPath(engine: SiteEngine, path: string, search = ""): PageKind {
  const p = path.replace(/\/+$/, "") || "/";
  if (engine === "hospitality") {
    if (p === "/stay" || p === "/") return "home";
    // a unit and a room type are both a place to stay, with its own page
    if (p.startsWith("/stay/units/") || p.startsWith("/stay/rooms/")) return "unit";
    if (p.startsWith("/stay/packages/")) return "package";
    if (/^\/stay\/(book|my|manage|booking|account)/.test(p)) return "other";
    if (p.startsWith("/stay/")) return "content";
    return "other";
  }
  if (engine === "ecommerce") {
    const q = new URLSearchParams(search);
    if (p === "/" && q.get("category")) return "category";
    if (p === "/") return "home";
    if (p.startsWith("/product/") || p.startsWith("/products/")) return "product";
    if (p.startsWith("/category/") || p.startsWith("/categories/") || p.startsWith("/c/"))
      return "category";
    if (/^\/(cart|checkout|account|login|admin|orders|search)/.test(p)) return "other";
    return "content";
  }
  return p === "/" ? "home" : "content";
}

/** the sections a site is built of — the pages Google may show as sitelinks under the home page */
export const KEY_KINDS: Record<SiteEngine, PageKind[]> = {
  ecommerce: ["category"],
  hospitality: ["unit", "package"],
  business_profile: ["content"],
};

/** a link / sitemap address on this site, normalised for comparison (decoded, no fragment, no trailing slash) */
export function linkKey(href: string, origin: string): string | null {
  try {
    const u = new URL(href, origin + "/");
    if (u.host !== new URL(origin).host) return null;
    const path = u.pathname.replace(/\/+$/, "") || "/";
    return decodeURIComponent(path + u.search.replace(/\+/g, " "));
  } catch {
    return null;
  }
}

/** the site name the home page declares — WebSite structured data first, then og:site_name */
export function declaredSiteName(s: PageSignals | null): string | null {
  if (!s) return null;
  for (const b of s.jsonLd) {
    const found = findWebSiteName(b.parsed);
    if (found) return found;
  }
  return s.og["og:site_name"]?.trim() || null;
}

function findWebSiteName(value: unknown, depth = 0): string | null {
  if (!value || typeof value !== "object" || depth > 4) return null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const n = findWebSiteName(v, depth + 1);
      if (n) return n;
    }
    return null;
  }
  const o = value as Record<string, unknown>;
  const t = o["@type"];
  const types = Array.isArray(t) ? t : [t];
  if (types.includes("WebSite") && typeof o["name"] === "string" && o["name"].trim())
    return o["name"].trim();
  return findWebSiteName(o["@graph"], depth + 1);
}

function sameOriginPath(url: string, origin: string): string | null {
  try {
    const u = new URL(url, origin);
    const o = new URL(origin);
    return u.host === o.host ? u.pathname + u.search : null;
  } catch {
    return null;
  }
}

function issue(
  code: string,
  severity: Severity,
  url: string | null,
  message: string,
  extra: { detail?: string; count?: number; urls?: string[] } = {},
): AuditIssue {
  return { code, severity, url, message, ...extra };
}

function noindex(page: FetchedPage, s: PageSignals | null): boolean {
  const header = (page.headers["x-robots-tag"] ?? "").toLowerCase();
  return (
    /\bnoindex\b|\bnone\b/.test(header) ||
    (s?.metaRobots ?? []).some((r) => /\bnoindex\b|\bnone\b/.test(r))
  );
}

export function auditPage(
  page: FetchedPage,
  s: PageSignals | null,
  ctx: AuditContext,
): AuditIssue[] {
  const out: AuditIssue[] = [];
  const url = page.url;
  if (page.status >= 400 || page.status === 0) {
    out.push(
      issue(
        page.inSitemap ? "page.error_in_sitemap" : "page.error",
        "critical",
        url,
        page.status === 0 ? "העמוד לא נטען (אין תשובה מהשרת)" : `העמוד מחזיר שגיאה ${page.status}`,
        page.inSitemap ? { detail: "הכתובת מופיעה במפת האתר — גוגל ינסה לסרוק אותה שוב ושוב" } : {},
      ),
    );
    return out;
  }
  if (page.finalUrl && page.finalUrl !== url && page.inSitemap) {
    out.push(
      issue("page.redirect_in_sitemap", "medium", url, "כתובת במפת האתר מפנה לכתובת אחרת", {
        detail: page.finalUrl,
      }),
    );
  }
  if (!s) return out;
  if (url.startsWith("http://"))
    out.push(issue("page.not_https", "critical", url, "העמוד לא נטען ב-HTTPS"));
  if (noindex(page, s) && page.kind !== "other") {
    out.push(
      issue("page.noindex", "critical", url, "העמוד מסומן noindex — גוגל לא יציג אותו בתוצאות"),
    );
  }

  // title
  if (s.titles.length === 0 || !s.titles[0])
    out.push(issue("title.missing", "critical", url, "אין כותרת לעמוד (title)"));
  else {
    if (s.titles.length > 1)
      out.push(issue("title.multiple", "medium", url, "יש יותר מכותרת אחת לעמוד"));
    const len = [...(s.titles[0] ?? "")].length;
    if (len < TITLE_HINT.min || len > TITLE_HINT.max)
      out.push(
        issue(
          "title.length_hint",
          "low",
          url,
          `אורך הכותרת ${len} תווים — המלצה בלבד (בערך ${TITLE_HINT.min}–${TITLE_HINT.max})`,
          {
            detail: s.titles[0] ?? "",
          },
        ),
      );
  }

  // meta description
  if (s.metaDescriptions.length === 0 || !s.metaDescriptions[0])
    out.push(issue("description.missing", "high", url, "אין תיאור לעמוד (meta description)"));
  else {
    if (s.metaDescriptions.length > 1)
      out.push(issue("description.multiple", "medium", url, "יש יותר מתיאור אחד לעמוד"));
    const len = [...(s.metaDescriptions[0] ?? "")].length;
    if (len < DESCRIPTION_HINT.min || len > DESCRIPTION_HINT.max)
      out.push(
        issue(
          "description.length_hint",
          "low",
          url,
          `אורך התיאור ${len} תווים — המלצה בלבד (בערך ${DESCRIPTION_HINT.min}–${DESCRIPTION_HINT.max})`,
        ),
      );
  }

  // headings
  const h1 = s.headings.filter((h) => h.level === 1);
  if (h1.length === 0) out.push(issue("h1.missing", "high", url, "אין כותרת ראשית (H1) בעמוד"));
  else if (h1.length > 1)
    out.push(
      issue("h1.multiple", "low", url, `יש ${h1.length} כותרות H1 בעמוד`, { count: h1.length }),
    );
  else if (!h1[0]?.text) out.push(issue("h1.empty", "high", url, "כותרת ה-H1 ריקה"));
  let prev = 0;
  for (const h of s.headings) {
    if (prev && h.level > prev + 1) {
      out.push(issue("headings.skip", "low", url, `קפיצה ברמות הכותרות (H${prev} → H${h.level})`));
      break;
    }
    prev = h.level;
  }

  // canonical
  if (s.canonicals.length === 0)
    out.push(issue("canonical.missing", "high", url, "אין כתובת קנונית (canonical)"));
  else if (s.canonicals.length > 1)
    out.push(issue("canonical.multiple", "high", url, "יש יותר מכתובת קנונית אחת"));
  else {
    const c = s.canonicals[0] ?? "";
    try {
      const cu = new URL(c, url);
      const pu = new URL(page.finalUrl ?? url);
      if (cu.host !== pu.host)
        out.push(
          issue("canonical.other_host", "medium", url, "הכתובת הקנונית מפנה לדומיין אחר", {
            detail: c,
          }),
        );
      else if (cu.pathname !== pu.pathname)
        out.push(
          issue("canonical.other_page", "info", url, "הכתובת הקנונית מפנה לעמוד אחר", {
            detail: c,
          }),
        );
    } catch {
      out.push(issue("canonical.invalid", "high", url, "הכתובת הקנונית לא תקינה", { detail: c }));
    }
  }

  // mobile + language
  if (!s.viewport)
    out.push(issue("mobile.viewport", "high", url, "חסר viewport — העמוד לא מותאם לנייד"));
  if (!s.lang) out.push(issue("lang.missing", "medium", url, "חסרה הצהרת שפה (lang) על העמוד"));
  else if (ctx.hebrew && !/^he\b/i.test(s.lang))
    out.push(issue("lang.mismatch", "medium", url, `שפת העמוד מוצהרת ${s.lang} ולא עברית`));
  if (ctx.hebrew && (s.dir ?? "").toLowerCase() !== "rtl")
    out.push(issue("lang.dir", "low", url, 'חסר dir="rtl" לעמוד בעברית'));
  if (!s.charset) out.push(issue("page.charset", "low", url, "לא הוצהר קידוד UTF-8"));

  // images
  const noAlt = s.images.filter((i) => !i.hasAlt);
  if (noAlt.length > 0)
    out.push(
      issue("images.alt_missing", "medium", url, `${noAlt.length} תמונות בלי טקסט חלופי (alt)`, {
        count: noAlt.length,
      }),
    );
  const noSize = s.images.filter((i) => !i.width || !i.height);
  if (noSize.length > 2)
    out.push(
      issue(
        "images.no_dimensions",
        "low",
        url,
        `${noSize.length} תמונות בלי רוחב / גובה — עלול לגרום לקפיצות בעמוד (CLS)`,
        {
          count: noSize.length,
        },
      ),
    );
  const legacy = s.images.filter((i) => /\.(jpe?g|png)(\?|$)/i.test(i.src));
  if (legacy.length > 3)
    out.push(
      issue(
        "images.legacy_format",
        "info",
        url,
        `${legacy.length} תמונות בפורמט JPG/PNG — WebP/AVIF קלים יותר`,
        { count: legacy.length },
      ),
    );

  // links
  const internal = s.links.filter(
    (l) => sameOriginPath(l.href, ctx.origin) !== null && !l.href.startsWith("#"),
  );
  if (internal.length === 0)
    out.push(
      issue("links.no_internal", "medium", url, "אין בעמוד קישורים פנימיים לעמודים אחרים באתר"),
    );
  const emptyText = s.links.filter((l) => !l.text);
  if (emptyText.length > 0)
    out.push(
      issue("links.empty_text", "low", url, `${emptyText.length} קישורים בלי טקסט או תווית`, {
        count: emptyText.length,
      }),
    );

  // structured data
  const broken = s.jsonLd.filter((b) => b.error);
  if (broken.length > 0)
    out.push(
      issue("schema.invalid_json", "high", url, "נתונים מובנים (JSON-LD) לא תקינים", {
        detail: broken[0]?.error ?? "",
      }),
    );
  const types = new Set(s.jsonLd.flatMap((b) => b.types));
  if (page.kind === "home" && !BUSINESS_TYPES[ctx.engine].some((t) => types.has(t)))
    out.push(
      issue(
        "schema.business_missing",
        "medium",
        url,
        "אין בעמוד הבית נתונים מובנים שמתארים את העסק",
      ),
    );
  if (page.kind === "home" && !types.has("WebSite"))
    out.push(
      issue(
        "schema.website_missing",
        "medium",
        url,
        "בעמוד הבית אין נתונים מובנים מסוג WebSite — מהם גוגל לוקח את שם האתר שמופיע בתוצאות",
      ),
    );
  if (page.kind === "product") {
    if (!types.has("Product"))
      out.push(
        issue(
          "schema.product_missing",
          "medium",
          url,
          "אין נתונים מובנים מסוג Product בעמוד המוצר",
        ),
      );
    else if (!types.has("Offer") && !types.has("AggregateOffer"))
      out.push(
        issue(
          "schema.offer_missing",
          "medium",
          url,
          "למוצר אין Offer (מחיר / זמינות) בנתונים המובנים",
        ),
      );
  }
  if (
    (page.kind === "product" ||
      page.kind === "category" ||
      page.kind === "unit" ||
      page.kind === "package") &&
    !types.has("BreadcrumbList")
  )
    out.push(
      issue(
        "schema.breadcrumbs_missing",
        "low",
        url,
        "אין פירורי לחם (BreadcrumbList) בנתונים המובנים",
      ),
    );

  // open graph (sharing — not ranking)
  if (!s.og["og:title"] || !s.og["og:image"])
    out.push(issue("social.og_missing", "low", url, "חסרים נתוני שיתוף (og:title / og:image)"));

  // thin content (only on pages that are meant to carry content)
  if (
    (page.kind === "product" ||
      page.kind === "unit" ||
      page.kind === "package" ||
      page.kind === "category") &&
    s.mainWordCount < 60
  )
    out.push(
      issue(
        "content.thin",
        "medium",
        url,
        `מעט מאוד תוכן בעמוד (${s.mainWordCount} מילים, בלי התפריט והתחתית)`,
        { count: s.mainWordCount },
      ),
    );
  return out;
}

export interface SiteFacts {
  origin: string;
  robotsStatus: number;
  robots: RobotsRules | null;
  sitemapStatus: number;
  sitemapUrls: string[];
  /** the engine — for the structure rules (which pages are the site's sections); without it they don't run */
  engine?: SiteEngine;
}

export function auditSite(
  pages: { page: FetchedPage; signals: PageSignals | null }[],
  site: SiteFacts,
): AuditIssue[] {
  const out: AuditIssue[] = [];
  if (site.robotsStatus !== 200)
    out.push(
      issue("robots.missing", "medium", `${site.origin}/robots.txt`, "אין קובץ robots.txt תקין"),
    );
  else if (site.robots) {
    if (site.robots.sitemaps.length === 0)
      out.push(
        issue(
          "robots.no_sitemap",
          "low",
          `${site.origin}/robots.txt`,
          "קובץ robots.txt לא מפנה למפת האתר",
        ),
      );
    for (const { page } of pages) {
      const path = sameOriginPath(page.url, site.origin);
      if (path !== null && page.kind !== "other" && !isPathAllowed(site.robots, path))
        out.push(
          issue("robots.blocks_page", "critical", page.url, "robots.txt חוסם את העמוד מפני גוגל"),
        );
    }
  }
  if (site.sitemapStatus !== 200)
    out.push(
      issue(
        "sitemap.missing",
        "high",
        `${site.origin}/sitemap.xml`,
        "אין מפת אתר (sitemap.xml) תקינה",
      ),
    );
  else if (site.sitemapUrls.length === 0)
    out.push(issue("sitemap.empty", "high", `${site.origin}/sitemap.xml`, "מפת האתר ריקה"));

  // duplicates across pages (only 200 pages that are meant to be indexed)
  const indexable = pages.filter(
    (p) => p.page.status === 200 && p.signals && !noindex(p.page, p.signals),
  );
  // one page = one address: a URL that redirects to another audited URL is that page, not a second one
  const where = (p: FetchedPage) => addressKey(landedAt(p) ?? p.url);
  const dup = (
    pick: (s: PageSignals) => string | undefined,
    code: string,
    severity: Severity,
    label: string,
  ) => {
    const seen = new Map<string, Map<string, string>>();
    for (const p of indexable) {
      const v = p.signals ? (pick(p.signals) ?? "").trim() : "";
      if (!v) continue;
      const pages = seen.get(v) ?? new Map<string, string>();
      const at = where(p.page);
      // the page under its own address wins over a URL that redirects to it
      if (!pages.has(at) || !landedAt(p.page)) pages.set(at, p.page.url);
      seen.set(v, pages);
    }
    for (const [value, pages] of seen) {
      const urls = [...pages.values()];
      if (urls.length > 1)
        out.push(
          issue(code, severity, urls[0] ?? null, `${label} זהה ב-${urls.length} עמודים`, {
            detail: value,
            count: urls.length,
            urls,
          }),
        );
    }
  };
  dup((s) => s.titles[0], "title.duplicate", "high", "כותרת");
  dup((s) => s.metaDescriptions[0], "description.duplicate", "medium", "תיאור");

  // indexable pages missing from the sitemap
  const inMap = new Set(site.sitemapUrls.map(addressKey));
  const missing = indexable.filter(
    (p) =>
      p.page.kind !== "other" && !inMap.has(addressKey(p.page.url)) && !inMap.has(where(p.page)),
  );
  if (site.sitemapStatus === 200 && missing.length > 0)
    out.push(
      issue(
        "sitemap.missing_pages",
        "medium",
        null,
        `${missing.length} עמודים חשובים לא מופיעים במפת האתר`,
        {
          count: missing.length,
          urls: missing.slice(0, 20).map((p) => p.page.url),
          detail: missing
            .slice(0, 5)
            .map((p) => p.page.url)
            .join(" · "),
        },
      ),
    );
  if (site.engine) out.push(...structureIssues(indexable, site, site.engine));
  return out;
}

/** links longer than this are a whole card wrapped in a link, not a name — Google reads the link text */
export const ANCHOR_MAX = 60;
const SECTION_LABEL: Record<SiteEngine, string> = {
  ecommerce: "הקטגוריות",
  hospitality: "היחידות והחבילות",
  business_profile: "העמודים",
};

/**
 * Site structure (Google: sitelinks come from "the link structure of your site" — link your important pages from
 * other relevant pages with concise anchor text; a store links menu → categories → products with <a href>).
 * Measured only on what the crawler really fetched, so nothing is guessed about pages it did not see:
 * - the home page links to the site's sections (categories / units and packages / pages);
 * - a store's category pages link to products;
 * - the links to the sections carry a name, not a whole card;
 * - the site name is in every title, or in none (not in some).
 */
function structureIssues(
  indexable: { page: FetchedPage; signals: PageSignals | null }[],
  site: SiteFacts,
  engine: SiteEngine,
): AuditIssue[] {
  const out: AuditIssue[] = [];
  const kindOfUrl = (u: string): PageKind | null => {
    try {
      const x = new URL(u, site.origin + "/");
      return kindOfPath(engine, x.pathname, x.search);
    } catch {
      return null;
    }
  };
  const home = indexable.find((p) => p.page.kind === "home" && p.signals);
  const sections = new Map<string, string>(); // key → sitemap url
  for (const u of site.sitemapUrls) {
    const k = kindOfUrl(u);
    const key = linkKey(u, site.origin);
    if (k && key && KEY_KINDS[engine].includes(k) && key !== "/") sections.set(key, u);
  }

  if (home?.signals && sections.size > 0) {
    const fromHome = new Map<string, string>(); // key → the link text
    for (const l of home.signals.links) {
      const key = linkKey(l.href, site.origin);
      if (key && !fromHome.has(key)) fromHome.set(key, l.text);
    }
    const linked = [...sections.keys()].filter((k) => fromHome.has(k));
    const unlinked = [...sections.entries()].filter(([k]) => !fromHome.has(k)).map(([, u]) => u);
    if (linked.length === 0 || linked.length < sections.size / 2)
      out.push(
        issue(
          "structure.home_links",
          linked.length === 0 ? "high" : "medium",
          home.page.url,
          linked.length === 0
            ? `דף הבית לא מקשר לאף אחד מ${SECTION_LABEL[engine]} (${sections.size}) בקישור שגוגל יכול לסרוק`
            : `דף הבית מקשר רק ל-${linked.length} מתוך ${sections.size} ${SECTION_LABEL[engine]}`,
          { count: unlinked.length, urls: unlinked.slice(0, 20) },
        ),
      );
    const long = linked.filter((k) => (fromHome.get(k) ?? "").length > ANCHOR_MAX);
    if (long.length > 0)
      out.push(
        issue(
          "links.anchor_long",
          "low",
          home.page.url,
          `${long.length} קישורים מדף הבית ל${SECTION_LABEL[engine]} עוטפים כרטיס שלם — טקסט הקישור ארוך מ-${ANCHOR_MAX} תווים`,
          {
            count: long.length,
            urls: long.map((k) => sections.get(k) ?? k).slice(0, 20),
            detail: (fromHome.get(long[0] ?? "") ?? "").slice(0, 160),
          },
        ),
      );
  }

  // a store: from a category page Google must reach the products by links (not only through the sitemap)
  if (engine === "ecommerce" && site.sitemapUrls.some((u) => kindOfUrl(u) === "product")) {
    const noProducts = indexable.filter(
      (p) =>
        p.page.kind === "category" &&
        p.signals &&
        !p.signals.links.some((l) => kindOfUrl(l.href) === "product"),
    );
    if (noProducts.length > 0)
      out.push(
        issue(
          "structure.category_no_product_links",
          "high",
          noProducts[0]?.page.url ?? null,
          `${noProducts.length} עמודי קטגוריה בלי קישורים למוצרים — גוגל מגיע למוצרים רק דרך מפת האתר`,
          { count: noProducts.length, urls: noProducts.slice(0, 20).map((p) => p.page.url) },
        ),
      );
  }

  // the site name in the titles: in all of them (concisely) or in none — not in some
  const name = declaredSiteName(home?.signals ?? null);
  if (name) {
    const inner = indexable.filter((p) => p.page.kind !== "home" && p.signals?.titles[0]);
    const without = inner.filter((p) => !(p.signals?.titles[0] ?? "").includes(name));
    if (without.length > 0 && without.length < inner.length)
      out.push(
        issue(
          "title.brand_inconsistent",
          "low",
          without[0]?.page.url ?? null,
          `ב-${without.length} עמודים שם האתר ("${name}") חסר בכותרת, ובשאר הוא מופיע`,
          { count: without.length, urls: without.slice(0, 20).map((p) => p.page.url) },
        ),
      );
  }
  return out;
}

const DEDUCT: Record<Severity, number> = { critical: 20, high: 8, medium: 3, low: 1, info: 0 };
const CAP_PER_CODE: Record<Severity, number> = {
  critical: 40,
  high: 24,
  medium: 9,
  low: 3,
  info: 0,
};

/** technical checklist health 0–100 (each issue code counted with a cap, so 50 images don't sink a site) */
export function healthScore(issues: AuditIssue[]): {
  score: number;
  counts: Record<Severity, number>;
} {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const perCode = new Map<string, number>();
  for (const i of issues) {
    counts[i.severity] += 1;
    perCode.set(
      i.code,
      Math.min((perCode.get(i.code) ?? 0) + DEDUCT[i.severity], CAP_PER_CODE[i.severity]),
    );
  }
  let lost = 0;
  for (const v of perCode.values()) lost += v;
  return { score: Math.max(0, 100 - lost), counts };
}

export function sortIssues(issues: AuditIssue[]): AuditIssue[] {
  return [...issues].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
}
