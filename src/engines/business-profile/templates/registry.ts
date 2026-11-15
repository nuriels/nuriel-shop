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
