// נירמול מסמך האתר — לא זורק אף פעם: קלט פגום (ממסד, מייבוא, מדפדפן) הופך למסמך תקין שאפשר להציג.
// רץ בכל קריאה (האתר הציבורי, ממשק הניהול) ולפני כל שמירה (השרת שומר רק את התוצאה).
import { isBlockType, normalizeBlockProps } from "./blocks";
import {
  business as businessSchema,
  collections as collectionsSchema,
  DEFAULT_LOCALE,
  DOCUMENT_SCHEMA_VERSION,
  ENABLED_LOCALES,
  localized,
  MAX_BLOCKS_PER_PAGE,
  MAX_PAGES,
  PAGE_SLUG,
  pageSeo,
  rawBlock,
  TEMPLATE_KEYS,
  theme as themeSchema,
  type Block,
  type JsonValue,
  type Locale,
  type Page,
  type SiteDocument,
  type TemplateKey,
} from "./schema";

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const isTemplateKey = (v: unknown): v is TemplateKey =>
  typeof v === "string" && (TEMPLATE_KEYS as readonly string[]).includes(v);
const isEnabledLocale = (v: unknown): v is Locale =>
  typeof v === "string" && (ENABLED_LOCALES as readonly string[]).includes(v);

function normalizeBlocks(input: unknown): Block[] {
  const seen = new Set<string>();
  const out: Block[] = [];
  for (const raw of Array.isArray(input) ? input : []) {
    const parsed = rawBlock.safeParse(raw);
    if (!parsed.success || !isBlockType(parsed.data.type) || seen.has(parsed.data.id)) continue;
    seen.add(parsed.data.id);
    out.push({
      id: parsed.data.id,
      type: parsed.data.type,
      v: parsed.data.v,
      hidden: parsed.data.hidden,
      props: normalizeBlockProps(parsed.data.type, parsed.data.props) as unknown as Record<
        string,
        JsonValue
      >,
    });
    if (out.length >= MAX_BLOCKS_PER_PAGE) break;
  }
  return out;
}

function normalizePages(input: unknown): Page[] {
  const pages: Page[] = [];
  const slugs = new Set<string>();
  const ids = new Set<string>();
  for (const raw of Array.isArray(input) ? input : []) {
    const p = obj(raw);
    const id =
      typeof p["id"] === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(p["id"]) ? p["id"] : null;
    const slug = typeof p["slug"] === "string" && PAGE_SLUG.test(p["slug"]) ? p["slug"] : null;
    if (!id || slug === null || ids.has(id) || slugs.has(slug)) continue;
    ids.add(id);
    slugs.add(slug);
    pages.push({
      id,
      slug,
      title: localized(120).parse(p["title"]),
      seo: pageSeo.parse(p["seo"]),
      blocks: normalizeBlocks(p["blocks"]),
    });
    if (pages.length >= MAX_PAGES) break;
  }
  // תמיד יש דף בית (slug ריק), והוא הראשון
  if (!slugs.has(""))
    pages.unshift({
      id: "home",
      slug: "",
      title: { he: "" },
      seo: pageSeo.parse(null),
      blocks: [],
    });
  pages.sort((a, b) => (a.slug === "" ? -1 : b.slug === "" ? 1 : 0));
  return pages;
}

export function normalizeDocument(input: unknown): SiteDocument {
  const d = obj(input);
  const locales = (Array.isArray(d["locales"]) ? d["locales"] : []).filter(isEnabledLocale);
  const uniqueLocales = [...new Set(locales)];
  return {
    schema: DOCUMENT_SCHEMA_VERSION,
    template: isTemplateKey(d["template"]) ? d["template"] : "elegant",
    locales: uniqueLocales.length ? uniqueLocales : [DEFAULT_LOCALE],
    defaultLocale: isEnabledLocale(d["defaultLocale"]) ? d["defaultLocale"] : DEFAULT_LOCALE,
    theme: themeSchema.parse(d["theme"]),
    business: businessSchema.parse(d["business"]),
    collections: collectionsSchema.parse(d["collections"]),
    pages: normalizePages(d["pages"]),
  };
}

/** טקסט בשפה המבוקשת, ואם חסר — בעברית */
export function tx(
  text: { he: string; en?: string | undefined } | undefined,
  locale: Locale = "he",
): string {
  if (!text) return "";
  const value = locale === "en" ? text.en : text.he;
  return (value ?? "").trim() || text.he.trim();
}

/** העמוד לפי הכתובת ("" = דף הבית); null — אין עמוד כזה */
export function pageBySlug(doc: SiteDocument, slug: string): Page | null {
  return doc.pages.find((p) => p["slug"] === slug) ?? null;
}

/** מזהי המדיה שהמסמך משתמש בהם (לטעינת הכתובות בשרת) */
export function mediaIdsOf(doc: SiteDocument): string[] {
  const ids = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o["media"] === "string") ids.add(o["media"]);
      Object.values(o).forEach(walk);
    }
  };
  walk(doc);
  return [...ids];
}
