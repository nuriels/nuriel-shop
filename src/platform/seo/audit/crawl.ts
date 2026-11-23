// NURIEL AI SEO ENGINE — the site audit: robots.txt → sitemap(s) → the home page + a capped sample of pages →
// page rules + site rules → technical health. Takes a Fetcher (fetch.server.ts in production: the business's own
// host only, SSRF-safe; a fake in tests), so this file has no I/O of its own.
import type { Fetcher, FetchedText } from "./fetch.server";
import {
  extractSignals,
  parseRobots,
  parseSitemap,
  type PageSignals,
  type RobotsRules,
} from "./html";
import {
  addressKey,
  auditPage,
  auditSite,
  healthScore,
  landedAt,
  sortIssues,
  type AuditIssue,
  type FetchedPage,
  type PageKind,
  type SiteEngine,
  type Severity,
} from "./rules";

export interface CrawlOptions {
  origin: string;
  engine: SiteEngine;
  /** always audited, in this order (e.g. the home page), before sitemap URLs */
  startPaths: string[];
  maxPages: number;
  kindOf: (path: string) => PageKind;
  timeoutMs?: number;
  concurrency?: number;
  userAgent?: string;
  /** one budget for the whole crawl (default 4 minutes) — well inside the 15-minute job lock, so a slow or
   *  hostile host can never make a second worker pick the same audit up while this one still runs */
  deadlineMs?: number;
}

export const CRAWL_DEADLINE_MS = 4 * 60_000;

export interface PageResult {
  url: string;
  kind: PageKind;
  status: number;
  title: string | null;
  description: string | null;
  h1: string | null;
  issues: AuditIssue[];
}

export interface CrawlResult {
  origin: string;
  startedAt: string;
  finishedAt: string;
  score: number;
  counts: Record<Severity, number>;
  pagesAudited: number;
  sitemapUrls: number;
  robotsStatus: number;
  sitemapStatus: number;
  pages: PageResult[];
  issues: AuditIssue[];
  /** the crawl budget ran out: the pages after that point were not fetched (the result covers the rest) */
  stoppedEarly: boolean;
}

async function safeGet(
  fetcher: Fetcher,
  url: string,
  timeoutMs: number,
  userAgent: string,
): Promise<FetchedText> {
  try {
    return await fetcher(url, { timeoutMs, userAgent });
  } catch {
    return { status: 0, headers: {}, body: null, finalUrl: null };
  }
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      const item = items[i];
      if (item !== undefined) out[i] = await fn(item);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function crawlSite(opts: CrawlOptions, fetcher: Fetcher): Promise<CrawlResult> {
  const startedAt = new Date().toISOString();
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const userAgent = opts.userAgent ?? "NurielSEOAudit/1.0";
  const origin = opts.origin.replace(/\/$/, "");
  const host = new URL(origin).host;
  const deadline = Date.now() + (opts.deadlineMs ?? CRAWL_DEADLINE_MS);
  let stoppedEarly = false;
  const timeLeft = () => {
    if (Date.now() < deadline) return true;
    stoppedEarly = true;
    return false;
  };

  const robotsRes = await safeGet(fetcher, `${origin}/robots.txt`, timeoutMs, userAgent);
  const robots: RobotsRules | null =
    robotsRes.status === 200 && robotsRes.body ? parseRobots(robotsRes.body) : null;

  // sitemaps: the ones robots.txt declares (same host), else /sitemap.xml; one level of sitemap index, at most 5 files
  const declared = (robots?.sitemaps ?? []).filter((u) => {
    try {
      return new URL(u).host === host;
    } catch {
      return false;
    }
  });
  const queue = declared.length > 0 ? declared : [`${origin}/sitemap.xml`];
  const sitemapUrls: string[] = [];
  let sitemapStatus = 0;
  const seenMaps = new Set<string>();
  while (queue.length > 0 && seenMaps.size < 5 && timeLeft()) {
    const mapUrl = queue.shift();
    if (!mapUrl || seenMaps.has(mapUrl)) continue;
    seenMaps.add(mapUrl);
    const r = await safeGet(fetcher, mapUrl, timeoutMs, userAgent);
    if (sitemapStatus !== 200) sitemapStatus = r.status;
    if (r.status !== 200 || !r.body) continue;
    const parsed = parseSitemap(r.body);
    for (const u of parsed.urls) {
      try {
        if (new URL(u).host === host) sitemapUrls.push(u);
      } catch {
        /* skip */
      }
    }
    for (const s of parsed.sitemaps) queue.push(s);
  }

  // the pages to audit: start paths first, then the sitemap, deduplicated, capped
  const inSitemap = new Set(sitemapUrls.map((u) => u.replace(/\/$/, "")));
  const targets: string[] = [];
  const add = (u: string) => {
    const clean = u.replace(/#.*$/, "");
    if (!targets.includes(clean) && targets.length < opts.maxPages) targets.push(clean);
  };
  for (const p of opts.startPaths) add(new URL(p, origin + "/").toString());
  for (const u of sitemapUrls) add(u);

  const results = await pool(targets, opts.concurrency ?? 3, async (url) => {
    if (!timeLeft()) return null; // out of budget: not fetched, not reported as broken
    const r = await safeGet(fetcher, url, timeoutMs, userAgent);
    const path = new URL(url).pathname;
    const page: FetchedPage = {
      url,
      status: r.status,
      headers: r.headers,
      html: r.body,
      kind: opts.kindOf(path),
      inSitemap: inSitemap.has(url.replace(/\/$/, "")),
      finalUrl: r.finalUrl,
    };
    const isHtml = (r.headers["content-type"] ?? "").includes("html");
    const signals: PageSignals | null =
      r.status === 200 && r.body && isHtml ? extractSignals(r.body) : null;
    return { page, signals };
  });
  const fetched = onePagePerAddress(
    results.filter((x): x is NonNullable<typeof x> => x !== null),
    { host, inSitemap, kindOf: opts.kindOf },
  );

  const ctx = { origin, engine: opts.engine, hebrew: true };
  const pages: PageResult[] = fetched.map(({ page, signals }) => ({
    url: page.url,
    kind: page.kind,
    status: page.status,
    title: signals?.titles[0] ?? null,
    description: signals?.metaDescriptions[0] ?? null,
    h1: signals?.headings.find((h) => h.level === 1)?.text ?? null,
    issues: auditPage(page, signals, ctx),
  }));
  const siteIssues = auditSite(fetched, {
    origin,
    robotsStatus: robotsRes.status,
    robots,
    sitemapStatus,
    sitemapUrls,
  });
  const issues = sortIssues([...pages.flatMap((p) => p.issues), ...siteIssues]);
  const { score, counts } = healthScore(issues);
  return {
    origin,
    startedAt,
    finishedAt: new Date().toISOString(),
    score,
    counts,
    pagesAudited: pages.length,
    sitemapUrls: sitemapUrls.length,
    robotsStatus: robotsRes.status,
    sitemapStatus,
    pages,
    issues,
    stoppedEarly,
  };
}

/**
 * One page per address. A start path that redirects (a zimmer site's "/" → "/stay") IS the page it lands on:
 * when that page was fetched too (it is in the sitemap) the start path is dropped, otherwise it is reported under
 * the address it lands on. Before this, "/" and "/stay" were two pages with "the same title and description" and
 * "/" was "missing from the sitemap" — three findings nobody could fix, because there was nothing to fix.
 * Sitemap URLs that redirect are kept: "a sitemap URL redirects" is a real finding of its own.
 */
export function onePagePerAddress<T extends { page: FetchedPage }>(
  fetched: T[],
  site: { host: string; inSitemap: Set<string>; kindOf: (path: string) => PageKind },
): T[] {
  const direct = new Set(
    fetched.filter((f) => !landedAt(f.page)).map((f) => addressKey(f.page.url)),
  );
  const out: T[] = [];
  for (const f of fetched) {
    const to = landedAt(f.page);
    if (!to || f.page.inSitemap) {
      out.push(f);
      continue;
    }
    let target: URL;
    try {
      target = new URL(to);
    } catch {
      out.push(f);
      continue;
    }
    if (target.host !== site.host) {
      out.push(f);
      continue;
    }
    if (direct.has(addressKey(to))) continue;
    out.push({
      ...f,
      page: {
        ...f.page,
        url: to,
        kind: site.kindOf(target.pathname),
        inSitemap: site.inSitemap.has(addressKey(to)),
        finalUrl: null,
      },
    });
    direct.add(addressKey(to));
  }
  return out;
}

/** how a URL path maps to a page kind, per engine (used by the crawler and the reports) */
export function kindOfPath(engine: SiteEngine, path: string): PageKind {
  const p = path.replace(/\/+$/, "") || "/";
  if (engine === "hospitality") {
    if (p === "/stay" || p === "/") return "home";
    if (p.startsWith("/stay/units/")) return "unit";
    if (p.startsWith("/stay/packages/")) return "package";
    if (/^\/stay\/(book|my|manage|booking)/.test(p)) return "other";
    if (p.startsWith("/stay/")) return "content";
    return "other";
  }
  if (engine === "ecommerce") {
    if (p === "/") return "home";
    if (p.startsWith("/product/") || p.startsWith("/products/")) return "product";
    if (p.startsWith("/category/") || p.startsWith("/categories/") || p.startsWith("/c/"))
      return "category";
    if (/^\/(cart|checkout|account|login|admin|orders|search)/.test(p)) return "other";
    return "content";
  }
  return p === "/" ? "home" : "content";
}
