// שמות המקטעים בעורך ופעולות טהורות על מסמך העיצוב (הזזה, הסתרה, הוספה, מחיקה, עדכון תוכן).
// בלי React — נבדק ביחידה.
import {
  CORE_SECTIONS,
  MAX_CUSTOM_SECTIONS,
  isCore,
  newSectionId,
  type CustomSectionType,
  type Section,
  type SectionContent,
  type SectionType,
  type SiteDesign,
} from "../../website/design/schema";

export const SECTION_LABELS: Record<SectionType, string> = {
  hero: "פתיח",
  about: "על המקום",
  units: "היחידות",
  gallery: "גלריה",
  amenities: "מתקנים ושירותים",
  terms: "תנאי שהייה",
  location: "מיקום ויצירת קשר",
  text: "טקסט ותמונה",
  highlights: "נקודות בולטות",
  faq: "שאלות ותשובות",
  cta: "קריאה להזמנה",
};

export const SECTION_HINTS: Record<SectionType, string> = {
  hero: "התמונה הגדולה והכותרת בראש האתר",
  about: "התיאור של המקום ועובדות מהירות",
  units: "כרטיס לכל יחידה — מנתוני היחידות",
  gallery: "תמונות מהאתר, מהמתחמים ומהיחידות",
  amenities: "מהמתקנים שסימנתם ביחידות ובמתחם",
  terms: "שעות, כללי המקום, ביטולים וחניה",
  location: "כתובת, ניווט ופרטי קשר",
  text: "פסקה חופשית, עם תמונה לבחירה",
  highlights: "עד 6 נקודות עם אייקון",
  faq: "שאלות נפוצות שנפתחות בלחיצה",
  cta: "פס בולט עם כפתור להזמנה",
};

export const CUSTOM_TYPES: CustomSectionType[] = ["text", "highlights", "faq", "cta"];

export const sectionTitle = (s: Section) =>
  s.content.title ? `${SECTION_LABELS[s.type]} — ${s.content.title}` : SECTION_LABELS[s.type];

export function moveSection(d: SiteDesign, id: string, to: number): SiteDesign {
  const from = d.sections.findIndex((s) => s.id === id);
  if (from < 0) return d;
  const target = Math.max(0, Math.min(d.sections.length - 1, to));
  if (target === from) return d;
  const sections = [...d.sections];
  const [moved] = sections.splice(from, 1);
  sections.splice(target, 0, moved!);
  return { ...d, sections };
}

export function toggleHidden(d: SiteDesign, id: string): SiteDesign {
  return {
    ...d,
    sections: d.sections.map((s) => (s.id === id ? { ...s, hidden: !s.hidden } : s)),
  };
}

export function updateContent(
  d: SiteDesign,
  id: string,
  patch: { [K in keyof SectionContent]?: SectionContent[K] | undefined },
): SiteDesign {
  return {
    ...d,
    sections: d.sections.map((s) => {
      if (s.id !== id) return s;
      const content: SectionContent = { ...s.content };
      for (const [k, v] of Object.entries(patch) as [keyof SectionContent, unknown][]) {
        if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) delete content[k];
        else (content as Record<string, unknown>)[k] = v;
      }
      return { ...s, content };
    }),
  };
}

export const customCount = (d: SiteDesign) => d.sections.filter((s) => !isCore(s.type)).length;

/** מקטע חדש — אחרי המקטע שנבחר (או לפני "מיקום ויצירת קשר") */
export function addSection(d: SiteDesign, type: CustomSectionType, after?: string): SiteDesign {
  if (customCount(d) >= MAX_CUSTOM_SECTIONS) return d;
  const id = newSectionId(d, type);
  const fresh: Section = {
    id,
    type,
    hidden: false,
    content:
      type === "highlights"
        ? { items: [{ icon: "star", title: "נקודה ראשונה", text: null }] }
        : type === "faq"
          ? { faq: [{ q: "שאלה", a: "תשובה" }] }
          : {},
  };
  const sections = [...d.sections];
  const at = after
    ? sections.findIndex((s) => s.id === after) + 1
    : sections.findIndex((s) => s.type === "location");
  sections.splice(at > 0 ? at : sections.length, 0, fresh);
  return { ...d, sections };
}

/** מחיקה — רק מקטע שהעסק הוסיף (הקבועים רק מוסתרים) */
export function removeSection(d: SiteDesign, id: string): SiteDesign {
  const s = d.sections.find((x) => x.id === id);
  if (!s || isCore(s.type)) return d;
  return { ...d, sections: d.sections.filter((x) => x.id !== id) };
}

export const CORE_COUNT = CORE_SECTIONS.length;
