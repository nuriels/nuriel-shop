// מסמך העיצוב של האתר (Stage 5a): ערכת העיצוב, צבעים לכל ערכה, והמקטעים — סדר, מוסתר / מוצג
// ותוכן. נתוני העסק (יחידות, מחירים, זמינות, תמונות היחידות) לא נשמרים כאן — המקטעים מפנים
// אליהם. normalizeDesign לא זורק אף פעם: כל ערך לא תקין נזרק / מקוצר, כך שמסמך פגום (או שנשלח
// ישירות למסד) לא שובר את האתר ולא מכניס CSS / HTML. נבדק ביחידה.

export const THEME_IDS = ["luxury", "nature", "modern", "romantic"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

/** K3: הסגנון של לוח השנה באתר (בחירת תאריכים) — בעל העסק בוחר בעורך; ברירת מחדל: קלאסי */
export const CALENDAR_STYLES = ["classic", "colors", "minimal"] as const;
export type CalendarStyle = (typeof CALENDAR_STYLES)[number];
export const isCalendarStyle = (v: unknown): v is CalendarStyle =>
  typeof v === "string" && (CALENDAR_STYLES as readonly string[]).includes(v);

/** זוגות הגופנים המאושרים (D2) — כולם עם עברית; הפרטים ב-theme/fonts.ts */
export const FONT_PAIR_IDS = ["classic", "modern", "elegant", "soft", "bold", "literary"] as const;
export type FontPairId = (typeof FONT_PAIR_IDS)[number];

/** המקטעים הקבועים: אי אפשר למחוק (רק להסתיר); מופיעים פעם אחת */
export const CORE_SECTIONS = [
  "hero",
  "about",
  "units",
  "gallery",
  "amenities",
  "terms",
  "location",
] as const;
/** מקטעים שהעסק מוסיף (כמה שרוצים, עד המגבלה) */
export const CUSTOM_SECTIONS = ["text", "highlights", "faq", "cta"] as const;
export type CoreSectionType = (typeof CORE_SECTIONS)[number];
export type CustomSectionType = (typeof CUSTOM_SECTIONS)[number];
export type SectionType = CoreSectionType | CustomSectionType;

export const MAX_CUSTOM_SECTIONS = 12;
export const MAX_HIGHLIGHTS = 6;
export const MAX_FAQ = 15;
export const MAX_GALLERY_PICK = 24;

export type Overlay = "light" | "medium" | "strong";
export type ImageSide = "start" | "end";

export interface HighlightItem {
  icon: string | null;
  title: string;
  text: string | null;
}
export interface FaqItem {
  q: string;
  a: string;
}

/** התוכן של כל מקטע — כל שדה לא חובה; ריק = ברירת המחדל (מנתוני העסק) */
export interface SectionContent {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  body?: string;
  note?: string;
  button?: string;
  /** מזהה תמונה (מתמונות האתר / המתחם / היחידות) */
  image?: string;
  /**
   * פתיח בלבד: סרטון קצר (עד 15 שניות שהשרת מדד, מגלריית האתר) — בלי קול; אחריו התמונה הראשית
   * 5 שניות, וחוזר חלילה. המסד בודק את המזהה בשמירה ובפרסום (מיגרציה 62)
   */
  video?: string;
  /** גלריה: התמונות שנבחרו (ריק = כל התמונות) */
  images?: string[];
  overlay?: Overlay;
  imageSide?: ImageSide;
  /** "על המקום": להציג את העובדות (כניסה, יציאה, אורחים, "החל מ-") */
  facts?: boolean;
  items?: HighlightItem[];
  faq?: FaqItem[];
}

export interface Section {
  id: string;
  type: SectionType;
  hidden: boolean;
  content: SectionContent;
}

export interface ColorOverrides {
  /** כפתורים, כותרות כהות */
  primary?: string;
  /** הדגשות (זהב / חימר / כתום / ורוד — לפי הערכה) */
  accent?: string;
}

/**
 * E5: גוגל ושיתוף — חלק ממסמך האתר, ולכן נכנס לאתר רק בפרסום (טיוטה לא מוצגת לגולשים).
 * כל שדה עובר normalizeDesign: טקסט בלבד באורך מוגבל, תמונה — מזהה, קוד האימות — אותיות,
 * ספרות, _ ו-- בלבד. התגיות עצמן נבנות בשרת מהערכים — אף פעם לא HTML שהוזן.
 */
export interface SiteSeo {
  /** כותרת דף הבית בגוגל (Meta Title); ריק — שם העסק | סוג המקום */
  title?: string;
  /** התיאור בגוגל (Meta Description); ריק — המשפט הראשון בתיאור המתחם */
  description?: string;
  /** תמונת השיתוף (Open Graph / Twitter) — מזהה תמונה מתמונות האתר; ריק — תמונת הפתיח */
  image?: string;
  /** אימות Google Search Console — רק הקוד (ה-content של התגית) */
  google?: string;
  /**
   * Google SEO שלב 4: מזהה המדידה של Google Analytics 4 (G-…). נכנס לאתר רק כשהמדידה זמינה (המתג
   * hospitality_analytics_enabled), ונטען בדפדפן רק אחרי שהגולש אישר Cookies של מדידה
   */
  ga4?: string;
  /** הכתובת הקנונית: ריק — הדומיין של העסק (אם יש), "subdomain" — הכתובת בפלטפורמה */
  canonical?: "subdomain";
}

export const SEO_LIMITS = { title: 70, description: 200 } as const;
/** קוד האימות של Google Search Console (בפועל ~43 תווים: אותיות, ספרות, _ ו--) */
export const GOOGLE_TOKEN = /^[A-Za-z0-9_-]{10,100}$/;
/** מזהה מדידה של Google Analytics 4 ("Measurement ID") — G- ואחריו אותיות גדולות וספרות */
export const GA4_ID = /^G-[A-Z0-9]{4,16}$/;

export interface SiteDesign {
  v: 1;
  theme: ThemeId;
  /** צבעים לכל ערכה בנפרד — החלפת ערכה לא מוחקת את הבחירה בערכה הקודמת */
  colors: Partial<Record<ThemeId, ColorOverrides>>;
  /** D2: זוג גופנים לכל ערכה (חסר — הגופנים של הערכה) */
  fonts?: Partial<Record<ThemeId, FontPairId>>;
  /** D2: הלוגו — מזהה תמונה מתמונות האתר (חסר — שם העסק בטקסט) */
  logo?: string;
  /** D2: להציג גם את שם העסק ליד הלוגו */
  logoName?: boolean;
  /** E5: גוגל ושיתוף */
  seo?: SiteSeo;
  /** K3: הסגנון של לוח השנה באתר (חסר — קלאסי) */
  calendar?: CalendarStyle;
  sections: Section[];
}

export const LIMITS = {
  eyebrow: 60,
  title: 120,
  subtitle: 300,
  body: 4000,
  note: 300,
  button: 40,
  itemTitle: 80,
  itemText: 400,
  faqQ: 200,
  faqA: 1500,
} as const;

const SECTION_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^#[0-9a-f]{6}$/i;
const ICON = /^[a-z0-9-]{1,30}$/;

export const isThemeId = (v: unknown): v is ThemeId =>
  typeof v === "string" && (THEME_IDS as readonly string[]).includes(v);
export const isFontPairId = (v: unknown): v is FontPairId =>
  typeof v === "string" && (FONT_PAIR_IDS as readonly string[]).includes(v);
export const isCore = (t: SectionType): t is CoreSectionType =>
  (CORE_SECTIONS as readonly string[]).includes(t);
const isType = (v: unknown): v is SectionType =>
  typeof v === "string" &&
  ((CORE_SECTIONS as readonly string[]).includes(v) ||
    (CUSTOM_SECTIONS as readonly string[]).includes(v));

/** טקסט: מחרוזת, בלי תווי בקרה, חתוכה לאורך המותר; ריקה → undefined */
function str(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  return s ? s.slice(0, max) : undefined;
}

export const isHexColor = (v: unknown): v is string => typeof v === "string" && HEX.test(v);

function content(type: SectionType, raw: unknown): SectionContent {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: SectionContent = {};
  const set = <K extends keyof SectionContent>(k: K, v: SectionContent[K] | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  set("eyebrow", str(c["eyebrow"], LIMITS.eyebrow));
  set("title", str(c["title"], LIMITS.title));
  set("subtitle", str(c["subtitle"], LIMITS.subtitle));
  if (type === "about" || type === "text" || type === "cta")
    set("body", str(c["body"], LIMITS.body));
  if (type === "location") set("note", str(c["note"], LIMITS.note));
  if (type === "cta" || type === "hero") set("button", str(c["button"], LIMITS.button));
  if (typeof c["image"] === "string" && UUID.test(c["image"]))
    set("image", c["image"].toLowerCase());
  if (type === "hero" && typeof c["video"] === "string" && UUID.test(c["video"]))
    set("video", c["video"].toLowerCase());
  if (type === "gallery" && Array.isArray(c["images"])) {
    const ids = [
      ...new Set(
        c["images"]
          .filter((x): x is string => typeof x === "string" && UUID.test(x))
          .map((x) => x.toLowerCase()),
      ),
    ];
    if (ids.length) set("images", ids.slice(0, MAX_GALLERY_PICK));
  }
  if (
    type === "hero" &&
    (c["overlay"] === "light" || c["overlay"] === "medium" || c["overlay"] === "strong")
  )
    set("overlay", c["overlay"]);
  if (type === "text" && (c["imageSide"] === "start" || c["imageSide"] === "end"))
    set("imageSide", c["imageSide"]);
  if (type === "about" && typeof c["facts"] === "boolean") set("facts", c["facts"]);
  if (type === "highlights" && Array.isArray(c["items"])) {
    const items = c["items"]
      .map((x): HighlightItem | null => {
        const i = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
        const title = str(i["title"], LIMITS.itemTitle);
        if (!title) return null;
        const icon = typeof i["icon"] === "string" && ICON.test(i["icon"]) ? i["icon"] : null;
        return { icon, title, text: str(i["text"], LIMITS.itemText) ?? null };
      })
      .filter((x): x is HighlightItem => x !== null)
      .slice(0, MAX_HIGHLIGHTS);
    set("items", items);
  }
  if (type === "faq" && Array.isArray(c["faq"])) {
    const faq = c["faq"]
      .map((x): FaqItem | null => {
        const i = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
        const q = str(i["q"], LIMITS.faqQ);
        const a = str(i["a"], LIMITS.faqA);
        return q && a ? { q, a } : null;
      })
      .filter((x): x is FaqItem => x !== null)
      .slice(0, MAX_FAQ);
    set("faq", faq);
  }
  return out;
}

function colors(raw: unknown): SiteDesign["colors"] {
  const out: SiteDesign["colors"] = {};
  if (!raw || typeof raw !== "object") return out;
  for (const id of THEME_IDS) {
    const c = (raw as Record<string, unknown>)[id];
    if (!c || typeof c !== "object") continue;
    const o: ColorOverrides = {};
    const primary = (c as Record<string, unknown>)["primary"];
    const accent = (c as Record<string, unknown>)["accent"];
    if (isHexColor(primary)) o.primary = primary.toLowerCase();
    if (isHexColor(accent)) o.accent = accent.toLowerCase();
    if (o.primary || o.accent) out[id] = o;
  }
  return out;
}

function fonts(raw: unknown): NonNullable<SiteDesign["fonts"]> {
  const out: NonNullable<SiteDesign["fonts"]> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const id of THEME_IDS) {
    const f = (raw as Record<string, unknown>)[id];
    if (isFontPairId(f)) out[id] = f;
  }
  return out;
}

/** העיצוב ההתחלתי: כל המקטעים הקבועים בסדר הרגיל, בלי תוכן (הכל מנתוני העסק) */
export function defaultDesign(theme: ThemeId = "luxury"): SiteDesign {
  return {
    v: 1,
    theme,
    colors: {},
    sections: CORE_SECTIONS.map((type) => ({ id: type, type, hidden: false, content: {} })),
  };
}

/** מסמך מכל מקור (מסד, עורך) → מסמך תקין. לא זורק. */
export function normalizeDesign(input: unknown, themeHint?: unknown): SiteDesign {
  let raw = input;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const theme = isThemeId(d["theme"]) ? d["theme"] : isThemeId(themeHint) ? themeHint : "luxury";
  const seenIds = new Set<string>();
  const seenCore = new Set<SectionType>();
  const sections: Section[] = [];
  let custom = 0;
  for (const s of Array.isArray(d["sections"]) ? d["sections"] : []) {
    if (!s || typeof s !== "object") continue;
    const r = s as Record<string, unknown>;
    if (!isType(r["type"])) continue;
    const type = r["type"];
    if (isCore(type)) {
      if (seenCore.has(type)) continue;
      seenCore.add(type);
    } else if (++custom > MAX_CUSTOM_SECTIONS) continue;
    let id =
      typeof r["id"] === "string" && SECTION_ID.test(r["id"]) ? r["id"] : isCore(type) ? type : "";
    if (!id || seenIds.has(id)) id = `${type}-${sections.length + 1}`;
    while (seenIds.has(id)) id = `${id}-x`;
    seenIds.add(id);
    sections.push({ id, type, hidden: r["hidden"] === true, content: content(type, r["content"]) });
  }
  // מקטע קבוע שחסר (מסמך ישן / פגום) — נוסף בסוף, מוסתר, כדי שאפשר יהיה להחזיר אותו
  const fresh = sections.length === 0;
  for (const type of CORE_SECTIONS) {
    if (seenCore.has(type)) continue;
    const id = seenIds.has(type) ? `${type}-core` : type;
    seenIds.add(id);
    sections.push({ id, type, hidden: !fresh, content: {} });
  }
  const out: SiteDesign = { v: 1, theme, colors: colors(d["colors"]), sections };
  const f = fonts(d["fonts"]);
  if (Object.keys(f).length) out.fonts = f;
  if (typeof d["logo"] === "string" && UUID.test(d["logo"])) {
    out.logo = d["logo"].toLowerCase();
    if (d["logoName"] === true) out.logoName = true;
  }
  const seo = normalizeSeo(d["seo"]);
  if (seo) out.seo = seo;
  if (isCalendarStyle(d["calendar"]) && d["calendar"] !== "classic") out.calendar = d["calendar"];
  return out;
}

/** E5: הגדרות גוגל ושיתוף — רק ערכים תקינים; בלי ערכים — undefined */
export function normalizeSeo(raw: unknown): SiteSeo | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: SiteSeo = {};
  // בלי שבירות שורה ובלי סימני תגיות — זו שורה אחת בתוצאות החיפוש
  const line = (v: unknown, max: number) =>
    str(typeof v === "string" ? v.replace(/[\r\n\t]+/g, " ").replace(/[<>]/g, "") : v, max);
  const title = line(r["title"], SEO_LIMITS.title);
  if (title) out.title = title;
  const description = line(r["description"], SEO_LIMITS.description);
  if (description) out.description = description;
  if (typeof r["image"] === "string" && UUID.test(r["image"])) out.image = r["image"].toLowerCase();
  if (typeof r["google"] === "string" && GOOGLE_TOKEN.test(r["google"].trim()))
    out.google = r["google"].trim();
  if (typeof r["ga4"] === "string" && GA4_ID.test(r["ga4"].trim().toUpperCase()))
    out.ga4 = r["ga4"].trim().toUpperCase();
  if (r["canonical"] === "subdomain") out.canonical = "subdomain";
  return Object.keys(out).length ? out : undefined;
}

/** מזהה למקטע חדש (לא קיים כבר במסמך) */
export function newSectionId(design: SiteDesign, type: CustomSectionType): string {
  const ids = new Set(design.sections.map((s) => s.id));
  let n = 1;
  while (ids.has(`${type}-${n}`)) n++;
  return `${type}-${n}`;
}
