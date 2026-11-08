import type { Guide } from "./types";

/**
 * חיפוש מדריכים לפי מילות מפתח (בלי AI) — לרשימת "אולי התכוונתם", וכשהקריאה לדגם נכשלה. תמיד בתוך
 * הקטלוג של המוצר שהועבר (אף פעם לא בשני הקטלוגים יחד). מתחשב בעברית: מסיר ניקוד ופיסוק, מתעלם
 * מאותיות שימוש בתחילת מילה (ה, ו, ב, ל, מ, כ, ש) ומסיומות רבים/נקבה נפוצות, ומתעלם ממילות מילוי.
 * (פורט מהעוזר של קובי; טווח הניקוד נבנה ממספרים, לא כתווים בקוד.)
 */

/** ניקוד וטעמים (U+0591–U+05C7) */
const NIQQUD = new RegExp(`[${String.fromCharCode(0x0591)}-${String.fromCharCode(0x05c7)}]`, "g");
const PUNCTUATION = /["'׳״`´.,;:!?()[\]{}«»/\\|+*=<>_–—-]/g;
const PREFIX_LETTERS = new Set(["ה", "ו", "ב", "כ", "ל", "מ", "ש"]);
/** סיומות רבים / נקבה נפוצות (באותיות רגילות — אותיות סופיות מומרות לרגילות ב-tokenize) */
const SUFFIXES = ["ימ", "ות", "ה", "ת", "י"];
/** ך ם ן ף ץ → כ מ נ פ צ, כדי ש"מוסיפים" ו"להוסיף" יזוהו כאותו שורש */
const FINAL_LETTERS: Record<string, string> = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };

function normalizeFinals(text: string): string {
  return text.replace(/[ךםןףץ]/g, (letter) => FINAL_LETTERS[letter] ?? letter);
}

const STOP_WORDS = new Set(
  [
    "איך",
    "אני",
    "אנחנו",
    "רוצה",
    "רוצים",
    "לעשות",
    "עושים",
    "עושה",
    "אפשר",
    "צריך",
    "צריכה",
    "של",
    "את",
    "על",
    "עם",
    "מה",
    "איפה",
    "כדי",
    "לי",
    "זה",
    "זאת",
    "אם",
    "או",
    "גם",
    "לא",
    "כן",
    "הוא",
    "היא",
    "הם",
    "יש",
    "אין",
    "כל",
    "עוד",
    "רק",
    "מאוד",
    "בבקשה",
    "תודה",
    "שלום",
    "לגבי",
    "בנוגע",
    "מישהו",
    "משהו",
    "הדרך",
    "תסביר",
    "תראה",
    "תגיד",
    "נוריאל",
    "nuriel",
    "אותו",
    "אותה",
    "שלי",
    "שלו",
  ].map(normalizeFinals),
);

export function tokenize(text: string): string[] {
  return normalizeFinals(text.toLowerCase().replace(NIQQUD, ""))
    .replace(PUNCTUATION, " ")
    .split(/\s+/)
    .filter((token) => token !== "");
}

/** צורות אפשריות של מילה: כמו שהיא, בלי אות שימוש בתחילה, ובלי סיומת רבים / נקבה */
export function stems(token: string): Set<string> {
  const forms = new Set<string>([token]);
  let current = token;
  for (let i = 0; i < 2; i++) {
    if (current.length > 3 && PREFIX_LETTERS.has(current[0] ?? "")) {
      current = current.slice(1);
      forms.add(current);
    }
  }
  for (const form of [...forms]) {
    for (const suffix of SUFFIXES) {
      if (form.length > 3 && form.endsWith(suffix)) forms.add(form.slice(0, -suffix.length));
    }
  }
  return forms;
}

function stemSet(tokens: string[]): Set<string> {
  const all = new Set<string>();
  for (const token of tokens) for (const form of stems(token)) all.add(form);
  return all;
}

function intersects(candidates: Set<string>, pool: Set<string>): boolean {
  for (const candidate of candidates) {
    if (pool.has(candidate)) return true;
  }
  return false;
}

type IndexedGuide = {
  guide: Guide;
  phrases: string[];
  keywordStems: Set<string>;
  titleStems: Set<string>;
  textStems: Set<string>;
};

const indexCache = new WeakMap<readonly Guide[], IndexedGuide[]>();

function indexGuides(guides: readonly Guide[]): IndexedGuide[] {
  const cached = indexCache.get(guides);
  if (cached) return cached;
  const indexed = guides.map((guide) => {
    const keywordTokens = guide.keywords.flatMap((keyword) => tokenize(keyword));
    return {
      guide,
      // ביטויים של כמה מילים (בלי מילות מילוי, כמו בשאלה עצמה): "מוצר חדש", "חסימת תאריכים"
      phrases: guide.keywords
        .map((keyword) =>
          tokenize(keyword)
            .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
            .join(" "),
        )
        .filter((phrase) => phrase.includes(" ")),
      keywordStems: stemSet(keywordTokens),
      titleStems: stemSet(tokenize(guide.title)),
      textStems: stemSet(
        tokenize(
          [guide.summary, ...guide.steps.map((step) => step.text)]
            .join(" ")
            .replace(/\[\[[a-z0-9-]+\]\]/g, " "),
        ),
      ),
    };
  });
  indexCache.set(guides, indexed);
  return indexed;
}

/**
 * האם יש בשאלה לפחות מילה אחת (באורך 3+, שאינה מילת מילוי) מעולם המונחים של המדריכים — כותרות וניסוחי
 * החיפוש שלהם. שאלה בלי אף מילה כזו ("מה מזג האוויר מחר") מקבלת את התשובה הקבועה של "לא על המערכת";
 * שאלה עם מילים כאלה בלי מדריך מתאים — "אין מדריך מאושר".
 */
export function siteVocabularyMatch(query: string, guides: readonly Guide[]): boolean {
  const tokens = tokenize(query).filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
  if (tokens.length === 0) return false;
  const indexed = indexGuides(guides);
  return tokens.some((token) => {
    const forms = stems(token);
    return indexed.some(
      (entry) => intersects(forms, entry.keywordStems) || intersects(forms, entry.titleStems),
    );
  });
}

export type SearchHit = { guide: Guide; score: number };

/** ציון מינימלי להצגה: מילת מפתח אחת תואמת (5) עוברת; התאמה בטקסט הצעדים בלבד (1) לא */
const MIN_SCORE = 4;

export function searchGuides(query: string, guides: readonly Guide[], limit = 3): SearchHit[] {
  const tokens = tokenize(query).filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
  if (tokens.length === 0) return [];
  const joined = tokens.join(" ");

  const hits: SearchHit[] = [];
  for (const entry of indexGuides(guides)) {
    let score = 0;
    let matchedStrong = 0;
    let phraseHit = false;
    for (const phrase of entry.phrases) {
      if (joined.includes(phrase)) {
        score += 8;
        phraseHit = true;
      }
    }
    for (const token of tokens) {
      const forms = stems(token);
      if (intersects(forms, entry.keywordStems)) {
        score += 5;
        matchedStrong += 1;
      } else if (intersects(forms, entry.titleStems)) {
        score += 3;
        matchedStrong += 1;
      } else if (token.length >= 3 && intersects(forms, entry.textStems)) {
        score += 1;
      }
    }
    if (matchedStrong === tokens.length) score += 3;
    // דיוק לפני כיסוי: מילה אחת משותפת לא מספיקה כשהשאלה ארוכה יותר. צריך ביטוי שלם מהמדריך, או לפחות
    // שתי מילים תואמות (או המילה היחידה, בשאלה של מילה אחת). עדיף "לא מצאתי" על מדריך שגוי
    if (score >= MIN_SCORE && (phraseHit || matchedStrong >= Math.min(2, tokens.length))) {
      hits.push({ guide: entry.guide, score });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
