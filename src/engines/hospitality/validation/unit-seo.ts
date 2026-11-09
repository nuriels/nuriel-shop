// כותרת ותיאור לגוגל לכל יחידה (שלב 2 של פרויקט Google SEO) — בדיקת הקלט לפני הפנייה למסד.
// המסד (hospitality.unit_seo_set) נשאר הסמכות הסופית: הוא מנקה שוב ובודק עד 120 / 320 תווים.
// כאן — אותו גבול כמו בכותרת ובתיאור של דף הבית (SEO_LIMITS), ושורה אחת בלי סימני תגיות.
import { SEO_LIMITS } from "../website/design/schema";
import { InputError, uuid } from "./input";

type Raw = Record<string, unknown> | null | undefined;

/** אורך מומלץ (כמו בעורך של דף הבית) — מעבר לזה גוגל בדרך כלל חותך בתוצאות */
export const UNIT_SEO_RECOMMENDED = { title: 60, description: 155 } as const;

/** שורה אחת: בלי שבירות שורה וטאבים, בלי < >; ריק = ברירת המחדל של האתר */
export function seoLine(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") throw new InputError("הטקסט לא תקין");
  return value
    .replace(/\p{Cc}+/gu, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function unitSeoErrors(fields: { title: string; description: string }): {
  title?: string;
  description?: string;
} {
  const out: { title?: string; description?: string } = {};
  if (seoLine(fields.title).length > SEO_LIMITS.title)
    out.title = `כותרת לגוגל — עד ${SEO_LIMITS.title} תווים`;
  if (seoLine(fields.description).length > SEO_LIMITS.description)
    out.description = `תיאור לגוגל — עד ${SEO_LIMITS.description} תווים`;
  return out;
}

export function parseUnitSeoGet(input: Raw): { id: string } {
  return { id: uuid((input ?? {})["id"], "היחידה") };
}

export function parseUnitSeoSet(input: Raw): {
  id: string;
  title: string | null;
  description: string | null;
  revision: number;
} {
  const i = input ?? {};
  const title = seoLine(i["title"]);
  const description = seoLine(i["description"]);
  const errors = unitSeoErrors({ title, description });
  const first = errors.title ?? errors.description;
  if (first) throw new InputError(first);
  const revision = i["revision"];
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1)
    throw new InputError("הגרסה לא תקינה");
  return {
    id: uuid(i["id"], "היחידה"),
    title: title || null,
    description: description || null,
    revision,
  };
}
