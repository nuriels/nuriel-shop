/**
 * חלק 34: ביקורות לקוחות — עזרים טהורים (בלי גישה לנתונים), לדפדפן ולשרת.
 * הבדיקות כאן זהות לאלה שבמסד (product_review_submit) — כדי שהלקוח יראה
 * את השגיאה מיד, עוד לפני השליחה.
 */

export const REVIEW_LIMITS = {
  nameMin: 2,
  nameMax: 60,
  contentMin: 3,
  contentMax: 2000,
} as const;

/** אירוע בדפדפן: ביקורות אושרו / נמחקו — לרענון התג "ממתינות" בתפריט הניהול */
export const REVIEWS_CHANGED = "reviews-changed";

/** כמה ביקורות נטענות בכל פעם בעמוד המוצר */
export const REVIEWS_PAGE_SIZE = 10;

export type ReviewSummary = {
  enabled: boolean;
  count: number;
  /** ממוצע מעוגל לספרה אחת; null כשאין ביקורות */
  average: number | null;
  /** כמה ביקורות לכל מספר כוכבים (5 → 1) */
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
};

export const EMPTY_REVIEW_SUMMARY: ReviewSummary = {
  enabled: true,
  count: 0,
  average: null,
  distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
};

export type PublicReview = {
  id: string;
  customer_name: string;
  rating: number;
  content: string;
  created_at: string;
  verified_purchase: boolean;
};

export type RatingSummary = { count: number; average: number };

export type ReviewDraft = { name: string; rating: number; content: string };

export type AdminReviewStatus = "pending" | "approved" | "all";

export type AdminReview = {
  id: string;
  product_id: string;
  product_name: string;
  product_image_url: string | null;
  product_hidden: boolean;
  customer_name: string;
  customer_email: string | null;
  rating: number;
  content: string;
  is_approved: boolean;
  verified_purchase: boolean;
  created_at: string;
  approved_at: string | null;
  approved_by_name: string | null;
};

export type ReviewAction = "approve" | "hide" | "delete";

/** קישור / דומיין בטקסט = ספאם (אותו כלל כמו במסד) */
const LINK_PATTERN =
  /(https?:\/\/|www\.|[a-z0-9-]+\.(com|net|org|co\.il|ru|xyz|info|biz|io|ly)(?![a-z0-9]))/i;

export function containsLink(text: string): boolean {
  return LINK_PATTERN.test(text);
}

/** ניקוי הטקסט כמו במסד: בלי תווי בקרה, טאב → רווח, עד שורה ריקה אחת ברצף */
export function normalizeReviewContent(text: string): string {
  return (
    text
      .replace(/\r\n/g, "\n")
      .replace(/\t/g, " ")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0001-\u0008\u000b-\u001f\u007f]/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^[ \n]+|[ \n]+$/g, "")
  );
}

export function normalizeReviewName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

/** הבעיות בטופס "כתוב ביקורת" (ריק = אפשר לשלוח) */
export function reviewDraftProblems(draft: ReviewDraft): string[] {
  const problems: string[] = [];
  const name = normalizeReviewName(draft.name);
  const content = normalizeReviewContent(draft.content);
  if (!Number.isInteger(draft.rating) || draft.rating < 1 || draft.rating > 5) {
    problems.push("בחרו דירוג בין 1 ל-5 כוכבים");
  }
  if (name.length < REVIEW_LIMITS.nameMin || name.length > REVIEW_LIMITS.nameMax) {
    problems.push(`השם: בין ${REVIEW_LIMITS.nameMin} ל-${REVIEW_LIMITS.nameMax} תווים`);
  }
  if (content.length < REVIEW_LIMITS.contentMin) {
    problems.push("נא לכתוב כמה מילים על המוצר");
  } else if (content.length > REVIEW_LIMITS.contentMax) {
    problems.push(
      `הביקורת ארוכה מדי (עד ${REVIEW_LIMITS.contentMax.toLocaleString("he-IL")} תווים)`,
    );
  }
  if (containsLink(`${content} ${name}`)) problems.push("אי אפשר לכלול קישורים בביקורת");
  return problems;
}

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** התשובה של product_review_summary → סיכום מסודר */
export function parseReviewSummary(raw: unknown): ReviewSummary {
  if (!raw || typeof raw !== "object") return EMPTY_REVIEW_SUMMARY;
  const data = raw as Record<string, unknown>;
  const dist = (data["distribution"] ?? {}) as Record<string, unknown>;
  const count = Math.max(0, Math.trunc(num(data["count"])));
  const average =
    data["average"] === null || data["average"] === undefined ? null : num(data["average"]);
  return {
    enabled: data["enabled"] !== false,
    count,
    average: count > 0 ? average : null,
    distribution: {
      5: num(dist["5"]),
      4: num(dist["4"]),
      3: num(dist["3"]),
      2: num(dist["2"]),
      1: num(dist["1"]),
    },
  };
}

/** "4.5" — ממוצע בעברית עם ספרה אחת אחרי הנקודה */
export function formatAverage(average: number): string {
  return average.toLocaleString("he-IL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** "ביקורת אחת" / "12 ביקורות" */
export function reviewCountLabel(count: number): string {
  return count === 1 ? "ביקורת אחת" : `${count.toLocaleString("he-IL")} ביקורות`;
}

/**
 * מילוי הכוכבים לממוצע (0–1 לכל כוכב): 4.3 → [1, 1, 1, 1, 0.5].
 * מעגלים לחצי כוכב — כך שהתצוגה לא "מגזימה" לטובה או לרעה.
 */
export function starFills(average: number): number[] {
  const rounded = Math.round(Math.min(5, Math.max(0, average)) * 2) / 2;
  return [1, 2, 3, 4, 5].map((star) => (rounded >= star ? 1 : rounded >= star - 0.5 ? 0.5 : 0));
}

/** האחוז של כל מספר כוכבים (לפסי ההתפלגות) */
export function distributionPercent(summary: ReviewSummary, stars: 1 | 2 | 3 | 4 | 5): number {
  if (summary.count === 0) return 0;
  return Math.round((summary.distribution[stars] / summary.count) * 100);
}

export const RATING_WORDS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "גרוע",
  2: "לא משהו",
  3: "סביר",
  4: "טוב מאוד",
  5: "מצוין",
};

/** תאריך הביקורת: "8 באוקטובר 2026" */
export function formatReviewDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" });
}

/** מוצרים נלווים בעמוד המוצר: המקושרים ע"י המנהל — ואם אין, מאותה קטגוריה */
export const RELATED_GRID_LIMIT = 8;
