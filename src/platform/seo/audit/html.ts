// NURIEL AI SEO ENGINE — page signals from rendered HTML (what Googlebot receives from our SSR).
// No DOM library in the project (and no new packages): a small, strict tokenizer for exactly the elements an SEO
// audit needs — title, meta, canonical, robots, headings, images, links, JSON-LD, html lang/dir, hreflang, text.
// Pure and synchronous: no network, no I/O. The crawler (crawl.server.ts) feeds it; unit tests cover it.

export interface PageImage {
  src: string;
  alt: string | null;
  hasAlt: boolean;
  width: string | null;
  height: string | null;
  loading: string | null;
}

export interface PageLink {
  href: string;
  text: string;
  rel: string | null;
}

export interface JsonLdBlock {
  raw: string;
  parsed: unknown;
  error: string | null;
  /** every @type found anywhere in the block (incl. @graph and nested objects) */
  types: string[];
}

export interface PageSignals {
  lang: string | null;
  dir: string | null;
  titles: string[];
  metaDescriptions: string[];
  metaRobots: string[];
  canonicals: string[];
  viewport: string | null;
  charset: boolean;
  og: Record<string, string>;
  headings: { level: number; text: string }[];
  images: PageImage[];
  links: PageLink[];
  jsonLd: JsonLdBlock[];
  hreflang: { lang: string; href: string }[];
  wordCount: number;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rlm: "",
  lrm: "",
  shy: "",
  hellip: "…",
  ndash: "–",
  mdash: "—",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      if (code === 0x200f || code === 0x200e) return ""; // RLM / LRM — invisible in a result
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    const named = ENTITIES[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

/** collapse whitespace and drop the invisible direction marks the storefront uses around prices */
export function cleanText(input: string): string {
  return decodeEntities(input)
    .replace(/[‎‏‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const ATTR_RE = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

export function parseAttributes(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(source)) !== null) {
    const name = (m[1] ?? "").toLowerCase();
    if (!name || name in out) continue;
    out[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

const attr = (a: Record<string, string>, k: string): string | null => (k in a ? (a[k] ?? "") : null);

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

/** the HTML with comments and the bodies of non-content elements removed (scripts kept separately) */
function withoutNoise(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, " ");
}

function collectTypes(value: unknown, into: Set<string>, depth = 0): void {
  if (depth > 12 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const v of value) collectTypes(v, into, depth + 1);
    return;
  }
  const obj = value as Record<string, unknown>;
  const t = obj["@type"];
  if (typeof t === "string") into.add(t);
  else if (Array.isArray(t)) for (const x of t) if (typeof x === "string") into.add(x);
  for (const v of Object.values(obj)) collectTypes(v, into, depth + 1);
}

export function extractSignals(html: string): PageSignals {
  const signals: PageSignals = {
    lang: null,
    dir: null,
    titles: [],
    metaDescriptions: [],
    metaRobots: [],
    canonicals: [],
    viewport: null,
    charset: false,
    og: {},
    headings: [],
    images: [],
    links: [],
    jsonLd: [],
    hreflang: [],
    wordCount: 0,
  };
  const source = html.replace(/<!--[\s\S]*?-->/g, " ");

  // JSON-LD before stripping scripts
  for (const m of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const a = parseAttributes(m[1] ?? "");
    if ((attr(a, "type") ?? "").trim().toLowerCase() !== "application/ld+json") continue;
    const raw = (m[2] ?? "").trim();
    let parsed: unknown = null;
    let error: string | null = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      error = e instanceof Error ? e.message.slice(0, 160) : "invalid JSON";
    }
    const types = new Set<string>();
    collectTypes(parsed, types);
    signals.jsonLd.push({ raw: raw.slice(0, 20_000), parsed, error, types: [...types] });
  }

  const content = withoutNoise(source);

  const htmlTag = /<html\b([^>]*)>/i.exec(content);
  if (htmlTag) {
    const a = parseAttributes(htmlTag[1] ?? "");
    signals.lang = attr(a, "lang");
    signals.dir = attr(a, "dir");
  }

  for (const m of content.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/gi)) signals.titles.push(cleanText(m[1] ?? ""));

  for (const m of content.matchAll(/<meta\b([^>]*)>/gi)) {
    const a = parseAttributes(m[1] ?? "");
    const name = (attr(a, "name") ?? "").toLowerCase();
    const property = (attr(a, "property") ?? "").toLowerCase();
    const value = cleanText(attr(a, "content") ?? "");
    if (attr(a, "charset") !== null) signals.charset = true;
    if ((attr(a, "http-equiv") ?? "").toLowerCase() === "content-type" && /utf-?8/i.test(value)) signals.charset = true;
    if (name === "description") signals.metaDescriptions.push(value);
    else if (name === "robots" || name === "googlebot") signals.metaRobots.push(value.toLowerCase());
    else if (name === "viewport") signals.viewport = value;
    if (property.startsWith("og:")) signals.og[property] = value;
    else if (name.startsWith("twitter:")) signals.og[name] = value;
  }

  for (const m of content.matchAll(/<link\b([^>]*)>/gi)) {
    const a = parseAttributes(m[1] ?? "");
    const rel = (attr(a, "rel") ?? "").toLowerCase().split(/\s+/);
    const href = (attr(a, "href") ?? "").trim();
    if (rel.includes("canonical")) signals.canonicals.push(href);
    if (rel.includes("alternate") && attr(a, "hreflang") !== null)
      signals.hreflang.push({ lang: (attr(a, "hreflang") ?? "").toLowerCase(), href });
  }

  for (const m of content.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)) {
    signals.headings.push({ level: Number(m[1]), text: cleanText(stripTags(m[2] ?? "")) });
  }

  for (const m of content.matchAll(/<img\b([^>]*)>/gi)) {
    const a = parseAttributes(m[1] ?? "");
    const alt = attr(a, "alt");
    signals.images.push({
      src: (attr(a, "src") ?? attr(a, "data-src") ?? "").trim(),
      alt: alt === null ? null : cleanText(alt),
      hasAlt: alt !== null,
      width: attr(a, "width"),
      height: attr(a, "height"),
      loading: attr(a, "loading"),
    });
  }

  for (const m of content.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const a = parseAttributes(m[1] ?? "");
    const href = (attr(a, "href") ?? "").trim();
    if (!href) continue;
    const aria = attr(a, "aria-label");
    signals.links.push({ href, text: cleanText(stripTags(m[2] ?? "")) || cleanText(aria ?? ""), rel: attr(a, "rel") });
  }

  const body = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(content);
  const text = cleanText(stripTags(body ? (body[1] ?? "") : content));
  signals.wordCount = text ? text.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;
  return signals;
}

/** robots.txt → the rules that apply to Googlebot (or *), and the declared sitemaps */
export interface RobotsRules {
  disallow: string[];
  allow: string[];
  sitemaps: string[];
}

export function parseRobots(text: string): RobotsRules {
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  const sitemaps: string[] = [];
  let current: { agents: string[]; allow: string[]; disallow: string[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "disallow" && value) current.disallow.push(value);
    if (key === "allow" && value) current.allow.push(value);
  }
  const pick =
    groups.find((g) => g.agents.some((a) => a === "googlebot")) ?? groups.find((g) => g.agents.includes("*"));
  return { disallow: pick?.disallow ?? [], allow: pick?.allow ?? [], sitemaps };
}

function ruleMatches(rule: string, path: string): number {
  // Google semantics: prefix match, '*' wildcard, '$' end anchor; the longest matching rule wins
  const anchored = rule.endsWith("$");
  const body = anchored ? rule.slice(0, -1) : rule;
  const re = new RegExp(
    "^" + body.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""),
  );
  return re.test(path) ? body.length : -1;
}

export function isPathAllowed(rules: RobotsRules, path: string): boolean {
  let best = -1;
  let allowed = true;
  for (const r of rules.disallow) {
    const n = ruleMatches(r, path);
    if (n > best) {
      best = n;
      allowed = false;
    }
  }
  for (const r of rules.allow) {
    const n = ruleMatches(r, path);
    if (n >= best && n >= 0) {
      best = n;
      allowed = true;
    }
  }
  return allowed;
}

/** sitemap.xml / sitemap index → the <loc> URLs (index entries are marked) */
export function parseSitemap(xml: string): { urls: string[]; sitemaps: string[] } {
  const urls: string[] = [];
  const sitemaps: string[] = [];
  const isIndex = /<sitemapindex\b/i.test(xml);
  for (const m of xml.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/gi)) {
    const loc = decodeEntities((m[1] ?? "").replace(/^<!\[CDATA\[|\]\]>$/g, "")).trim();
    if (!loc) continue;
    (isIndex ? sitemaps : urls).push(loc);
  }
  return { urls, sitemaps };
}
