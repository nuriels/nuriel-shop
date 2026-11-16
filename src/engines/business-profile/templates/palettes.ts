// ערכות הצבעים ההתחלתיות של התבניות (בעל העסק משנה בעורך; הניגודיות נבדקת — AA)
import type { Theme } from "../document/schema";

export const TEMPLATE_PALETTES: Record<"elegant" | "portfolio" | "classic", Theme["palette"]> = {
  // Elegant: נייר חם, דיו חום-עמוק, הדגשה בטרקוטה עמומה
  elegant: {
    background: "#faf6f0",
    surface: "#ffffff",
    text: "#2d2320",
    muted: "#6a5a52",
    accent: "#8a4f3c",
    accentText: "#ffffff",
    soft: "#f0e5da",
  },
  // Portfolio: גלריה — רקע בהיר ניטרלי, טקסט כמעט שחור, הדגשה בכחול-דיו
  portfolio: {
    background: "#f6f5f2",
    surface: "#ffffff",
    text: "#1d1c1a",
    muted: "#5d5a55",
    accent: "#27466b",
    accentText: "#ffffff",
    soft: "#e7e4de",
  },
  // Classic: רקע לבן-ורדרד, טקסט חום, כפתורי מנטה, ורוד-פודרה (ברירת מחדל שעוברת AA)
  classic: {
    background: "#fffcfc",
    surface: "#f8f8f8",
    text: "#684d4b",
    muted: "#5a5a5a",
    accent: "#3f6e5c",
    accentText: "#ffffff",
    soft: "#e9d0c7",
  },
};
