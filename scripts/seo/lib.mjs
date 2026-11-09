// ============================================================
// Snapshot של SEO — פונקציות טהורות (בלי רשת): robots.txt, sitemap, ה-head של דף, והשוואה בין
// שני צילומים. משמש את scripts/seo/snapshot.mjs ואת scripts/seo/compare.mjs, ונבדק ב-
// tests/unit/seo-snapshot.test.ts. קריאה בלבד: שום פונקציה כאן לא כותבת לשום מקום.
// ============================================================
import { createHash } from "node:crypto";

const decode = (s) =>
  String(s ?? "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** robots.txt → קבוצות (user-agent + כללים) ושורות Sitemap */
export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "sitemap") sitemaps.push(value);
    else if ((key === "allow" || key === "disallow") && current && value !== "")
      current.rules.push({ allow: key === "allow", pattern: value });
  }
  return { groups, sitemaps };
}

function patternRegex(pattern) {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/**
 * האם הכתובת מותרת לסורק — לפי הכללים של Google: הקבוצה של הסורק אם יש, אחרת "*";
 * הכלל הארוך ביותר שתואם קובע, ובשוויון — Allow. נתיב בלי כלל תואם — מותר.
 */
export function robotsAllows(robots, pathWithQuery, agent = "googlebot") {
  const groups = robots?.groups ?? [];
  const own = groups.filter((g) =>
    g.agents.some((a) => a !== "*" && agent.toLowerCase().startsWith(a)),
  );
  const rules = (own.length ? own : groups.filter((g) => g.agents.includes("*"))).flatMap(
    (g) => g.rules,
  );
  let best = null;
  for (const rule of rules) {
    if (!patternRegex(rule.pattern).test(pathWithQuery)) continue;
    const len = rule.pattern.length;
    if (!best || len > best.len || (len === best.len && rule.allow))
      best = { len, allow: rule.allow };
  }
  return best ? best.allow : true;
}

/** sitemap.xml → [{ loc, lastmod }] לפי סדר הופעה */
export function parseSitemap(xml) {
  const out = [];
  for (const m of String(xml ?? "").matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = m[1].match(/<loc>\s*([^<]+?)\s*<\/loc>/);
    if (!loc) continue;
    const lastmod = m[1].match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/);
    out.push({ loc: decode(loc[1]), lastmod: lastmod ? lastmod[1] : null });
  }
  return out;
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? "") : null;
};

const sha256 = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

const sortKeys = (v) =>
  Array.isArray(v)
    ? v.map(sortKeys)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sortKeys(v[k])]),
        )
      : v;

/** ה-head של דף HTML: מה שגוגל קורא, בלי התוכן עצמו */
export function parseHead(html) {
  const s = String(html ?? "");
  const metas = {};
  for (const tag of s.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attr(tag, "name") ?? attr(tag, "property") ?? "").toLowerCase();
    if (key && !(key in metas)) metas[key] = attr(tag, "content");
  }
  const links = (s.match(/<link\b[^>]*>/gi) ?? []).map((tag) => ({
    rel: (attr(tag, "rel") ?? "").toLowerCase(),
    href: attr(tag, "href"),
    hreflang: attr(tag, "hreflang"),
  }));
  const jsonld = [];
  for (const m of s.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/application\/ld\+json/i.test(m[1])) continue;
    try {
      const data = JSON.parse(m[2]);
      const nodes = [data]
        .flat()
        .flatMap((d) => (d && Array.isArray(d["@graph"]) ? d["@graph"] : [d]));
      jsonld.push({
        types: nodes.map((n) => [n?.["@type"]].flat().join("+")),
        sha256: sha256(JSON.stringify(sortKeys(data))),
      });
    } catch {
      jsonld.push({ types: ["INVALID_JSON"], sha256: sha256(m[2]) });
    }
  }
  const title = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const htmlTag = (s.match(/<html\b[^>]*>/i) ?? [""])[0];
  const relHref = (rel) => links.find((l) => l.rel === rel)?.href ?? null;
  return {
    title: title ? decode(title[1].trim()) : null,
    lang: attr(htmlTag, "lang"),
    description: metas["description"] ?? null,
    robots: metas["robots"] ?? null,
    googlebot: metas["googlebot"] ?? null,
    canonical: relHref("canonical"),
    ogUrl: metas["og:url"] ?? null,
    ogImage: metas["og:image"] ?? null,
    twitterCard: metas["twitter:card"] ?? null,
    googleVerification: metas["google-site-verification"] ?? null,
    hreflang: links
      .filter((l) => l.rel === "alternate" && l.hreflang)
      .map((l) => `${l.hreflang} ${l.href}`)
      .sort(),
    icons: links
      .filter((l) => /(^|\s)(icon|apple-touch-icon)(\s|$)/.test(l.rel))
      .map((l) => l.href)
      .filter(Boolean),
    manifest: relHref("manifest"),
    jsonld,
    h1: [...s.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) =>
      decode(
        m[1]
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      ),
    ),
    internalLinks: [
      ...new Set([...s.matchAll(/<a\b[^>]*\shref\s*=\s*"(\/[^"#]*)"/gi)].map((m) => decode(m[1]))),
    ].sort(),
  };
}

// ---------- השוואה ----------
const CRITICAL = "CRITICAL";
const WARNING = "WARNING";
const INFO = "INFO";
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * מה השתנה בין שני צילומים. CRITICAL — משהו שעלול להוציא דף מהאינדקס או לשבור אימות
 * (דף שנעלם מה-sitemap, קוד תגובה, noindex, canonical, חסימה ב-robots, קוד אימות, הפניה);
 * WARNING — כותרת / תיאור / Schema / H1; INFO — כל השאר.
 */
export function compareSnapshots(before, after) {
  const out = [];
  const add = (severity, area, key, b, a) =>
    out.push({ severity, area, key, before: b ?? null, after: a ?? null });

  const lines = (t) =>
    String(t ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
  const bRobots = lines(before.robots?.body);
  const aRobots = lines(after.robots?.body);
  for (const l of bRobots)
    if (!aRobots.includes(l)) add(WARNING, "robots.txt", "line removed", l, null);
  for (const l of aRobots)
    if (!bRobots.includes(l)) add(WARNING, "robots.txt", "line added", null, l);
  if (before.robots?.status !== after.robots?.status)
    add(CRITICAL, "robots.txt", "status", before.robots?.status, after.robots?.status);

  if (before.sitemap?.status !== after.sitemap?.status)
    add(CRITICAL, "sitemap", "status", before.sitemap?.status, after.sitemap?.status);
  const bUrls = new Map((before.sitemap?.urls ?? []).map((u) => [u.loc, u]));
  const aUrls = new Map((after.sitemap?.urls ?? []).map((u) => [u.loc, u]));
  for (const [loc] of bUrls)
    if (!aUrls.has(loc)) add(CRITICAL, "sitemap", "url removed", loc, null);
  for (const [loc] of aUrls) if (!bUrls.has(loc)) add(INFO, "sitemap", "url added", null, loc);
  for (const [loc, u] of bUrls)
    if (aUrls.has(loc) && u.lastmod !== aUrls.get(loc).lastmod)
      add(INFO, "sitemap", `lastmod ${loc}`, u.lastmod, aUrls.get(loc).lastmod);

  const bRed = new Map((before.redirects ?? []).map((r) => [r.path, r]));
  for (const r of after.redirects ?? []) {
    const b = bRed.get(r.path);
    if (b && (b.status !== r.status || b.location !== r.location))
      add(
        CRITICAL,
        "redirect",
        r.path,
        `${b.status} ${b.location ?? ""}`.trim(),
        `${r.status} ${r.location ?? ""}`.trim(),
      );
  }

  const aPages = new Map((after.pages ?? []).map((p) => [p.url, p]));
  for (const b of before.pages ?? []) {
    const a = aPages.get(b.url);
    if (!a) {
      add(CRITICAL, "page", `missing ${b.url}`, "captured", null);
      continue;
    }
    const k = (name) => `${name} ${b.url}`;
    if (b.status !== a.status) add(CRITICAL, "page", k("status"), b.status, a.status);
    if (b.location !== a.location) add(CRITICAL, "page", k("location"), b.location, a.location);
    if (b.robotsAllowed !== a.robotsAllowed)
      add(
        a.robotsAllowed ? INFO : CRITICAL,
        "page",
        k("robots.txt verdict"),
        b.robotsAllowed,
        a.robotsAllowed,
      );
    if (!same(b.xRobotsTag, a.xRobotsTag))
      add(CRITICAL, "page", k("x-robots-tag"), b.xRobotsTag, a.xRobotsTag);
    const bh = b.head ?? {};
    const ah = a.head ?? {};
    if (!same(bh.robots, ah.robots))
      add(
        /noindex/i.test(ah.robots ?? "") ? CRITICAL : WARNING,
        "page",
        k("meta robots"),
        bh.robots,
        ah.robots,
      );
    if (!same(bh.canonical, ah.canonical))
      add(CRITICAL, "page", k("canonical"), bh.canonical, ah.canonical);
    if (!same(bh.googleVerification, ah.googleVerification))
      add(
        ah.googleVerification ? INFO : CRITICAL,
        "page",
        k("google-site-verification"),
        bh.googleVerification,
        ah.googleVerification,
      );
    for (const f of ["title", "description", "h1"])
      if (!same(bh[f], ah[f])) add(WARNING, "page", k(f), bh[f], ah[f]);
    if (!same(bh.jsonld, ah.jsonld)) add(WARNING, "page", k("json-ld"), bh.jsonld, ah.jsonld);
    for (const f of ["ogUrl", "ogImage", "twitterCard", "hreflang", "icons", "manifest", "lang"])
      if (!same(bh[f], ah[f])) add(INFO, "page", k(f), bh[f], ah[f]);
  }

  const aAssets = new Map((after.assets ?? []).map((x) => [x.path, x]));
  for (const b of before.assets ?? []) {
    const a = aAssets.get(b.path);
    if (!a) continue;
    if (b.status !== a.status) add(WARNING, "asset", `status ${b.path}`, b.status, a.status);
    if (b.robotsAllowed !== a.robotsAllowed)
      add(INFO, "asset", `robots.txt verdict ${b.path}`, b.robotsAllowed, a.robotsAllowed);
  }

  const rank = { [CRITICAL]: 0, [WARNING]: 1, [INFO]: 2 };
  return out.sort(
    (x, y) =>
      rank[x.severity] - rank[y.severity] ||
      x.area.localeCompare(y.area) ||
      x.key.localeCompare(y.key),
  );
}
