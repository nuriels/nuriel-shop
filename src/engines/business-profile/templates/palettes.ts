// ערכות הצבעים ההתחלתיות של התבניות (בעל העסק משנה בעורך; הניגודיות נבדקת — AA)
import type { Theme } from "../document/schema";

export const TEMPLATE_PALETTES: Record<"elegant" | "portfolio", Theme["palette"]> = {
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
};
