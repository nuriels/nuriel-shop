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
  /** words of the page's own content: inside <main> when there is one, else the body without its header, nav,
   *  footer and aside — the menu and the footer repeat on every page and are not the page's content */
  mainWordCount: number;
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
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
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

const attr = (a: Record<string, string>, k: string): string | null =>
  k in a ? (a[k] ?? "") : null;

// ---------------------------------------------------------------- linear-time scanning
// The pages, robots.txt and sitemaps come from the business's own address, and a business with its own domain
// controls what that address serves. So no scan here may backtrack over the page: every helper below is
// O(length of the input) whatever the markup — unclosed tags, runs of '<', unclosed comments, a robots rule full
// of '*'. Regexes run only on bounded pieces (the attributes of one tag, which stop at the next '<' or '>').

const isSpace = (c: number) => c === 32 || (c >= 9 && c <= 13);

/** a closing tag `</tag` + optional whitespace + `>` starting exactly at `i` (tag in lower case, ASCII
 *  case-insensitive): where it ends, or -1. The whitespace run belongs to this one "</", so scans stay linear */
function closeAt(src: string, i: number, tag: string): number {
  let k = i + 2;
  for (let c = 0; c < tag.length; c += 1, k += 1) {
    let ch = src.charCodeAt(k);
    if (ch >= 65 && ch <= 90) ch += 32;
    if (ch !== tag.charCodeAt(c)) return -1;
  }
  while (k < src.length && isSpace(src.charCodeAt(k))) k += 1;
  return src.charCodeAt(k) === 62 ? k + 1 : -1;
}

/** the first `</tag …>` at or after `from`, or null if there is none */
function findClose(src: string, tag: string, from: number): { start: number; end: number } | null {
  for (let i = src.indexOf("</", from); i !== -1; i = src.indexOf("</", i + 2)) {
    const end = closeAt(src, i, tag);
    if (end !== -1) return { start: i, end };
  }
  return null;
}

/** where the LAST `</tag …>` at or after `from` starts, or -1 (the body: the old greedy match ended there) */
function findLastClose(src: string, tag: string, from: number): number {
  for (let i = src.lastIndexOf("</"); i >= from; i = i === 0 ? -1 : src.lastIndexOf("</", i - 1)) {
    if (closeAt(src, i, tag) !== -1) return i;
  }
  return -1;
}

/** an opening tag `<name …>`: its attributes stop at the next '<' or '>' — so a scan never runs past them */
const openTag = (name: string, flags = "gi") => new RegExp(`<${name}(?=[\\s/>])([^<>]*)>`, flags);

/** each `<name …>…</name>` in order. An opening tag without a closing one ends the scan: no later one has a
 *  closing tag either (the old lazy regex rescanned to the end for every one of them) */
function* pairedTags(src: string, name: string): Generator<{ attrs: string; inner: string }> {
  const re = openTag(name);
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const close = findClose(src, name, re.lastIndex);
    if (!close) return;
    yield { attrs: m[1] ?? "", inner: src.slice(re.lastIndex, close.start) };
    re.lastIndex = close.end;
  }
}

function stripTags(html: string): string {
  return html.replace(/<[^<>]*>/g, " ");
}

/** comments removed; an unclosed comment runs to the end of the document, as in a browser */
function stripComments(html: string): string {
  const parts: string[] = [];
  let i = 0;
  for (;;) {
    const s = html.indexOf("<!--", i);
    if (s === -1) {
      parts.push(html.slice(i));
      break;
    }
    parts.push(html.slice(i, s), " ");
    const e = html.indexOf("-->", s + 4);
    if (e === -1) break;
    i = e + 3;
  }
  return parts.join("");
}

/** the HTML with comments and the bodies of non-content elements removed (scripts kept separately). An unclosed
 *  script / style / … runs to the end (raw text in a browser); `<svg … />` is complete on its own */
function withoutNoise(html: string): string {
  const src = stripComments(html);
  const re = /<(script|style|noscript|template|svg)(?=[\s/>])([^<>]*)>/gi;
  const parts: string[] = [];
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    parts.push(src.slice(i, m.index), " ");
    const name = (m[1] ?? "").toLowerCase();
    if (name === "svg" && (m[2] ?? "").trimEnd().endsWith("/")) {
      i = re.lastIndex;
      continue;
    }
    const close = findClose(src, name, re.lastIndex);
    if (!close) return parts.join("");
    i = close.end;
    re.lastIndex = close.end;
  }
  parts.push(src.slice(i));
  return parts.join("");
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
    mainWordCount: 0,
  };
  const source = stripComments(html);

  // JSON-LD before stripping scripts
  for (const script of pairedTags(source, "script")) {
    const a = parseAttributes(script.attrs);
    if ((attr(a, "type") ?? "").trim().toLowerCase() !== "application/ld+json") continue;
    const raw = script.inner.trim();
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

  const htmlTag = openTag("html", "i").exec(content);
  if (htmlTag) {
    const a = parseAttributes(htmlTag[1] ?? "");
    signals.lang = attr(a, "lang");
    signals.dir = attr(a, "dir");
  }

  for (const title of pairedTags(content, "title")) signals.titles.push(cleanText(title.inner));

  for (const m of content.matchAll(openTag("meta"))) {
    const a = parseAttributes(m[1] ?? "");
    const name = (attr(a, "name") ?? "").toLowerCase();
    const property = (attr(a, "property") ?? "").toLowerCase();
    const value = cleanText(attr(a, "content") ?? "");
    if (attr(a, "charset") !== null) signals.charset = true;
    if ((attr(a, "http-equiv") ?? "").toLowerCase() === "content-type" && /utf-?8/i.test(value))
      signals.charset = true;
    if (name === "description") signals.metaDescriptions.push(value);
    else if (name === "robots" || name === "googlebot")
      signals.metaRobots.push(value.toLowerCase());
    else if (name === "viewport") signals.viewport = value;
    if (property.startsWith("og:")) signals.og[property] = value;
    else if (name.startsWith("twitter:")) signals.og[name] = value;
  }

  for (const m of content.matchAll(openTag("link"))) {
    const a = parseAttributes(m[1] ?? "");
    const rel = (attr(a, "rel") ?? "").toLowerCase().split(/\s+/);
    const href = (attr(a, "href") ?? "").trim();
    if (rel.includes("canonical")) signals.canonicals.push(href);
    if (rel.includes("alternate") && attr(a, "hreflang") !== null)
      signals.hreflang.push({ lang: (attr(a, "hreflang") ?? "").toLowerCase(), href });
  }

  // headings in document order; a level with no closing tag left is skipped from then on (each level fails at
  // most once — no rescans to the end of the page)
  const headingRe = /<h([1-6])(?=[\s/>])[^<>]*>/gi;
  const noCloseLeft = new Set<string>();
  let hm: RegExpExecArray | null;
  while ((hm = headingRe.exec(content)) !== null) {
    const level = hm[1] ?? "1";
    if (noCloseLeft.has(level)) continue;
    const close = findClose(content, `h${level}`, headingRe.lastIndex);
    if (!close) {
      noCloseLeft.add(level);
      continue;
    }
    const inner = content.slice(headingRe.lastIndex, close.start);
    signals.headings.push({ level: Number(level), text: cleanText(stripTags(inner)) });
    headingRe.lastIndex = close.end;
  }

  for (const m of content.matchAll(openTag("img"))) {
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

  for (const link of pairedTags(content, "a")) {
    const a = parseAttributes(link.attrs);
    const href = (attr(a, "href") ?? "").trim();
    if (!href) continue;
    const aria = attr(a, "aria-label");
    signals.links.push({
      href,
      text: cleanText(stripTags(link.inner)) || cleanText(aria ?? ""),
      rel: attr(a, "rel"),
    });
  }

  // the text of the body: from the first <body …> to the last </body> (no body element → the whole page)
  const bodyOpen = openTag("body", "i").exec(content);
  const bodyFrom = bodyOpen ? bodyOpen.index + bodyOpen[0].length : -1;
  const bodyTo = bodyOpen ? findLastClose(content, "body", bodyFrom) : -1;
  const body = bodyTo === -1 ? content : content.slice(bodyFrom, bodyTo);
  signals.wordCount = countWords(cleanText(stripTags(body)));
  const main = pairedTags(body, "main").next();
  signals.mainWordCount = countWords(
    cleanText(stripTags(main.done ? withoutChrome(body) : main.value.inner)),
  );
  return signals;
}

const countWords = (text: string) =>
  text ? text.split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).length : 0;

/** the body without the parts every page repeats (header, nav, footer, aside) */
function withoutChrome(html: string): string {
  const re = /<(header|nav|footer|aside)(?=[\s/>])[^<>]*>/gi;
  const parts: string[] = [];
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const close = findClose(html, (m[1] ?? "").toLowerCase(), re.lastIndex);
    if (!close) break;
    parts.push(html.slice(i, m.index), " ");
    i = close.end;
    re.lastIndex = close.end;
  }
  parts.push(html.slice(i));
  return parts.join("");
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
    if (!current || !value || value.length > ROBOTS_MAX_RULE_LENGTH) continue;
    if (current.disallow.length + current.allow.length >= ROBOTS_MAX_RULES) continue;
    if (key === "disallow") current.disallow.push(value);
    if (key === "allow") current.allow.push(value);
  }
  const pick =
    groups.find((g) => g.agents.some((a) => a === "googlebot")) ??
    groups.find((g) => g.agents.includes("*"));
  return { disallow: pick?.disallow ?? [], allow: pick?.allow ?? [], sitemaps };
}

/** robots.txt limits for what we evaluate: a longer rule, or more rules than this, is not a real site's */
export const ROBOTS_MAX_RULE_LENGTH = 512;
export const ROBOTS_MAX_RULES = 1000;

function ruleMatches(rule: string, path: string): number {
  // Google semantics: prefix match, '*' wildcard, '$' end anchor; the longest matching rule wins.
  // No regex: the parts between the '*'s are found in order, each at its leftmost place after the previous one
  // (for '*'-only patterns that finds a match whenever there is one) — linear, whatever the site writes.
  const anchored = rule.endsWith("$");
  const body = anchored ? rule.slice(0, -1) : rule;
  const parts = body.split("*");
  const first = parts[0] ?? "";
  if (!path.startsWith(first)) return -1;
  if (parts.length === 1) return !anchored || path.length === first.length ? body.length : -1;
  let pos = first.length;
  for (let k = 1; k < parts.length - 1; k += 1) {
    const part = parts[k] ?? "";
    if (!part) continue;
    const at = path.indexOf(part, pos);
    if (at === -1) return -1;
    pos = at + part.length;
  }
  const last = parts[parts.length - 1] ?? "";
  if (anchored) return path.endsWith(last) && path.length - last.length >= pos ? body.length : -1;
  return last === "" || path.indexOf(last, pos) !== -1 ? body.length : -1;
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
  // linear: each <loc> is paired with the next </loc>; an unclosed one ends the scan. At most 50,000 entries
  // (the sitemap protocol's own limit per file)
  const open = /<loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = open.exec(xml)) !== null && urls.length + sitemaps.length < 50_000) {
    const close = findClose(xml, "loc", open.lastIndex);
    if (!close) break;
    const inner = xml.slice(open.lastIndex, close.start).trim();
    open.lastIndex = close.end;
    const loc = decodeEntities(inner.replace(/^<!\[CDATA\[|\]\]>$/g, "")).trim();
    if (!loc) continue;
    (isIndex ? sitemaps : urls).push(loc);
  }
  return { urls, sitemaps };
}
