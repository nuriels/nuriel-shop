// NURIEL AI SEO ENGINE — keyword ideas: seeds from the business's real facts, intent classification, and the
// honesty rule: only Search Console rows carry numbers (and they are Google's, with their date range). Ideas from
// templates or AI carry NO volume / difficulty — the UI labels them "idea", never "data".

export type KeywordKind =
  | "brand"
  | "primary"
  | "local"
  | "service"
  | "product"
  | "long_tail"
  | "question"
  | "transactional";
export type KeywordIntent = "navigational" | "informational" | "commercial" | "transactional" | "local";
export type KeywordSource = "owner" | "template" | "ai" | "gsc" | "import";

export interface KeywordIdea {
  phrase: string;
  kind: KeywordKind;
  intent: KeywordIntent;
  source: KeywordSource;
  /** why it was suggested — shown to the owner */
  reason: string;
}

export interface BusinessFacts {
  engine: "ecommerce" | "hospitality" | "business_profile";
  name: string;
  /** e.g. "ישעי", "בית שמש" — only places the business really serves / is in */
  places: string[];
  /** the business category words the owner uses: "צימר", "צימרים", "חנות", "חנות אופנה"… */
  categories: string[];
  /** unit / product / service / package names that really exist */
  offerings: string[];
  /** audiences the owner states (hospitality "למי מיועד": זוגות, משפחות, כלה…) */
  audiences: string[];
}

export const KEYWORD_MAX_LEN = 80;

/** lower-case, single spaces, no punctuation at the ends; Hebrew geresh / gershayim kept */
export function normalizePhrase(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/[‎‏]/g, "")
    .replace(/[“”„]/g, '"')
    .replace(/\s+/g, " ")
    .replace(/^[\s.,;:!?\-–—|]+|[\s.,;:!?\-–—|]+$/g, "")
    .toLowerCase()
    .slice(0, KEYWORD_MAX_LEN);
}

// JS \b is ASCII-only — Hebrew words need an explicit "space or end" after them
const QUESTION =
  /^(?:איך|מה|למה|מדוע|איפה|היכן|מתי|כמה|האם|מי|באיזה|איזה|איזו)(?=\s|$)|^(?:how|what|why|where|when|which|who|is|are|can)\b/i;
const TRANSACTIONAL = /(הזמנ|להזמין|מחיר|מחירים|קני|לקנות|משלוח|מבצע|הנחה|זול|buy|price|order|book|booking|deal|cheap|discount)/i;
const COMMERCIAL = /(הכי טוב|הטוב|מומלצ|השוואה|ביקורות|חוות דעת|best|top|review|compare|vs\b)/i;
const LOCAL = /(ליד|באזור|קרוב|בסביבת|near|nearby)/i;

export function classifyIntent(phrase: string, facts?: Pick<BusinessFacts, "name" | "places">): KeywordIntent {
  const p = normalizePhrase(phrase);
  if (facts?.name && p.includes(normalizePhrase(facts.name))) return "navigational";
  if (QUESTION.test(p)) return "informational";
  if (TRANSACTIONAL.test(p)) return "transactional";
  if (COMMERCIAL.test(p)) return "commercial";
  if (LOCAL.test(p) || (facts?.places ?? []).some((pl) => pl && p.includes(normalizePhrase(pl)))) return "local";
  return "commercial";
}

const uniqueBy = (items: KeywordIdea[]) => {
  const seen = new Set<string>();
  return items.filter((k) => {
    const key = normalizePhrase(k.phrase);
    if (!key || key.length < 2 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** "ב" + place, without doubling ("ב" + "בית שמש" → "בבית שמש" is correct Hebrew) */
const inPlace = (place: string) => `ב${place}`;

/**
 * Seeds from facts only — every phrase combines words the business really uses (its name, places, categories,
 * offerings, audiences). No invented claims ("הכי זול", "מקום ראשון") and no places the business did not state.
 */
export function seedKeywords(facts: BusinessFacts): KeywordIdea[] {
  const out: KeywordIdea[] = [];
  const name = facts.name.trim();
  const places = facts.places.map((p) => p.trim()).filter(Boolean).slice(0, 4);
  const cats = facts.categories.map((c) => c.trim()).filter(Boolean).slice(0, 4);
  const offerings = facts.offerings.map((o) => o.trim()).filter(Boolean).slice(0, 12);
  const audiences = facts.audiences.map((a) => a.trim()).filter(Boolean).slice(0, 6);
  const push = (phrase: string, kind: KeywordKind, reason: string) =>
    out.push({ phrase, kind, intent: classifyIntent(phrase, { name, places }), source: "template", reason });

  if (name) {
    push(name, "brand", "שם העסק — חיפוש של מי שכבר מכיר אתכם");
    for (const c of cats.slice(0, 2)) if (!normalizePhrase(name).includes(normalizePhrase(c))) push(`${c} ${name}`, "brand", "שם העסק עם סוג העסק");
  }
  for (const c of cats) {
    push(c, "primary", "סוג העסק");
    for (const pl of places) {
      push(`${c} ${inPlace(pl)}`, "local", "סוג העסק + המקום שלכם");
      if (facts.engine === "hospitality") push(`${c} ליד ${pl}`, "local", "חיפוש מקומי — אנשים מחפשים לפי עיר קרובה");
    }
  }
  for (const a of audiences)
    for (const c of cats.slice(0, 2)) {
      push(`${c} ל${a}`, "long_tail", `קהל שציינתם: ${a}`);
      if (places[0]) push(`${c} ל${a} ${inPlace(places[0])}`, "long_tail", `קהל + מקום`);
    }
  for (const o of offerings) {
    push(o, facts.engine === "ecommerce" ? "product" : "service", "מוצר / שירות שקיים אצלכם");
    if (facts.engine === "ecommerce") push(`${o} מחיר`, "transactional", "חיפוש עם כוונת קנייה");
  }
  if (facts.engine === "hospitality" && cats[0] && places[0]) {
    push(`הזמנת ${cats[0]} ${inPlace(places[0])}`, "transactional", "חיפוש עם כוונת הזמנה");
    push(`איפה יש ${cats[0]} ליד ${places[0]}`, "question", "שאלה שאנשים שואלים");
  }
  if (facts.engine === "ecommerce" && cats[0]) push(`${cats[0]} אונליין`, "transactional", "קנייה באינטרנט");
  return uniqueBy(out);
}

/** merge ideas from several sources; the first source wins for the same phrase (owner > gsc > ai > template) */
export function mergeIdeas(...lists: KeywordIdea[][]): KeywordIdea[] {
  const rank: Record<KeywordSource, number> = { owner: 0, import: 1, gsc: 1, ai: 2, template: 3 };
  return uniqueBy(lists.flat().sort((a, b) => rank[a.source] - rank[b.source]));
}

/** keyword stuffing: the same phrase repeated in a short text (title / description / H1) */
export function stuffingCount(text: string, phrase: string): number {
  const t = normalizePhrase(text);
  const p = normalizePhrase(phrase);
  if (!p) return 0;
  let n = 0;
  let i = t.indexOf(p);
  while (i >= 0) {
    n += 1;
    i = t.indexOf(p, i + p.length);
  }
  return n;
}
