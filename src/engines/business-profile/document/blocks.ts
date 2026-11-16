// רישום המקטעים (blocks): לכל סוג — שם, גרסה, סכמת התוכן (Zod, סובלנית: ערך לא תקין → ברירת המחדל),
// ערכי התחלה והמרה מגרסה ישנה. סוג מקטע חדש = רשומה חדשה כאן + רכיב תצוגה בתבניות; בלי מיגרציה במסד.
// מקטע מסוג לא מוכר נזרק בנירמול (לא מוצג ולא שובר את האתר).
import { z } from "zod";
import { INQUIRY_KINDS } from "../inquiries/logic";
import { imageRef, localized, safeLink, type LocalizedText } from "./schema";

const he = (text: string): LocalizedText => ({ he: text });
const button = z
  .object({ label: localized(60), href: safeLink })
  .catch({ label: { he: "" }, href: "" });
const image = imageRef;
/** שקיפות שכבת הצבע על תמונת רקע (0–90); null = לפי התבנית */
const overlay = z.number().int().min(0).max(90).nullable().catch(null);
const paragraphs = (max: number, each: number) =>
  z
    .array(localized(each))
    .max(max)
    .catch([])
    .transform((list) => list.filter((p) => p.he.trim() !== "" || (p.en ?? "").trim() !== ""));

export const BLOCK_DEFINITIONS = {
  hero: {
    label: he("פתיח (Hero)"),
    version: 1,
    schema: z.object({
      eyebrow: localized(80),
      /** שורה קטנה בתחילת הכותרת הראשית (באותו H1) */
      titleLead: localized(120),
      title: localized(140),
      subtitle: localized(300),
      /** משפט מודגש אחרי משפט המשנה */
      tagline: localized(200),
      image: imageRef,
      /** הלוגו של העסק בתוך הפתיח (מעל הכותרת) */
      showLogo: z.boolean().catch(false),
      primary: button,
      primaryIcon: z.enum(["none", "whatsapp"]).catch("none"),
      secondary: button,
      layout: z.enum(["split", "centered", "cover"]).catch("split"),
      overlay,
    }),
    defaults: () => ({
      eyebrow: he(""),
      titleLead: he(""),
      title: he("שם העסק"),
      subtitle: he("משפט קצר שמסביר מה העסק עושה ולמי"),
      tagline: he(""),
      image: { media: null, alt: he("") },
      showLogo: false,
      primary: { label: he("לשיחת היכרות"), href: "#contact" },
      primaryIcon: "none" as "none" | "whatsapp",
      secondary: { label: he(""), href: "" },
      layout: "split" as "split" | "centered" | "cover",
      overlay: null as number | null,
    }),
  },
  about: {
    label: he("אודות"),
    version: 1,
    schema: z.object({
      eyebrow: localized(80),
      title: localized(140),
      paragraphs: paragraphs(14, 1500),
      image: imageRef,
      /** כותרת כתמונה (למשל סרט עם שם): מוצגת במקום הכותרת הכתובה, שנשארת לקוראי מסך */
      titleImage: imageRef,
      /** קרוסלת תמונות (במקום התמונה הבודדת); לכל תמונה כפתור משלה, לא חובה */
      slides: z.array(z.object({ image, button })).max(8).catch([]),
      highlights: z
        .array(z.object({ value: localized(20), label: localized(80) }))
        .max(4)
        .catch([]),
    }),
    defaults: () => ({
      eyebrow: he(""),
      title: he("קצת עליי"),
      paragraphs: [he("כמה מילים על העסק, הניסיון והגישה.")],
      image: { media: null, alt: he("") },
      titleImage: { media: null, alt: he("") },
      slides: [] as {
        image: { media: string | null; alt: LocalizedText };
        button: { label: LocalizedText; href: string };
      }[],
      highlights: [] as { value: LocalizedText; label: LocalizedText }[],
    }),
  },
  services: {
    label: he("שירותים"),
    version: 1,
    schema: z.object({
      eyebrow: localized(80),
      title: localized(140),
      /** המשך הכותרת בצבע אחר (למשל "המומחיות" + "שלי") */
      titleAccent: localized(60),
      intro: localized(500),
    }),
    defaults: () => ({
      eyebrow: he(""),
      title: he("השירותים"),
      titleAccent: he(""),
      intro: he(""),
    }),
  },
  portfolio: {
    label: he("תיק עבודות"),
    version: 1,
    schema: z.object({
      eyebrow: localized(80),
      title: localized(140),
      titleAccent: localized(60),
      intro: localized(500),
      filter: z.boolean().catch(true),
      /** כפתור "הכול" בסינון; בלי — הקטגוריה הראשונה פתוחה (כמו לשוניות) */
      showAll: z.boolean().catch(true),
      /** רשת אחידה, או Masonry (כל עבודה ביחס המקורי שלה) */
      layout: z.enum(["grid", "masonry"]).catch("grid"),
      showTitles: z.boolean().catch(true),
    }),
    defaults: () => ({
      eyebrow: he(""),
      title: he("תיק עבודות"),
      titleAccent: he(""),
      intro: he(""),
      filter: true,
      showAll: true,
      layout: "grid" as "grid" | "masonry",
      showTitles: true,
    }),
  },
  testimonials: {
    label: he("המלצות"),
    version: 1,
    schema: z.object({
      eyebrow: localized(80),
      title: localized(140),
      titleAccent: localized(60),
      intro: localized(500),
      /** כרטיסים, או גלילה רציפה (מתאימה להמלצות שהן תמונות) */
      layout: z.enum(["cards", "marquee"]).catch("cards"),
      button,
      background: imageRef,
    }),
    defaults: () => ({
      eyebrow: he(""),
      title: he("מה אומרים עליי"),
      titleAccent: he(""),
      intro: he(""),
      layout: "cards" as "cards" | "marquee",
      button: { label: he(""), href: "" },
      background: { media: null, alt: he("") },
    }),
  },
  cta: {
    label: he("קריאה לפעולה"),
    version: 1,
    schema: z.object({
      title: localized(140),
      text: localized(400),
      button: button,
      whatsapp: z.boolean().catch(true),
    }),
    defaults: () => ({
      title: he("רוצים לדבר?"),
      text: he(""),
      button: { label: he("לשיחת היכרות"), href: "#contact" },
      whatsapp: true,
    }),
  },
  contact: {
    label: he("יצירת קשר"),
    version: 1,
    schema: z.object({
      eyebrow: localized(80),
      title: localized(140),
      intro: localized(500),
      showWhatsapp: z.boolean().catch(true),
      showPhone: z.boolean().catch(true),
      showEmail: z.boolean().catch(true),
      /** טופס פנייה — נשמר ב"פניות מלקוחות" בממשק הניהול (מיגרציה 196) */
      form: z.boolean().catch(false),
    }),
    defaults: () => ({
      eyebrow: he(""),
      title: he("יצירת קשר"),
      intro: he(""),
      showWhatsapp: true,
      showPhone: true,
      showEmail: true,
      form: false,
    }),
  },
  form: {
    label: he("טופס פנייה"),
    version: 1,
    schema: z.object({
      title: localized(160),
      /** הכותרת לצד הטופס, או מעליו */
      layout: z.enum(["beside", "stacked"]).catch("beside"),
      /** רקע בהיר (עם תמונת רקע אופציונלית) או כהה */
      tone: z.enum(["light", "dark"]).catch("light"),
      background: imageRef,
      fields: z
        .object({
          name: localized(60),
          email: localized(60),
          phone: localized(60),
          message: localized(80),
        })
        .catch({
          name: he("שם"),
          email: he("אימייל"),
          phone: he("טלפון"),
          message: he("במה אוכל לעזור?"),
        }),
      submit: localized(60),
      /** סוג הפנייה ב"פניות מלקוחות" (מיגרציה 196) — כדי לדעת מאיזה טופס הגיעה */
      kind: z.enum(INQUIRY_KINDS).catch("contact"),
    }),
    defaults: () => ({
      kind: "contact" as (typeof INQUIRY_KINDS)[number],
      title: he("השאירו פרטים ונחזור אליכם"),
      layout: "beside" as "beside" | "stacked",
      tone: "light" as "light" | "dark",
      background: { media: null, alt: he("") },
      fields: {
        name: he("שם"),
        email: he("אימייל"),
        phone: he("טלפון"),
        message: he("במה אוכל לעזור?"),
      },
      submit: he("שליחה"),
    }),
  },
  media: {
    label: he("תמונה"),
    version: 1,
    schema: z.object({
      image: imageRef,
      align: z.enum(["start", "center", "end"]).catch("center"),
      /** רוחב מרבי בפיקסלים */
      width: z.number().int().min(40).max(1400).catch(320),
      /** במסך צר: יישור ורוחב אחרים (same / 0 = כמו במסך רחב) */
      alignNarrow: z.enum(["same", "start", "center", "end"]).catch("same"),
      widthNarrow: z.number().int().min(0).max(1400).catch(0),
    }),
    defaults: () => ({
      image: { media: null, alt: he("") },
      align: "center" as "start" | "center" | "end",
      width: 320,
      alignNarrow: "same" as "same" | "start" | "center" | "end",
      widthNarrow: 0,
    }),
  },
  text: {
    label: he("טקסט"),
    version: 1,
    schema: z.object({ title: localized(140), paragraphs: paragraphs(20, 2000) }),
    defaults: () => ({ title: he(""), paragraphs: [he("")] }),
  },
} as const;

export type BlockType = keyof typeof BLOCK_DEFINITIONS;
export const BLOCK_TYPES = Object.keys(BLOCK_DEFINITIONS) as BlockType[];
export type BlockProps<T extends BlockType> = ReturnType<(typeof BLOCK_DEFINITIONS)[T]["defaults"]>;

export function isBlockType(value: unknown): value is BlockType {
  return typeof value === "string" && Object.hasOwn(BLOCK_DEFINITIONS, value);
}

/**
 * התוכן של מקטע לפי הסוג שלו: שדה לא תקין → ברירת המחדל של השדה; שדה חסר → ברירת המחדל. לא זורק.
 * (גרסה 1 היא הראשונה — כשתהיה גרסה 2, ההמרה מגרסה ישנה תיכנס כאן לפני הבדיקה.)
 */
export function normalizeBlockProps<T extends BlockType>(type: T, props: unknown): BlockProps<T> {
  const def = BLOCK_DEFINITIONS[type];
  const defaults = def.defaults() as Record<string, unknown>;
  const input = props && typeof props === "object" ? (props as Record<string, unknown>) : {};
  const shape = (def.schema as z.ZodObject<z.ZodRawShape>).shape;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(shape)) {
    const parsed = shape[key]!.safeParse(key in input ? input[key] : defaults[key]);
    out[key] = parsed.success ? parsed.data : defaults[key];
  }
  return out as BlockProps<T>;
}
