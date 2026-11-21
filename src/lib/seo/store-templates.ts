// NURIEL AI SEO ENGINE — Ecommerce proposals without AI (free, for every store). Pure (unit-tested).
//
// Built only from what the store already published: the store's name, its categories, a product's name /
// category / the first sentence of the description the owner wrote. No invented claims ("הכי זול",
// "משלוח חינם", "מקור"), no prices (they change), no keyword stuffing — one natural line. Every item goes in as
// a PENDING proposal (public.store_seo_proposals_add, only for empty fields in the automatic runs): nothing is
// written to the store without the owner's approval (or the owner's own auto switch, empty fields only).

export interface StoreSnapshot {
  store: {
    name: string | null;
    seo_title: string | null;
    seo_description: string | null;
    seo_keywords: string | null;
  } | null;
  categories: {
    id: string;
    name: string;
    parent: string | null;
    seo_title: string | null;
    seo_description: string | null;
    products: number;
    /** real product names of the category (newest first, up to 3) */
    top: string[];
  }[];
  products: {
    id: string;
    name: string;
    category: string | null;
    description: string | null;
    seo_title: string | null;
    seo_description: string | null;
    seo_keywords: string | null;
  }[];
}

export interface StoreProposalItem {
  target_kind: "store" | "product" | "category";
  target_id: string | null;
  field: "seo_title" | "seo_description" | "seo_keywords";
  text: string;
  reason: string;
  source: "template" | "ai";
}

/** what Google shows: ~60 characters of a title, ~155 of a description (the DB allows more) */
export const STORE_SEO_RECOMMENDED = { title: 60, description: 155 } as const;

const clean = (s: string | null | undefined) =>
  (s ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[<>]/g, "")
    // pictographs / emoji are dropped from Google texts (they are often not shown and look like spam)
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/** the first option that fits */
export function fit(max: number, ...options: (string | null | undefined)[]): string | null {
  for (const o of options) {
    const s = clean(o);
    if (s && s.length <= max) return s;
  }
  return null;
}

/** the first sentence (or two) of the owner's own text, cut at a word boundary — never a half word */
export function firstSentences(text: string | null | undefined, max: number): string | null {
  const t = clean(text);
  if (!t) return null;
  const sentences = t.split(/(?<=[.!?׃])\s+/u);
  let out = "";
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > max) break;
    out = next;
  }
  if (out.length >= 40) return out;
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return at >= 40 ? `${cut.slice(0, at)}…` : null;
}

const includes = (hay: string, needle: string) =>
  clean(hay).toLowerCase().includes(clean(needle).toLowerCase());

export function storeTemplateProposals(snap: StoreSnapshot): StoreProposalItem[] {
  const out: StoreProposalItem[] = [];
  const name = clean(snap.store?.name);
  if (!name) return out;
  const cats = snap.categories
    .filter((c) => c.products > 0)
    .sort((a, b) => b.products - a.products);
  const topCats = cats
    .slice(0, 3)
    .map((c) => clean(c.name))
    .filter(Boolean);

  // the store's home page
  if (snap.store && !clean(snap.store.seo_title)) {
    const t = fit(
      STORE_SEO_RECOMMENDED.title,
      topCats.length >= 2 ? `${name} | ${topCats[0]} ו${topCats[1]}` : null,
      topCats[0] ? `${name} | ${topCats[0]}` : null,
      name,
    );
    if (t)
      out.push({
        target_kind: "store",
        target_id: null,
        field: "seo_title",
        text: t,
        source: "template",
        reason: "שם החנות עם הקטגוריות המרכזיות שלה — מה שאנשים מחפשים",
      });
  }
  if (snap.store && !clean(snap.store.seo_description) && topCats.length) {
    const d = fit(
      STORE_SEO_RECOMMENDED.description,
      topCats.length >= 3
        ? `${name} — ${topCats[0]}, ${topCats[1]}, ${topCats[2]} ועוד. הזמינו באתר.`
        : null,
      topCats.length >= 2 ? `${name} — ${topCats[0]} ו${topCats[1]}. הזמינו באתר.` : null,
      `${name} — ${topCats[0]}. הזמינו באתר.`,
    );
    if (d)
      out.push({
        target_kind: "store",
        target_id: null,
        field: "seo_description",
        text: d,
        source: "template",
        reason: "תיאור קצר מהקטגוריות שבחנות — מופיע מתחת לכותרת בתוצאות החיפוש",
      });
  }

  // categories: the category + the store; the description names real products of that category
  for (const c of snap.categories) {
    const cat = clean(c.name);
    if (!cat || c.products === 0) continue;
    if (!clean(c.seo_title)) {
      const t = fit(
        STORE_SEO_RECOMMENDED.title,
        includes(cat, name) ? cat : `${cat} | ${name}`,
        cat,
      );
      if (t)
        out.push({
          target_kind: "category",
          target_id: c.id,
          field: "seo_title",
          text: t,
          source: "template",
          reason: "שם הקטגוריה ושם החנות — כותרת ברורה לעמוד הקטגוריה",
        });
    }
    if (!clean(c.seo_description)) {
      const names = (c.top ?? []).map(clean).filter(Boolean).slice(0, 3);
      const d = fit(
        STORE_SEO_RECOMMENDED.description,
        names.length >= 2 ? `${cat} ב${name}: ${names.join(", ")} ועוד.` : null,
        `${cat} ב${name}.`,
      );
      if (d && d.length >= 20)
        out.push({
          target_kind: "category",
          target_id: c.id,
          field: "seo_description",
          text: d,
          source: "template",
          reason: names.length >= 2 ? "שם הקטגוריה ומוצרים שקיימים בה" : "שם הקטגוריה ושם החנות",
        });
    }
  }

  // products: name | category; the description — the owner's own first sentence
  for (const p of snap.products) {
    const pn = clean(p.name);
    if (!pn) continue;
    const cat = clean(p.category);
    if (!clean(p.seo_title)) {
      const t = fit(
        STORE_SEO_RECOMMENDED.title,
        cat && !includes(pn, cat) ? `${pn} | ${cat}` : null,
        `${pn} | ${name}`,
        pn,
      );
      if (t)
        out.push({
          target_kind: "product",
          target_id: p.id,
          field: "seo_title",
          text: t,
          source: "template",
          reason: "שם המוצר והקטגוריה — בלי מילים שלא קשורות למוצר",
        });
    }
    if (!clean(p.seo_description)) {
      const own = firstSentences(p.description, STORE_SEO_RECOMMENDED.description);
      const d =
        own ??
        fit(
          STORE_SEO_RECOMMENDED.description,
          cat ? `${pn} — ${cat} ב${name}.` : `${pn} ב${name}.`,
        );
      if (d && d.length >= 20)
        out.push({
          target_kind: "product",
          target_id: p.id,
          field: "seo_description",
          text: d,
          source: "template",
          reason: own
            ? "המשפט הראשון מתיאור המוצר שכתבתם"
            : "שם המוצר, הקטגוריה והחנות (אין תיאור למוצר)",
        });
    }
  }
  return out;
}
