// רישום התבניות (החלטה 4): כל תבנית = מחלקת עיצוב (site.css), זוג גופנים מקומי, ועיצוב ברירת מחדל
// למקטעים. היום: Elegant ו-Portfolio. ארבע הנוספות (Professional, Creative, Minimal, Luxury) נרשמות כאן
// כשהן מוכנות — רשומה + כללי CSS, בלי שינוי במנוע, במסמך או במסד (שם הן כבר רשומות כ"מתוכננות").
import type { LocalizedText, TemplateKey } from "../document/schema";

export interface TemplateDefinition {
  key: TemplateKey;
  label: LocalizedText;
  description: LocalizedText;
  /** available: אפשר לבחור; planned: מוצגת כ"בקרוב" */
  status: "available" | "planned";
  /** המחלקה שמפעילה את כללי התבנית ב-site.css */
  className: string;
  /** עיצוב הפתיח כשהמסמך לא קבע */
  heroLayout: "split" | "centered" | "cover";
  /** צבעים נוספים שהתבנית משתמשת בהם (מעבר לערכת הצבעים הבסיסית) — עם שם וברירת מחדל; העורך מציג אותם */
  tokens?: readonly TemplateToken[];
  /** הגופנים של התבנית לכל תפקיד, כשהמסמך לא קבע */
  fonts?: Partial<Record<"display" | "heading" | "body" | "ui", string>>;
}

export interface TemplateToken {
  key: string;
  label: string;
  default: string;
}

export const TEMPLATES: Record<TemplateKey, TemplateDefinition> = {
  elegant: {
    key: "elegant",
    label: { he: "אלגנטית", en: "Elegant" },
    description: {
      he: "עריכה ספרותית: נייר חם, כותרות סריף, הרבה אוויר. לנותני שירות, יועצים ואנשי מקצוע.",
      en: "Editorial: warm paper, serif headings, generous space.",
    },
    status: "available",
    className: "bps-elegant",
    heroLayout: "split",
  },
  portfolio: {
    key: "portfolio",
    label: { he: "תיק עבודות", en: "Portfolio" },
    description: {
      he: "גלריה: העבודות במרכז, תמונות גדולות וטיפוגרפיה נקייה. למעצבים, צלמים ויוצרים.",
      en: "Gallery-first: large work, clean type.",
    },
    status: "available",
    className: "bps-portfolio",
    heroLayout: "cover",
  },
  classic: {
    key: "classic",
    label: { he: "קלאסית", en: "Classic" },
    description: {
      he: "דף נחיתה קלאסי: פתיח עם תמונת רקע, טופס, אודות עם קרוסלה, המלצות בגלילה, כרטיסי שירות עם אייקונים ותיק עבודות בלשוניות. מתאים גם לשחזור אתר קיים.",
      en: "Classic landing page: photo hero, lead form, carousel, testimonial ticker, icon cards, tabbed portfolio.",
    },
    status: "available",
    className: "bps-classic",
    heroLayout: "cover",
    fonts: { display: "Heebo", heading: "Assistant", body: "Assistant", ui: "Roboto" },
    // ברירות המחדל עוברות ניגודיות AA; אתר שמשחזר עיצוב קיים קובע את הצבעים שלו במסמך
    tokens: [
      { key: "title", label: "כותרות המקטעים", default: "#542510" },
      { key: "cardTitle", label: "כותרות הכרטיסים", default: "#9C5E44" },
      { key: "tabBg", label: "לשוניות — רקע", default: "#AED1C1" },
      { key: "tabText", label: "לשוניות — טקסט", default: "#3E4347" },
      { key: "tabActive", label: "לשונית פעילה", default: "#9E5B3D" },
      { key: "iconBg1", label: "עיגול אייקון 1", default: "#E9D0C7" },
      { key: "iconBg2", label: "עיגול אייקון 2", default: "#D4DBB2" },
      { key: "iconBg3", label: "עיגול אייקון 3", default: "#AED1C1" },
      { key: "band", label: "רקע מקטע בהיר", default: "#EFEFEF" },
      { key: "dark", label: "רקע מקטע כהה", default: "#3D2C23" },
      { key: "softButton", label: "כפתור על רקע צבעוני", default: "#FEFBF3" },
      { key: "inputBorder", label: "מסגרת שדות", default: "#69727D" },
      { key: "footerBg", label: "פוטר — רקע", default: "#000000" },
      { key: "footerText", label: "פוטר — טקסט", default: "#FFFFFF" },
    ],
  },
  professional: planned("professional", "מקצועית", "Professional"),
  creative: planned("creative", "יצירתית", "Creative"),
  minimal: planned("minimal", "מינימליסטית", "Minimal"),
  luxury: planned("luxury", "יוקרתית", "Luxury"),
};

function planned(key: TemplateKey, he: string, en: string): TemplateDefinition {
  return {
    key,
    label: { he, en },
    description: { he: "בקרוב", en: "Coming soon" },
    status: "planned",
    // עד שהתבנית מוכנה — לא נבחרת (המסד מסרב לשמור אותה); אם הגיעה בכל זאת — כמו Elegant
    className: "bps-elegant",
    heroLayout: "split",
  };
}

export function templateOf(key: TemplateKey): TemplateDefinition {
  const t = TEMPLATES[key];
  return t.status === "available" ? t : TEMPLATES.elegant;
}

export const AVAILABLE_TEMPLATES = Object.values(TEMPLATES).filter((t) => t.status === "available");

/** ערך צבע נוסף של התבנית: מהמסמך אם נקבע, אחרת ברירת המחדל של התבנית */
export function templateTokens(
  template: TemplateDefinition,
  values: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tk of template.tokens ?? []) out[tk.key] = values[tk.key] ?? tk.default;
  return out;
}
