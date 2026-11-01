// מסמך העיצוב של האתר (Stage 5a): ערכת העיצוב, צבעים לכל ערכה, והמקטעים — סדר, מוסתר / מוצג
// ותוכן. נתוני העסק (יחידות, מחירים, זמינות, תמונות היחידות) לא נשמרים כאן — המקטעים מפנים
// אליהם. normalizeDesign לא זורק אף פעם: כל ערך לא תקין נזרק / מקוצר, כך שמסמך פגום (או שנשלח
// ישירות למסד) לא שובר את האתר ולא מכניס CSS / HTML. נבדק ביחידה.

export const THEME_IDS = ["luxury", "nature", "modern", "romantic"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

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
  return out;
}

/** מזהה למקטע חדש (לא קיים כבר במסמך) */
export function newSectionId(design: SiteDesign, type: CustomSectionType): string {
  const ids = new Set(design.sections.map((s) => s.id));
  let n = 1;
  while (ids.has(`${type}-${n}`)) n++;
  return `${type}-${n}`;
}
