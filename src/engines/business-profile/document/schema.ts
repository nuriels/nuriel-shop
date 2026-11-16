// מסמך האתר של עסק (Nuriel Websites): אתר → עמודים → מקטעים (blocks), ואוספים (שירותים, המלצות, תיק
// עבודות) בתוך אותו מסמך — כך שכל גרסה מפורסמת שלמה בפני עצמה, וגם שחזור מחזיר הכול יחד.
// טקסטים לפי שפה ({ he, en? }) — v1 בעברית בלבד, המבנה מוכן לאנגלית (החלטה 5).
// אין HTML חופשי: כל טקסט הוא טקסט (React מציג אותו כטקסט), קישורים רק בפרוטוקולים מותרים, צבעים רק
// #rrggbb. normalizeDocument (normalize.ts) לא זורק לעולם — מסמך פגום לא שובר את האתר.
import { z } from "zod";

export const LOCALES = ["he", "en"] as const;
export type Locale = (typeof LOCALES)[number];
/** השפות שאפשר להפעיל היום (החלטה 5: עברית ו-RTL; אנגלית — בהמשך) */
export const ENABLED_LOCALES: readonly Locale[] = ["he"];
export const DEFAULT_LOCALE: Locale = "he";

export const TEMPLATE_KEYS = [
  "elegant",
  "portfolio",
  "classic",
  "professional",
  "creative",
  "minimal",
  "luxury",
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const DOCUMENT_SCHEMA_VERSION = 1;

/** טקסט לפי שפה; העברית היא הבסיס (ריק = לא מוצג) */
export const localized = (max: number) =>
  z
    .object({
      he: z.string().max(max).catch(""),
      en: z.string().max(max).optional().catch(undefined),
    })
    .catch({ he: "" });
export type LocalizedText = { he: string; en?: string | undefined };

/** קישור בטוח: https, mailto, tel, עוגן (#…) או נתיב באתר (/…) — אף פעם לא javascript: / data: */
export const SAFE_LINK =
  /^(https:\/\/[^\s<>"']{3,500}|mailto:[^\s<>"']{3,200}|tel:\+?[0-9\-()\s]{3,24}|#[a-z0-9-]{1,40}|\/[a-z0-9\-/%]{0,200})$/i;
export const safeLink = z
  .string()
  .trim()
  .max(520)
  .refine((v) => v === "" || SAFE_LINK.test(v))
  .catch("");

export const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const idSchema = z.string().regex(ID);
export const HEX = /^#[0-9a-f]{6}$/i;
const color = (fallback: string) => z.string().regex(HEX).catch(fallback);

/** תמונה מספריית המדיה של האתר (Stage 2); בלי מזהה — לא מוצגת */
export const imageRef = z
  .object({
    media: z.string().uuid().nullable().catch(null),
    alt: localized(200),
  })
  .catch({ media: null, alt: { he: "" } });
export type ImageRef = z.infer<typeof imageRef>;

const listOf = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((arr) =>
      arr
        .map((x) => item.safeParse(x))
        .filter((r): r is z.SafeParseSuccess<z.infer<T>> => r.success)
        .map((r) => r.data)
        .slice(0, max),
    );

// ---------- גופני האתר ----------
// קובצי WOFF2 בספריית המדיה של האתר (למשל הגופנים של האתר הישן — מועתקים לפי הרישיון שלהם). השם, המשקל והטווח
// נבדקים בדפוס קשיח, כי הם נכנסים ל-CSS (@font-face): אין דרך להכניס תו שסוגר את הכלל.
export const FONT_FAMILY = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,47}$/;
export const FONT_WEIGHT = /^[1-9]00( [1-9]00)?$/;
export const UNICODE_RANGE =
  /^(|U\+[0-9A-Fa-f?]{1,6}(-[0-9A-Fa-f]{1,6})?(, ?U\+[0-9A-Fa-f?]{1,6}(-[0-9A-Fa-f]{1,6})?){0,250})$/;
export const MAX_SITE_FONTS = 30;
export const siteFont = z.object({
  family: z.string().regex(FONT_FAMILY),
  weight: z.string().regex(FONT_WEIGHT).catch("400"),
  style: z.enum(["normal", "italic"]).catch("normal"),
  unicodeRange: z.string().max(4000).regex(UNICODE_RANGE).catch(""),
  file: z.object({ media: z.string().uuid() }),
});
export type SiteFont = z.infer<typeof siteFont>;
/** גופן לתפקיד (תצוגה / כותרות / טקסט / שדות): שם משפחה של גופן אתר או גופן מובנה; ריק = ברירת המחדל של התבנית */
const fontRole = z
  .string()
  .trim()
  .max(48)
  .refine((v) => v === "" || FONT_FAMILY.test(v))
  .catch("");
export const FONT_ROLES = ["display", "heading", "body", "ui"] as const;
export type FontRole = (typeof FONT_ROLES)[number];

// ---------- ערכת העיצוב ----------
export const RADII = ["sharp", "soft", "round"] as const;
/** צבעים נוספים שתבנית מגדירה (למשל "קלאסית": צבע כותרות, לשוניות, עיגולי אייקונים) — רק #rrggbb */
export const TOKEN_KEY = /^[a-z][a-zA-Z0-9]{1,30}$/;
const tokens = z
  .record(z.unknown())
  .catch({})
  .transform(
    (rec) =>
      Object.fromEntries(
        Object.entries(rec)
          .filter(([k, v]) => TOKEN_KEY.test(k) && typeof v === "string" && HEX.test(v))
          .slice(0, 40),
      ) as Record<string, string>,
  );
const themeObject = z.object({
  palette: z
    .object({
      background: color("#faf7f2"),
      surface: color("#ffffff"),
      text: color("#2b2420"),
      muted: color("#6b5f57"),
      accent: color("#7a4e3f"),
      accentText: color("#ffffff"),
      soft: color("#efe6dc"),
    })
    .catch({
      background: "#faf7f2",
      surface: "#ffffff",
      text: "#2b2420",
      muted: "#6b5f57",
      accent: "#7a4e3f",
      accentText: "#ffffff",
      soft: "#efe6dc",
    }),
  radius: z.enum(RADII).catch("soft"),
  tokens,
  fonts: listOf(siteFont, MAX_SITE_FONTS),
  typography: z
    .object({ display: fontRole, heading: fontRole, body: fontRole, ui: fontRole })
    .catch({ display: "", heading: "", body: "", ui: "" }),
  /** חלקי האתר: כותרת עליונה (פס / בלי), פוטר (מלא / רצועה), כפתור WhatsApp צף */
  chrome: z
    .object({
      header: z.enum(["bar", "none"]).catch("bar"),
      footer: z.enum(["full", "strip"]).catch("full"),
      floatingWhatsapp: z.boolean().catch(true),
    })
    .catch({ header: "bar", footer: "full", floatingWhatsapp: true }),
});
export const theme = themeObject.catch(() => themeObject.parse({}));
export type Theme = z.infer<typeof theme>;

// ---------- פרטי העסק ----------
const PHONE = /^\+?[0-9\-\s()]{7,20}$/;
const WHATSAPP = /^[1-9][0-9]{7,14}$/;
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const optional = (re: RegExp, max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => v === "" || re.test(v))
    .catch("");
export const business = z
  .object({
    name: localized(120),
    tagline: localized(200),
    phone: optional(PHONE, 20),
    whatsapp: optional(WHATSAPP, 15),
    whatsappMessage: localized(300),
    email: optional(EMAIL, 254),
    address: localized(200),
    hours: localized(200),
    social: z
      .object({
        facebook: safeLink,
        instagram: safeLink,
        linkedin: safeLink,
      })
      .catch({ facebook: "", instagram: "", linkedin: "" }),
    logo: imageRef,
  })
  .catch({
    name: { he: "" },
    tagline: { he: "" },
    phone: "",
    whatsapp: "",
    whatsappMessage: { he: "" },
    email: "",
    address: { he: "" },
    hours: { he: "" },
    social: { facebook: "", instagram: "", linkedin: "" },
    logo: { media: null, alt: { he: "" } },
  });
export type Business = z.infer<typeof business>;

// ---------- הצהרת נגישות (תקנה 35ה לתקנות הנגישות לשירות) ----------
// הפרטים שבעל העסק ממלא; הנוסח הקבוע (ההתאמות שבוצעו באתר) — בקוד התצוגה (site/AccessibilityStatement).
// אין שדה "האתר עומד בתקן": ההצהרה אומרת רק מה נבדק ומי בדק (החלטה: בלי הצהרת עמידה לפני בדיקה מקצועית).
export const DATE_YMD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const ymd = z
  .string()
  .trim()
  .refine((v) => v === "" || DATE_YMD.test(v))
  .catch("");
export const AUDIT_STATUSES = ["not_audited", "internal", "expert"] as const;
export const accessibilityStatement = z
  .object({
    /** תאריך העדכון האחרון של ההצהרה (YYYY-MM-DD) */
    updatedOn: ymd,
    contactName: localized(120),
    contactPhone: optional(PHONE, 20),
    contactEmail: optional(EMAIL, 254),
    /** מה נבדק: לא נבדק על ידי מורשה נגישות / בדיקה פנימית / נבדק על ידי מורשה נגישות */
    auditStatus: z.enum(AUDIT_STATUSES).catch("not_audited"),
    auditBy: localized(160),
    auditOn: ymd,
    /** התאמות נוספות (מעבר לרשימה הקבועה של המערכת) */
    measures: localized(2000),
    /** ליקויים ידועים ומה עושים לגביהם */
    limitations: localized(3000),
    /** דרכים חלופיות לקבלת השירות */
    alternatives: localized(1000),
    /** הסדרי הנגישות במקום מתן השירות (אם יש מקום פיזי) */
    premises: localized(2000),
    /** רכז/ת נגישות — חובה רק לעסק עם 25 עובדים ומעלה */
    coordinatorRequired: z.boolean().catch(false),
    coordinatorName: localized(120),
    coordinatorPhone: optional(PHONE, 20),
    coordinatorEmail: optional(EMAIL, 254),
  })
  .catch({
    updatedOn: "",
    contactName: { he: "" },
    contactPhone: "",
    contactEmail: "",
    auditStatus: "not_audited",
    auditBy: { he: "" },
    auditOn: "",
    measures: { he: "" },
    limitations: { he: "" },
    alternatives: { he: "" },
    premises: { he: "" },
    coordinatorRequired: false,
    coordinatorName: { he: "" },
    coordinatorPhone: "",
    coordinatorEmail: "",
  });
export type AccessibilityStatement = z.infer<typeof accessibilityStatement>;
/** הכתובת של ההצהרה בכל אתר עסק (שמורה — לא שם של עמוד) */
export const ACCESSIBILITY_SLUG = "accessibility";

// ---------- אוספים ----------
export const MAX_SERVICES = 30;
export const MAX_TESTIMONIALS = 60;
export const MAX_PORTFOLIO_ITEMS = 200;
export const MAX_PORTFOLIO_CATEGORIES = 20;

export const service = z.object({
  id: idSchema,
  title: localized(120),
  text: localized(1200),
  icon: z
    .string()
    .regex(/^[a-z-]{2,30}$/)
    .nullable()
    .catch(null),
  /** אייקון כתמונה מספריית המדיה, וצבע העיגול שמאחוריו (ריק = לפי התבנית) */
  iconImage: imageRef,
  iconBg: z
    .string()
    .refine((v) => v === "" || HEX.test(v))
    .catch(""),
  hidden: z.boolean().catch(false),
});
export type Service = z.infer<typeof service>;

export const testimonial = z.object({
  id: idSchema,
  quote: localized(1500),
  author: localized(120),
  role: localized(120),
  /** צילום מסך של ההמלצה המקורית (עד שהטקסט מתקבל) — עם alt */
  image: imageRef,
  hidden: z.boolean().catch(false),
});
export type Testimonial = z.infer<typeof testimonial>;

export const portfolioCategory = z.object({ id: idSchema, label: localized(80) });
export const portfolioItem = z.object({
  id: idSchema,
  title: localized(160),
  text: localized(600),
  categories: z.array(idSchema).max(5).catch([]),
  image: imageRef,
  /** איפה מוצג: בכל מכשיר, רק במחשב או רק בנייד (כמו "הסתרה לפי מכשיר" באתרים קיימים) */
  devices: z.enum(["all", "desktop", "mobile"]).catch("all"),
  hidden: z.boolean().catch(false),
});
export type PortfolioCategory = z.infer<typeof portfolioCategory>;
export type PortfolioItem = z.infer<typeof portfolioItem>;

export const collections = z
  .object({
    services: listOf(service, MAX_SERVICES),
    testimonials: listOf(testimonial, MAX_TESTIMONIALS),
    portfolio: z
      .object({
        categories: listOf(portfolioCategory, MAX_PORTFOLIO_CATEGORIES),
        items: listOf(portfolioItem, MAX_PORTFOLIO_ITEMS),
      })
      .catch({ categories: [], items: [] }),
  })
  .catch({ services: [], testimonials: [], portfolio: { categories: [], items: [] } });
export type Collections = z.infer<typeof collections>;

// ---------- עמודים ומקטעים ----------
export const MAX_PAGES = 12;
export const MAX_BLOCKS_PER_PAGE = 30;
/** שם העמוד בכתובת: "" = דף הבית */
export const PAGE_SLUG = /^(|[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)$/;
/** כתובות שמורות לעמודים של המערכת (הצהרת הנגישות) — עמוד לא יכול לקבל אותן */
export const RESERVED_SLUGS: readonly string[] = ["accessibility"];

export const pageSeo = z
  .object({ title: localized(70), description: localized(170) })
  .catch({ title: { he: "" }, description: { he: "" } });

/** מקטע גולמי — התוכן (props) נבדק לפי סוג המקטע (blocks/registry.ts) */
export const rawBlock = z.object({
  id: idSchema,
  type: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/),
  v: z.number().int().min(1).max(100).catch(1),
  hidden: z.boolean().catch(false),
  props: z.record(z.unknown()).catch({}),
});
export type RawBlock = z.infer<typeof rawBlock>;

/** ערך JSON (התוכן של מקטע עובר בין השרת לדפדפן) */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface Block<P = Record<string, JsonValue>> {
  id: string;
  type: string;
  v: number;
  hidden: boolean;
  props: P;
}

export interface Page {
  id: string;
  slug: string;
  title: LocalizedText;
  seo: z.infer<typeof pageSeo>;
  blocks: Block[];
}

export interface SiteDocument {
  schema: number;
  template: TemplateKey;
  locales: Locale[];
  defaultLocale: Locale;
  theme: Theme;
  business: Business;
  collections: Collections;
  pages: Page[];
  accessibility: AccessibilityStatement;
}
