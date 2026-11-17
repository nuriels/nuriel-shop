// Google SEO — ביטויי חיפוש בעברית לאתר האירוח (רשימת עבודה של העסק). טהור, נבדק ביחידה.
//
//   • הביטויים הם חלק מ"גוגל ושיתוף" במסמך האתר (design.seo.keywords): לכל עסק בנפרד (site_versions
//     לפי tenant), נשמרים בטיוטה ונכנסים לגרסה המפורסמת רק בפרסום;
//   • הם לא מוצגים באתר בשום צורה: אין <meta name="keywords"> (גוגל לא משתמש בה), אין טקסט מוסתר,
//     והם מוסרים מנתוני האתר שנשלחים לדפדפן (toPublicSite). הם רק מראים לעסק איפה כל ביטוי כבר
//     מופיע בתוכן האמיתי (כותרת, תיאור, H1, כותרות, תוכן, יחידות, טקסט חלופי) — ואיפה חסר;
//   • ההתאמה בעברית: בלי ניקוד וגרשיים, עם אותיות השימוש (ו, ה, ב, ל, מ, ש, כ) לפני מילה — "בישעי"
//     נחשב "ישעי". "מילים" — כל המילים של הביטוי מופיעות, לא בהכרח ברצף (כולל ריבוי: צימר ↔ צימרים).
import { SITE_PATH } from "../config";
import type { PublicSite, PublicUnit } from "../types/website";

export const KEYWORD_GROUPS = ["general", "local", "service"] as const;
export type KeywordGroup = (typeof KEYWORD_GROUPS)[number];
export const KEYWORD_GROUP_LABELS: Record<KeywordGroup, string> = {
  general: "כלליים",
  local: "מקומיים",
  service: "לפי שירות",
};

export interface SeoKeyword {
  /** מזהה קבוע לעריכה ולמחיקה */
  id: string;
  text: string;
  group: KeywordGroup;
  /** ביטוי מרכזי — לכותרת, לתיאור ול-H1 של העמוד המתאים */
  primary?: true;
}

export const KEYWORD_LIMITS = { text: 80, count: 60 } as const;
const KEYWORD_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

const isGroup = (v: unknown): v is KeywordGroup =>
  typeof v === "string" && (KEYWORD_GROUPS as readonly string[]).includes(v);

/** הטקסט של ביטוי: שורה אחת, בלי סימני תגיות ותווי בקרה, רווחים מכווצים; ריק → "" */
export function keywordLine(v: unknown): string {
  if (typeof v !== "string") return "";
  return (
    v
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F<>]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, KEYWORD_LIMITS.text)
      .trim()
  );
}

const NIQQUD = /[֑-ֽֿ-ׇ]/g;
const QUOTES = /['`׳״‘’“”"]/g;

/** טקסט להשוואה: בלי ניקוד וגרשיים, מקף עברי ופיסוק → רווח, אותיות לטיניות קטנות */
export function normalizeHebrew(s: string): string {
  return s
    .normalize("NFC")
    .replace(NIQQUD, "")
    .replace(QUOTES, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .toLowerCase()
    .trim();
}

const tokens = (s: string) => normalizeHebrew(s).split(" ").filter(Boolean);

/** המפתח לזיהוי כפילות: "צימר  בישעי" = "צימר בישעי" */
export const keywordKey = (text: string) => normalizeHebrew(text);

/** רשימת הביטויים מכל מקור (מסד, עורך) → רשימה תקינה; לא זורק. ריקה → undefined */
export function normalizeKeywords(raw: unknown): SeoKeyword[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: SeoKeyword[] = [];
  const keys = new Set<string>();
  const ids = new Set<string>();
  for (const x of raw) {
    if (out.length >= KEYWORD_LIMITS.count) break;
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const text = keywordLine(r["text"]);
    const key = keywordKey(text);
    if (!key || keys.has(key)) continue;
    let id = typeof r["id"] === "string" && KEYWORD_ID.test(r["id"]) ? r["id"] : "";
    if (!id || ids.has(id)) id = nextId(ids);
    keys.add(key);
    ids.add(id);
    const k: SeoKeyword = { id, text, group: isGroup(r["group"]) ? r["group"] : "general" };
    if (r["primary"] === true) k.primary = true;
    out.push(k);
  }
  return out.length ? out : undefined;
}

function nextId(ids: Set<string>): string {
  let n = ids.size + 1;
  while (ids.has(`kw-${n}`)) n++;
  return `kw-${n}`;
}

/** מזהה לביטוי חדש (לא קיים ברשימה) */
export function newKeywordId(list: readonly SeoKeyword[]): string {
  return nextId(new Set(list.map((k) => k.id)));
}

/** בדיקת ביטוי לפני הוספה / עריכה; null — תקין */
export function keywordError(
  text: string,
  list: readonly SeoKeyword[],
  editingId?: string,
): string | null {
  const t = keywordLine(text);
  if (!keywordKey(t)) return "כתבו ביטוי חיפוש";
  if (text.trim().length > KEYWORD_LIMITS.text) return `עד ${KEYWORD_LIMITS.text} תווים`;
  const key = keywordKey(t);
  if (list.some((k) => k.id !== editingId && keywordKey(k.text) === key))
    return "הביטוי כבר ברשימה";
  if (!editingId && list.length >= KEYWORD_LIMITS.count)
    return `עד ${KEYWORD_LIMITS.count} ביטויים`;
  return null;
}

// ------------------------------------------------------------------
// ההתאמה בעברית
// ------------------------------------------------------------------

/** אותיות השימוש שיכולות להופיע לפני מילה (ו, ה, ב, ל, מ, ש, כ) — עד שלוש ("ושב…") */
const PREFIX = /^[והבלמשכ]{1,3}$/;
/** סיומות ריבוי / נקבה קצרות — למצב "מילים" בלבד */
const SUFFIXES = ["ים", "ות", "ה", "י"];

/** מילה של הביטוי ↔ מילה בטקסט: זהה, או עם אותיות שימוש לפניה */
function wordEq(token: string, word: string): boolean {
  if (token === word) return true;
  if (token.length <= word.length || !token.endsWith(word)) return false;
  return PREFIX.test(token.slice(0, token.length - word.length));
}

/** המילה בלי אותיות שימוש בתחילתה ("בישעי" → "ישעי"), כשנשארות לפחות 3 אותיות */
function cores(w: string): string[] {
  const out = [w];
  for (let n = 1; n <= 3 && w.length - n >= 3; n++) {
    if (!PREFIX.test(w.slice(0, n))) break;
    out.push(w.slice(n));
  }
  return out;
}

/** ריבוי / יחיד: "צימרים" → "צימר" (כשנשארות לפחות 3 אותיות) */
function stems(w: string): string[] {
  const out = [w];
  for (const s of SUFFIXES)
    if (w.length - s.length >= 3 && w.endsWith(s)) out.push(w.slice(0, -s.length));
  return out;
}

/**
 * כמו wordEq, וגם: אותיות שימוש במילה של הביטוי ("בישעי" ↔ "ישעי") וריבוי / יחיד ("צימר" ↔ "צימרים")
 * — למצב "מילים" בלבד
 */
function wordLoose(token: string, word: string): boolean {
  for (const c of cores(word)) {
    for (const a of stems(c)) {
      for (const t of stems(token)) {
        if (wordEq(t, a)) return true;
        for (const s of SUFFIXES) if (wordEq(t, a + s)) return true;
      }
    }
  }
  return false;
}

export type MatchLevel = "exact" | "words" | "none";

/** האם הביטוי מופיע בטקסט: ברצף ("exact"), כל המילים בלי רצף ("words"), או לא */
export function matchPhrase(text: string | null | undefined, phrase: string): MatchLevel {
  if (!text) return "none";
  const t = tokens(text);
  const p = tokens(phrase);
  if (!p.length || !t.length) return "none";
  for (let i = 0; i + p.length <= t.length; i++) {
    if (p.every((w, j) => wordEq(t[i + j]!, w))) return "exact";
  }
  return p.every((w) => t.some((tok) => wordLoose(tok, w))) ? "words" : "none";
}

/** כמה פעמים הביטוי מופיע ברצף — לזיהוי "דחיסה" בכותרת / בתיאור */
export function countPhrase(text: string, phrase: string): number {
  const t = tokens(text);
  const p = tokens(phrase);
  if (!p.length) return 0;
  let n = 0;
  for (let i = 0; i + p.length <= t.length; i++) {
    if (p.every((w, j) => wordEq(t[i + j]!, w))) {
      n++;
      i += p.length - 1;
    }
  }
  return n;
}

// ------------------------------------------------------------------
// הדוח: איפה כל ביטוי מופיע באתר (לפי הטיוטה בעורך)
// ------------------------------------------------------------------

export type KeywordPlace = "title" | "description" | "h1" | "headings" | "content" | "alt";
export const KEYWORD_PLACE_LABELS: Record<KeywordPlace, string> = {
  title: "כותרת SEO",
  description: "תיאור SEO",
  h1: "H1",
  headings: "כותרות (H2)",
  content: "תוכן העמוד",
  alt: "טקסט חלופי לתמונות",
};
const PLACES = Object.keys(KEYWORD_PLACE_LABELS) as KeywordPlace[];

/** הטקסטים של עמוד אחד, לפי המקום בעמוד */
export type PageTexts = Record<KeywordPlace, string[]>;

export interface PageMatch {
  /** "home" או מזהה היחידה */
  page: string;
  label: string;
  path: string;
  exact: KeywordPlace[];
  words: KeywordPlace[];
}

export type KeywordStatus = "strong" | "present" | "partial" | "missing";
export const KEYWORD_STATUS_LABELS: Record<KeywordStatus, string> = {
  strong: "בכותרת / H1",
  present: "מופיע בתוכן",
  partial: "רק חלק מהמילים",
  missing: "חסר באתר",
};

export interface KeywordReport {
  keyword: SeoKeyword;
  status: KeywordStatus;
  home: PageMatch;
  /** היחידות שבהן הביטוי (או כל מילותיו) מופיע */
  units: PageMatch[];
  /** העמוד שמתאים לביטוי: הבית, עמודי יחידות, או שניהם */
  fit: "home" | "units" | "both";
}

function matchPage(page: Omit<PageMatch, "exact" | "words">, texts: PageTexts, phrase: string) {
  const exact: KeywordPlace[] = [];
  const words: KeywordPlace[] = [];
  for (const place of PLACES) {
    // ברצף — בתוך טקסט אחד (לא על הגבול בין שני טקסטים); "מילים" — בכל הטקסטים של המקום יחד
    if (texts[place].some((s) => matchPhrase(s, phrase) === "exact")) exact.push(place);
    else if (matchPhrase(texts[place].join(" \n "), phrase) !== "none") words.push(place);
  }
  return { ...page, exact, words };
}

const strongIn = (m: PageMatch) => m.exact.includes("title") || m.exact.includes("h1");

/**
 * הדוח לכל ביטוי. home — הטקסטים של דף הבית; units — הטקסטים של כל עמוד יחידה. בונים אותם
 * (homeTexts / unitTexts) מהנתונים שהאתר באמת מציג — לא מהביטויים.
 */
export function keywordReport(
  keywords: readonly SeoKeyword[],
  home: PageTexts,
  units: { unit: Pick<PublicUnit, "id" | "name" | "slug">; texts: PageTexts }[],
): KeywordReport[] {
  return keywords.map((keyword) => {
    const h = matchPage({ page: "home", label: "דף הבית", path: SITE_PATH }, home, keyword.text);
    const us = units
      .map(({ unit, texts }) =>
        matchPage(
          {
            page: unit.id,
            label: unit.name,
            path: `${SITE_PATH}/units/${encodeURIComponent(unit.slug)}`,
          },
          texts,
          keyword.text,
        ),
      )
      .filter((m) => m.exact.length || m.words.length);
    const all = [h, ...us];
    const status: KeywordStatus = all.some(strongIn)
      ? "strong"
      : all.some((m) => m.exact.length)
        ? "present"
        : all.some((m) => m.words.length)
          ? "partial"
          : "missing";
    const unitHit = us.some((m) => m.exact.length);
    const fit: KeywordReport["fit"] =
      keyword.group === "service"
        ? unitHit
          ? "units"
          : "both"
        : unitHit && !h.exact.length
          ? "both"
          : "home";
    return { keyword, status, home: h, units: us, fit };
  });
}

export interface StuffingWarning {
  place: "title" | "description";
  message: string;
}

/**
 * אזהרות "דחיסה": אותו ביטוי פעמיים בכותרת / בתיאור, או יותר משלושה ביטויים בכותרת. גוגל מעדיף
 * כותרת טבעית — הדוח רק מזהיר, לא חוסם.
 */
export function stuffingWarnings(
  title: string,
  description: string,
  keywords: readonly SeoKeyword[],
): StuffingWarning[] {
  const out: StuffingWarning[] = [];
  const check = (place: StuffingWarning["place"], text: string, max: number) => {
    // ביטוי שמוכל בביטוי ארוך יותר שכבר נספר ("צימר ליד בית שמש" בתוך "צימר לזוגות ליד בית שמש") לא נספר שוב
    const hits = keywords.filter((k) => countPhrase(text, k.text) > 0);
    const found = hits.filter(
      (k) =>
        !hits.some(
          (o) =>
            o.id !== k.id &&
            keywordKey(o.text).length > keywordKey(k.text).length &&
            ` ${keywordKey(o.text)} `.includes(` ${keywordKey(k.text)} `),
        ),
    );
    for (const k of found)
      if (countPhrase(text, k.text) > 1)
        out.push({ place, message: `"${k.text}" מופיע יותר מפעם אחת` });
    if (found.length > max)
      out.push({
        place,
        message: `${found.length} ביטויים — זה נקרא כמו רשימה. עדיף משפט טבעי עם 1–2 ביטויים מרכזיים`,
      });
  };
  check("title", title, 3);
  check("description", description, 4);
  return out;
}

// ------------------------------------------------------------------
// הטקסטים של העמודים — מהנתונים שהאתר מציג
// ------------------------------------------------------------------

const empty = (): PageTexts => ({
  title: [],
  description: [],
  h1: [],
  headings: [],
  content: [],
  alt: [],
});
const push = (a: string[], ...v: (string | null | undefined)[]) => {
  for (const s of v) if (s?.trim()) a.push(s);
};

export interface HomeHeadText {
  title: string;
  description: string;
}

/**
 * דף הבית. head — הכותרת והתיאור כפי שהאתר בונה אותם (siteHomeHead); sections — המקטעים של מסמך
 * האתר (כותרות ותוכן שהעסק כתב). H1 — כותרת הפתיח, ואם אין — שם העסק (כמו Hero.tsx).
 */
export function homeTexts(
  site: Pick<PublicSite, "business" | "properties" | "units" | "gallery">,
  head: HomeHeadText,
  sections: readonly {
    type: string;
    hidden: boolean;
    content: {
      eyebrow?: string;
      title?: string;
      subtitle?: string;
      body?: string;
      note?: string;
      items?: { title: string; text: string | null }[];
      faq?: { q: string; a: string }[];
    };
  }[],
): PageTexts {
  const t = empty();
  push(t.title, head.title);
  push(t.description, head.description);
  const visible = sections.filter((s) => !s.hidden);
  const hero = visible.find((s) => s.type === "hero");
  push(t.h1, hero?.content.title ?? site.business.name);
  for (const s of visible) {
    const c = s.content;
    if (s.type !== "hero") push(t.headings, c.title);
    push(t.content, c.eyebrow, c.subtitle, c.body, c.note);
    if (s.type === "hero") push(t.content, c.title);
    for (const i of c.items ?? []) push(t.content, i.title, i.text);
    for (const f of c.faq ?? []) push(t.content, f.q, f.a);
  }
  // התוכן מנתוני העסק: תיאור המתחם, "מידע שימושי", שמות היחידות (כותרות H3 ברשימת היחידות)
  for (const p of site.properties) push(t.content, p.name, p.description, p.guest_info, p.address);
  push(t.content, site.business.name, site.business.address);
  for (const u of site.units) push(t.content, u.name);
  for (const m of site.gallery) push(t.alt, m.alt);
  return t;
}

/** עמוד יחידה. head — הכותרת והתיאור כפי שהאתר בונה אותם (siteUnitHead) */
export function unitTexts(
  unit: Pick<PublicUnit, "name" | "description" | "media">,
  head: HomeHeadText,
): PageTexts {
  const t = empty();
  push(t.title, head.title);
  push(t.description, head.description);
  push(t.h1, unit.name);
  push(t.content, unit.description);
  for (const m of unit.media) push(t.alt, m.alt);
  return t;
}
