// NURIEL AI SEO ENGINE — Ecommerce: the AI request and the check of its answer (pure — unit-tested). The model
// gets ONLY the store's own published facts (names, categories, the owner's description) and must not add any:
// no prices, discounts, shipping, warranty, materials, sizes, stock or "best / cheapest" claims, no phones, no
// links. Anything that breaks a rule is dropped here — it never becomes a proposal.
import type { StoreProposalItem, StoreSnapshot } from "./store-templates";

export const STORE_AI_BATCH = 12;
export const STORE_AI_MAX_CALLS = 3;
export const STORE_SEO_USAGE_MARK = "seo-writer";

export interface StoreAiRef {
  ref: string;
  kind: "product" | "category";
  id: string;
  needs: ("seo_title" | "seo_description")[];
  line: string;
}

const clean = (s: string | null | undefined, max = 600) =>
  (s ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** the items that still miss a Google title / description, with their facts, as short reference lines */
export function storeAiRefs(snap: StoreSnapshot, limit: number): StoreAiRef[] {
  const out: StoreAiRef[] = [];
  let p = 0;
  let c = 0;
  for (const cat of snap.categories) {
    if (out.length >= limit) break;
    const needs = [
      ...(!clean(cat.seo_title) ? (["seo_title"] as const) : []),
      ...(!clean(cat.seo_description) ? (["seo_description"] as const) : []),
    ];
    if (!needs.length || cat.products === 0) continue;
    c += 1;
    out.push({
      ref: `c${c}`,
      kind: "category",
      id: cat.id,
      needs: [...needs],
      line: `c${c} | קטגוריה | שם: ${clean(cat.name, 80)} | מוצרים לדוגמה: ${(cat.top ?? []).map((x) => clean(x, 60)).join(", ") || "—"}`,
    });
  }
  for (const prod of snap.products) {
    if (out.length >= limit) break;
    const needs = [
      ...(!clean(prod.seo_title) ? (["seo_title"] as const) : []),
      ...(!clean(prod.seo_description) ? (["seo_description"] as const) : []),
    ];
    if (!needs.length) continue;
    p += 1;
    out.push({
      ref: `p${p}`,
      kind: "product",
      id: prod.id,
      needs: [...needs],
      line: `p${p} | מוצר | שם: ${clean(prod.name, 120)} | קטגוריה: ${clean(prod.category, 60) || "—"} | תיאור שבעל החנות כתב: ${clean(prod.description) || "—"}`,
    });
  }
  return out;
}

export function buildStoreSeoPrompt(): string {
  return [
    "You write the Google search-result title and description, in Hebrew, for products and categories of an Israeli online store.",
    "Use ONLY the facts in the item line. Never add a fact that is not there: no prices, discounts, sales, shipping, delivery times, warranty, materials, sizes, colours, origin, stock, awards, ratings, 'the best' / 'the cheapest' / 'number one', phone numbers, links or e-mail addresses.",
    "Title (seo_title): up to 60 characters, natural Hebrew, the product / category name first; you may add the category or the store name after ' | '. No keyword stuffing, no repeated words, no emoji, no quotes, no ALL CAPS.",
    "Description (seo_description): 110–155 characters, one or two plain sentences that describe the item from the facts given; you may end with a short neutral call to action such as 'הזמינו באתר'.",
    "Write only the fields listed as needed for the item; return null for the others. If the facts are too thin to write something true and useful, return null.",
    "Return JSON only, matching the schema.",
  ].join("\n");
}

export function buildStoreSeoMessage(storeName: string, refs: StoreAiRef[]): string {
  return [
    `החנות: ${clean(storeName, 80)}`,
    "הפריטים (שדות שחסרים בסוגריים):",
    ...refs.map((r) => `${r.line} | חסר: ${r.needs.join(", ")}`),
  ].join("\n");
}

export function storeSeoSchema(refs: string[]): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array",
        maxItems: refs.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ref", "seo_title", "seo_description"],
          properties: {
            ref: { type: "string", enum: refs },
            seo_title: { type: ["string", "null"] },
            seo_description: { type: ["string", "null"] },
          },
        },
      },
    },
  };
}

// claims the facts never contain — an answer with one of these is dropped
const INVENTED =
  /(₪|ש"ח|שקל|\d+\s*%|הנחה|מבצע|משלוח|חינם|אחריות|הכי |הטוב ביותר|הזול|מספר 1|מקום ראשון|מקורי|https?:|www\.|@|\d{7,})/;

function okText(s: unknown, min: number, max: number, facts: string): string | null {
  if (typeof s !== "string") return null;
  const t = s
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length < min || t.length > max || /[<>]/.test(t)) return null;
  // a "claim" word is allowed only if the owner's own facts already contain it
  const m = t.match(INVENTED);
  if (m && !facts.includes(m[0].trim())) return null;
  return t;
}

export function parseStoreSeoOutput(parsed: unknown, refs: StoreAiRef[]): StoreProposalItem[] {
  const byRef = new Map(refs.map((r) => [r.ref, r]));
  const items = (parsed as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  const out: StoreProposalItem[] = [];
  for (const raw of items) {
    const it = raw as Record<string, unknown>;
    const ref = typeof it?.["ref"] === "string" ? byRef.get(it["ref"]) : undefined;
    if (!ref) continue;
    if (ref.needs.includes("seo_title")) {
      const title = okText(it["seo_title"], 8, 70, ref.line);
      if (title)
        out.push({
          target_kind: ref.kind,
          target_id: ref.id,
          field: "seo_title",
          text: title,
          source: "ai",
          reason: "נוסח של NURIEL AI מהפרטים שכבר מופיעים באתר — בדקו לפני אישור",
        });
    }
    if (ref.needs.includes("seo_description")) {
      const desc = okText(it["seo_description"], 50, 200, ref.line);
      if (desc)
        out.push({
          target_kind: ref.kind,
          target_id: ref.id,
          field: "seo_description",
          text: desc,
          source: "ai",
          reason: "נוסח של NURIEL AI מהפרטים שכבר מופיעים באתר — בדקו לפני אישור",
        });
    }
  }
  return out;
}
