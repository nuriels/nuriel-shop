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
  extra: { detail?: string; count?: number } = {},
): AuditIssue {
  return { code, severity, url, message, ...extra };
}

function noindex(page: FetchedPage, s: PageSignals | null): boolean {
  const header = (page.headers["x-robots-tag"] ?? "").toLowerCase();
  return /\bnoindex\b|\bnone\b/.test(header) || (s?.metaRobots ?? []).some((r) => /\bnoindex\b|\bnone\b/.test(r));
}

export function auditPage(page: FetchedPage, s: PageSignals | null, ctx: AuditContext): AuditIssue[] {
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
      issue("page.redirect_in_sitemap", "medium", url, "כתובת במפת האתר מפנה לכתובת אחרת", { detail: page.finalUrl }),
    );
  }
  if (!s) return out;
  if (url.startsWith("http://")) out.push(issue("page.not_https", "critical", url, "העמוד לא נטען ב-HTTPS"));
  if (noindex(page, s) && page.kind !== "other") {
    out.push(issue("page.noindex", "critical", url, "העמוד מסומן noindex — גוגל לא יציג אותו בתוצאות"));
  }

  // title
  if (s.titles.length === 0 || !s.titles[0]) out.push(issue("title.missing", "critical", url, "אין כותרת לעמוד (title)"));
  else {
    if (s.titles.length > 1) out.push(issue("title.multiple", "medium", url, "יש יותר מכותרת אחת לעמוד"));
    const len = [...(s.titles[0] ?? "")].length;
    if (len < TITLE_HINT.min || len > TITLE_HINT.max)
      out.push(
        issue("title.length_hint", "low", url, `אורך הכותרת ${len} תווים — המלצה בלבד (בערך ${TITLE_HINT.min}–${TITLE_HINT.max})`, {
          detail: s.titles[0] ?? "",
        }),
      );
  }

  // meta description
  if (s.metaDescriptions.length === 0 || !s.metaDescriptions[0])
    out.push(issue("description.missing", "high", url, "אין תיאור לעמוד (meta description)"));
  else {
    if (s.metaDescriptions.length > 1) out.push(issue("description.multiple", "medium", url, "יש יותר מתיאור אחד לעמוד"));
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
  else if (h1.length > 1) out.push(issue("h1.multiple", "low", url, `יש ${h1.length} כותרות H1 בעמוד`, { count: h1.length }));
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
  if (s.canonicals.length === 0) out.push(issue("canonical.missing", "high", url, "אין כתובת קנונית (canonical)"));
  else if (s.canonicals.length > 1) out.push(issue("canonical.multiple", "high", url, "יש יותר מכתובת קנונית אחת"));
  else {
    const c = s.canonicals[0] ?? "";
    try {
      const cu = new URL(c, url);
      const pu = new URL(page.finalUrl ?? url);
      if (cu.host !== pu.host) out.push(issue("canonical.other_host", "medium", url, "הכתובת הקנונית מפנה לדומיין אחר", { detail: c }));
      else if (cu.pathname !== pu.pathname)
        out.push(issue("canonical.other_page", "info", url, "הכתובת הקנונית מפנה לעמוד אחר", { detail: c }));
    } catch {
      out.push(issue("canonical.invalid", "high", url, "הכתובת הקנונית לא תקינה", { detail: c }));
    }
  }

  // mobile + language
  if (!s.viewport) out.push(issue("mobile.viewport", "high", url, "חסר viewport — העמוד לא מותאם לנייד"));
  if (!s.lang) out.push(issue("lang.missing", "medium", url, "חסרה הצהרת שפה (lang) על העמוד"));
  else if (ctx.hebrew && !/^he\b/i.test(s.lang)) out.push(issue("lang.mismatch", "medium", url, `שפת העמוד מוצהרת ${s.lang} ולא עברית`));
  if (ctx.hebrew && (s.dir ?? "").toLowerCase() !== "rtl") out.push(issue("lang.dir", "low", url, "חסר dir=\"rtl\" לעמוד בעברית"));
  if (!s.charset) out.push(issue("page.charset", "low", url, "לא הוצהר קידוד UTF-8"));

  // images
  const noAlt = s.images.filter((i) => !i.hasAlt);
  if (noAlt.length > 0)
    out.push(issue("images.alt_missing", "medium", url, `${noAlt.length} תמונות בלי טקסט חלופי (alt)`, { count: noAlt.length }));
  const noSize = s.images.filter((i) => !i.width || !i.height);
  if (noSize.length > 2)
    out.push(
      issue("images.no_dimensions", "low", url, `${noSize.length} תמונות בלי רוחב / גובה — עלול לגרום לקפיצות בעמוד (CLS)`, {
        count: noSize.length,
      }),
    );
  const legacy = s.images.filter((i) => /\.(jpe?g|png)(\?|$)/i.test(i.src));
  if (legacy.length > 3)
    out.push(issue("images.legacy_format", "info", url, `${legacy.length} תמונות בפורמט JPG/PNG — WebP/AVIF קלים יותר`, { count: legacy.length }));

  // links
  const internal = s.links.filter((l) => sameOriginPath(l.href, ctx.origin) !== null && !l.href.startsWith("#"));
  if (internal.length === 0) out.push(issue("links.no_internal", "medium", url, "אין בעמוד קישורים פנימיים לעמודים אחרים באתר"));
  const emptyText = s.links.filter((l) => !l.text);
  if (emptyText.length > 0)
    out.push(issue("links.empty_text", "low", url, `${emptyText.length} קישורים בלי טקסט או תווית`, { count: emptyText.length }));

  // structured data
  const broken = s.jsonLd.filter((b) => b.error);
  if (broken.length > 0) out.push(issue("schema.invalid_json", "high", url, "נתונים מובנים (JSON-LD) לא תקינים", { detail: broken[0]?.error ?? "" }));
  const types = new Set(s.jsonLd.flatMap((b) => b.types));
  if (page.kind === "home" && !BUSINESS_TYPES[ctx.engine].some((t) => types.has(t)))
    out.push(issue("schema.business_missing", "medium", url, "אין בעמוד הבית נתונים מובנים שמתארים את העסק"));
  if (page.kind === "product") {
    if (!types.has("Product")) out.push(issue("schema.product_missing", "medium", url, "אין נתונים מובנים מסוג Product בעמוד המוצר"));
    else if (!types.has("Offer") && !types.has("AggregateOffer"))
      out.push(issue("schema.offer_missing", "medium", url, "למוצר אין Offer (מחיר / זמינות) בנתונים המובנים"));
  }
  if ((page.kind === "product" || page.kind === "category" || page.kind === "unit" || page.kind === "package") && !types.has("BreadcrumbList"))
    out.push(issue("schema.breadcrumbs_missing", "low", url, "אין פירורי לחם (BreadcrumbList) בנתונים המובנים"));

  // open graph (sharing — not ranking)
  if (!s.og["og:title"] || !s.og["og:image"]) out.push(issue("social.og_missing", "low", url, "חסרים נתוני שיתוף (og:title / og:image)"));

  // thin content (only on pages that are meant to carry content)
  if ((page.kind === "product" || page.kind === "unit" || page.kind === "package" || page.kind === "category") && s.wordCount < 60)
    out.push(issue("content.thin", "medium", url, `מעט מאוד תוכן בעמוד (${s.wordCount} מילים)`, { count: s.wordCount }));
  return out;
}

export interface SiteFacts {
  origin: string;
  robotsStatus: number;
  robots: RobotsRules | null;
  sitemapStatus: number;
  sitemapUrls: string[];
}

export function auditSite(pages: { page: FetchedPage; signals: PageSignals | null }[], site: SiteFacts): AuditIssue[] {
  const out: AuditIssue[] = [];
  if (site.robotsStatus !== 200) out.push(issue("robots.missing", "medium", `${site.origin}/robots.txt`, "אין קובץ robots.txt תקין"));
  else if (site.robots) {
    if (site.robots.sitemaps.length === 0)
      out.push(issue("robots.no_sitemap", "low", `${site.origin}/robots.txt`, "קובץ robots.txt לא מפנה למפת האתר"));
    for (const { page } of pages) {
      const path = sameOriginPath(page.url, site.origin);
      if (path !== null && page.kind !== "other" && !isPathAllowed(site.robots, path))
        out.push(issue("robots.blocks_page", "critical", page.url, "robots.txt חוסם את העמוד מפני גוגל"));
    }
  }
  if (site.sitemapStatus !== 200) out.push(issue("sitemap.missing", "high", `${site.origin}/sitemap.xml`, "אין מפת אתר (sitemap.xml) תקינה"));
  else if (site.sitemapUrls.length === 0) out.push(issue("sitemap.empty", "high", `${site.origin}/sitemap.xml`, "מפת האתר ריקה"));

  // duplicates across pages (only 200 pages that are meant to be indexed)
  const indexable = pages.filter((p) => p.page.status === 200 && p.signals && !noindex(p.page, p.signals));
  const dup = (pick: (s: PageSignals) => string | undefined, code: string, severity: Severity, label: string) => {
    const seen = new Map<string, string[]>();
    for (const p of indexable) {
      const v = p.signals ? (pick(p.signals) ?? "").trim() : "";
      if (!v) continue;
      seen.set(v, [...(seen.get(v) ?? []), p.page.url]);
    }
    for (const [value, urls] of seen)
      if (urls.length > 1)
        out.push(issue(code, severity, urls[0] ?? null, `${label} זהה ב-${urls.length} עמודים`, { detail: value, count: urls.length }));
  };
  dup((s) => s.titles[0], "title.duplicate", "high", "כותרת");
  dup((s) => s.metaDescriptions[0], "description.duplicate", "medium", "תיאור");

  // indexable pages missing from the sitemap
  const inMap = new Set(site.sitemapUrls.map((u) => u.replace(/\/$/, "")));
  const missing = indexable.filter((p) => p.page.kind !== "other" && !inMap.has(p.page.url.replace(/\/$/, "")));
  if (site.sitemapStatus === 200 && missing.length > 0)
    out.push(
      issue("sitemap.missing_pages", "medium", null, `${missing.length} עמודים חשובים לא מופיעים במפת האתר`, {
        count: missing.length,
        detail: missing
          .slice(0, 5)
          .map((p) => p.page.url)
          .join(" · "),
      }),
    );
  return out;
}

const DEDUCT: Record<Severity, number> = { critical: 20, high: 8, medium: 3, low: 1, info: 0 };
const CAP_PER_CODE: Record<Severity, number> = { critical: 40, high: 24, medium: 9, low: 3, info: 0 };

/** technical checklist health 0–100 (each issue code counted with a cap, so 50 images don't sink a site) */
export function healthScore(issues: AuditIssue[]): { score: number; counts: Record<Severity, number> } {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const perCode = new Map<string, number>();
  for (const i of issues) {
    counts[i.severity] += 1;
    perCode.set(i.code, Math.min((perCode.get(i.code) ?? 0) + DEDUCT[i.severity], CAP_PER_CODE[i.severity]));
  }
  let lost = 0;
  for (const v of perCode.values()) lost += v;
  return { score: Math.max(0, 100 - lost), counts };
}

export function sortIssues(issues: AuditIssue[]): AuditIssue[] {
  return [...issues].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}
