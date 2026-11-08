/**
 * NURIEL AI ASSISTANT — מבנה המדריכים (משותף לשני המוצרים; הקטלוגים עצמם נפרדים לגמרי).
 *
 * מדריך = רשימת צעדים שכתבנו מראש. הדגם רק בוחר איזה מדריך מתאים לשאלה (מזהה מתוך רשימה סגורה) — הוא
 * לא כותב טקסט למשתמש, ולכן הצעדים תמיד נכונים ולא מומצאים.
 *
 * שני קטלוגים נפרדים, כל אחד בשכבה של המוצר שלו:
 *   • Ecommerce   — src/lib/ai/ecommerce-guides.ts
 *   • Hospitality — src/engines/hospitality/ai/guides.ts
 * פונקציית השרת של כל מוצר מכירה רק את הקטלוג שלה, והליבה (src/platform/ai) מוודאת מול המסד שסוג העסק
 * וסוג החבילה תואמים את המוצר של הקטלוג — כך מדריך של מוצר אחד לא מגיע לעולם לעסק מהמוצר השני.
 *
 * תוויות מסך (שמות כפתורים, שדות, לשוניות) כותבים בתוך «…»: הפאנל מציג אותן מודגשות, ובדיקת היחידה
 * (tests/unit/ai-guides.test.ts) מוודאת שכל תווית כזו באמת קיימת בקוד של המוצר — מדריך שהכפתור שלו
 * שונה או נמחק נתפס לפני שהוא מטעה מישהו. הפניה למדריך אחר באותו קטלוג: [[id]].
 */

export const AI_PRODUCTS = ["ecommerce", "hospitality"] as const;
export type AiProduct = (typeof AI_PRODUCTS)[number];

export function isAiProduct(value: unknown): value is AiProduct {
  return typeof value === "string" && (AI_PRODUCTS as readonly string[]).includes(value);
}

export interface GuideStep {
  /** נוסח הצעד. תוויות מסך בתוך «…», הפניה למדריך אחר [[id]] */
  text: string;
  /** המסך שבו מבצעים את הצעד — נתיב פנימי באתר (Ecommerce: /admin…, Hospitality: /manage…) */
  go?: string;
}

export interface Guide {
  /** מזהה יציב באותיות קטנות ומקפים — הדגם בוחר לפיו, ולכן לא משנים אותו אחרי שנוצר */
  id: string;
  /** אחת הקטגוריות של הקטלוג */
  category: string;
  title: string;
  /** ניסוחים נפוצים של השאלה (לחיפוש וגם לדגם): "להוסיף מוצר", "מוצר חדש"… */
  keywords: string[];
  /** משפט אחד: מה המדריך מכסה */
  summary: string;
  steps: GuideStep[];
  /** הערה שימושית בסוף (אזהרה / מה קורה אחרי) */
  tip?: string;
}

export interface GuideCatalog {
  product: AiProduct;
  /** חייב להיות זהה ל-ai_packages.guide_catalog של המוצר במסד ("ecommerce-v1" / "hospitality-v1") */
  catalogId: string;
  /** השם שמוצג למשתמש */
  assistantName: string;
  /** הקטגוריות: מפתח → שם בעברית */
  categories: Readonly<Record<string, string>>;
  guides: readonly Guide[];
  /** מדריכים שמוצעים לפני שנשאלה שאלה */
  popular: readonly string[];
  /** קידומת הנתיבים המותרים ב-go ("/admin" / "/manage") */
  pathPrefix: string;
  /** שאלת הבדיקה של מנהל העל ומזהי המדריכים שמהם אחד צריך להיבחר */
  connectionTest: { question: string; expectGuides: readonly string[] };
}

export const GUIDE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type TextPart = { kind: "text" | "label" | "guide"; value: string };

/** מפרק טקסט של מדריך: טקסט רגיל, תווית מסך שבתוך «…», או הפניה למדריך אחר [[id]] */
export function splitGuideText(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(/«([^«»]+)»|\[\[([a-z0-9-]+)\]\]/g)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ kind: "text", value: text.slice(last, index) });
    if (match[1] !== undefined) parts.push({ kind: "label", value: match[1].trim() });
    else if (match[2] !== undefined) parts.push({ kind: "guide", value: match[2] });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  return parts;
}

/** התוויות שבתוך «…» בטקסט */
export function extractUiLabels(text: string): string[] {
  return splitGuideText(text)
    .filter((part) => part.kind === "label" && part.value !== "")
    .map((part) => part.value);
}

/** מזהי המדריכים שמופנים אליהם בטקסט ([[id]]) */
export function extractGuideRefs(text: string): string[] {
  return splitGuideText(text)
    .filter((part) => part.kind === "guide")
    .map((part) => part.value);
}

/** כל הטקסט של מדריך שיכול להכיל תוויות / הפניות */
export function guideTexts(guide: Guide): string[] {
  return [guide.summary, ...guide.steps.map((step) => step.text), guide.tip ?? ""];
}

export function guideById(catalog: GuideCatalog): ReadonlyMap<string, Guide> {
  return new Map(catalog.guides.map((guide) => [guide.id, guide]));
}
