// ערכות העיצוב של האתר הציבורי (Stage 4–5; D23). כל ערכה = טוקנים (צבעים, גופן תצוגה, רדיוס,
// צללים) + בחירות פריסה (פתיח, כרטיסי יחידות, יישור כותרות). הרכיבים משתמשים רק בטוקנים
// הסמנטיים (bg-background, text-primary, …) ובמשתני --site-*, ולכן ערכה חדשה = רשומה חדשה כאן.
// החלפת ערכה לא נוגעת בתוכן (מסמך העיצוב), והצבעים שהעסק בחר נשמרים לכל ערכה בנפרד.
// premium — לפי החבילה (Stage 11); כולן חינם בהשקה.
import type { CSSProperties } from "react";
import { isHexColor, type ColorOverrides, type FontPairId, type ThemeId } from "../design/schema";
import { ensureContrast, mix, readableOn } from "./color";
import { fontVars } from "./fonts";

export type { ThemeId };

export interface SiteTheme {
  id: ThemeId;
  label: string;
  description: string;
  tier: "free" | "premium";
  /** מתאים ל- (להצגה בבחירת הערכה) */
  suits: string[];
  layout: {
    /** הפתיח: תמונה מלאה עם טקסט עליה / תמונה וטקסט זה לצד זה / כותרת גדולה ותמונה רחבה / טקסט ממורכז */
    hero: "overlay" | "split" | "editorial" | "centered";
    /** כרטיסי היחידות */
    unitCards: "portrait" | "landscape" | "minimal" | "soft";
    /** יישור כותרות המקטעים */
    headingAlign: "center" | "start";
    /** הכותרת שקופה מעל תמונת הפתיח */
    overlayHeader: boolean;
  };
  /** הצבעים הבסיסיים (hex) — לחישובי ניגודיות ולדוגמאות בבחירת הערכה */
  palette: {
    background: string;
    foreground: string;
    primary: string;
    accent: string;
    sand: string;
    deep: string;
  };
  /** שאר המשתנים (רדיוס, גופן, צללים, צבעים משניים) */
  vars: Record<`--${string}`, string>;
}

const SERIF = '"Frank Ruhl Libre", "Heebo", Georgia, serif';
const SANS = '"Heebo", ui-sans-serif, system-ui, sans-serif';

const LUXURY: SiteTheme = {
  id: "luxury",
  label: "יוקרה",
  description: "שקט, אוורירי ומוקפד — שנהב, דיו כהה ונגיעות שמפניה",
  tier: "free",
  suits: ["צימרים", "וילות", "דירות נופש", "מלונות בוטיק"],
  layout: { hero: "overlay", unitCards: "portrait", headingAlign: "center", overlayHeader: true },
  palette: {
    background: "#fbf9f4",
    foreground: "#2a2520",
    primary: "#2b2621",
    accent: "#c2a061",
    sand: "#efe8db",
    deep: "#221d19",
  },
  vars: {
    "--radius": "0.375rem",
    "--card": "#fffefb",
    "--secondary": "#f2eee6",
    "--muted": "#f4f1ea",
    "--muted-foreground": "#6e655b",
    "--border": "#e6e0d4",
    "--input": "#ded7c8",
    "--site-deep-foreground": "#ede7dc",
    "--site-display-font": SERIF,
    "--site-display-weight": "500",
    "--site-display-tracking": "0",
    "--site-shadow": "0 18px 50px -24px rgb(43 38 33 / 0.35)",
    "--site-hero-shade":
      "linear-gradient(180deg, rgb(20 17 14 / 0.55) 0%, rgb(20 17 14 / 0.15) 35%, rgb(20 17 14 / 0.65) 100%)",
  },
};

const NATURE: SiteTheme = {
  id: "nature",
  label: "טבע",
  description: "ירוק יער, אדמה וחימר — רך, חם ומזמין, עם פינות מעוגלות",
  tier: "free",
  suits: ["צימרים", "בקתות", "חוות ומשקים", "וילות בטבע"],
  layout: { hero: "split", unitCards: "landscape", headingAlign: "center", overlayHeader: false },
  palette: {
    background: "#f6f5ef",
    foreground: "#1f2a22",
    primary: "#2f4a36",
    accent: "#b9824f",
    sand: "#e9ecdd",
    deep: "#1e2b22",
  },
  vars: {
    "--radius": "0.875rem",
    "--card": "#fffffc",
    "--secondary": "#e8ebdf",
    "--muted": "#eef0e6",
    "--muted-foreground": "#5d6b5f",
    "--border": "#dde2d3",
    "--input": "#d3d9c7",
    "--site-deep-foreground": "#e8ece2",
    "--site-display-font": SERIF,
    "--site-display-weight": "600",
    "--site-display-tracking": "0",
    "--site-shadow": "0 16px 40px -22px rgb(31 42 34 / 0.35)",
    "--site-hero-shade":
      "linear-gradient(180deg, rgb(20 30 22 / 0.35) 0%, rgb(20 30 22 / 0.1) 40%, rgb(20 30 22 / 0.55) 100%)",
  },
};

const MODERN: SiteTheme = {
  id: "modern",
  label: "מודרני",
  description: "נקי וחד — לבן, שחור וצבע הדגשה אחד, טיפוגרפיה גדולה ובטוחה",
  tier: "free",
  suits: ["דירות נופש", "מלונות עירוניים", "סוויטות", "לופטים"],
  layout: { hero: "editorial", unitCards: "minimal", headingAlign: "start", overlayHeader: false },
  palette: {
    background: "#ffffff",
    foreground: "#111111",
    primary: "#111111",
    accent: "#e2552e",
    sand: "#f3f3f1",
    deep: "#111111",
  },
  vars: {
    "--radius": "0.125rem",
    "--card": "#ffffff",
    "--secondary": "#f2f2f2",
    "--muted": "#f5f5f5",
    "--muted-foreground": "#5f5f5f",
    "--border": "#e4e4e4",
    "--input": "#d9d9d9",
    "--site-deep-foreground": "#f2f2f2",
    "--site-display-font": SANS,
    "--site-display-weight": "800",
    "--site-display-tracking": "-0.02em",
    "--site-shadow": "0 1px 0 0 rgb(0 0 0 / 0.06)",
    "--site-hero-shade": "linear-gradient(180deg, rgb(0 0 0 / 0) 40%, rgb(0 0 0 / 0.55) 100%)",
  },
};

const ROMANTIC: SiteTheme = {
  id: "romantic",
  label: "רומנטי",
  description: "רך ואינטימי — גוונים ורודים ויין, פינות מעוגלות וטקסט במרכז",
  tier: "free",
  suits: ["צימרים זוגיים", "סוויטות ספא", "בוטיק לזוגות"],
  layout: { hero: "centered", unitCards: "soft", headingAlign: "center", overlayHeader: true },
  palette: {
    background: "#fcf7f5",
    foreground: "#3a2a2e",
    primary: "#8c4a5b",
    accent: "#d9a3a3",
    sand: "#f7e8e4",
    deep: "#3b2730",
  },
  vars: {
    "--radius": "1.25rem",
    "--card": "#ffffff",
    "--secondary": "#f6e9e7",
    "--muted": "#f7eeec",
    "--muted-foreground": "#7a6268",
    "--border": "#eddcd9",
    "--input": "#e5d0cc",
    "--site-deep-foreground": "#f5e9ea",
    "--site-display-font": SERIF,
    "--site-display-weight": "500",
    "--site-display-tracking": "0",
    "--site-shadow": "0 20px 50px -26px rgb(140 74 91 / 0.35)",
    "--site-hero-shade":
      "radial-gradient(120% 90% at 50% 50%, rgb(59 39 48 / 0.35) 0%, rgb(59 39 48 / 0.6) 100%)",
  },
};

export const THEMES: Record<ThemeId, SiteTheme> = {
  luxury: LUXURY,
  nature: NATURE,
  modern: MODERN,
  romantic: ROMANTIC,
};
export const THEME_LIST: SiteTheme[] = [LUXURY, NATURE, MODERN, ROMANTIC];
export const DEFAULT_THEME: ThemeId = "luxury";

/** ערכה לפי מזהה; לא מוכרת / חסרה → ברירת המחדל */
export function themeFor(id?: string | null): SiteTheme {
  return (id && THEMES[id as ThemeId]) || THEMES[DEFAULT_THEME];
}

/**
 * כל משתני ה-CSS של האתר לפי הערכה והצבעים שהעסק בחר. צבע שלא עומד בניגודיות מותאם:
 * טקסט על כפתור — לבן או כהה לפי הקריא; צבע ההדגשה לטקסט קטן — מוכהה עד 4.5:1 מול הרקע.
 */
export function themeColors(theme: SiteTheme, overrides?: ColorOverrides) {
  const p = theme.palette;
  const primary = isHexColor(overrides?.primary) ? overrides.primary : p.primary;
  const accent = isHexColor(overrides?.accent) ? overrides.accent : p.accent;
  return {
    background: p.background,
    foreground: p.foreground,
    primary,
    primaryForeground: readableOn(primary, "#ffffff", p.foreground),
    accent,
    // טקסט בצבע ההדגשה (כותרות קטנות): קריא גם על הרקע וגם על מקטע החול הכהה יותר (AA)
    accentInk: ensureContrast(ensureContrast(accent, p.background, 4.5), p.sand, 4.5),
    // על הרקע הכהה (פוטר, מתקנים): ההדגשה בהירה מספיק
    accentOnDeep: ensureContrast(accent, p.deep, 4.5),
    sand: p.sand,
    deep: p.deep,
    ring: mix(accent, p.foreground, 0.2),
  };
}

/** משתני ה-CSS של האתר: הערכה, הצבעים שהעסק בחר, וזוג הגופנים שבחר (D2) */
export function themeStyle(
  theme: SiteTheme,
  overrides?: ColorOverrides,
  font?: FontPairId,
): CSSProperties {
  const c = themeColors(theme, overrides);
  return {
    ...theme.vars,
    "--background": c.background,
    "--foreground": c.foreground,
    "--card-foreground": c.foreground,
    "--popover": theme.vars["--card"] ?? c.background,
    "--popover-foreground": c.foreground,
    "--primary": c.primary,
    "--primary-foreground": c.primaryForeground,
    "--secondary-foreground": c.foreground,
    "--accent": c.accent,
    "--accent-foreground": readableOn(c.accent, "#ffffff", c.foreground),
    "--ring": c.ring,
    "--destructive": "#b42318",
    "--destructive-foreground": "#ffffff",
    "--site-sand": c.sand,
    "--site-deep": c.deep,
    "--site-gold": c.accentOnDeep,
    "--site-gold-ink": c.accentInk,
    "--font-display": theme.vars["--site-display-font"],
    ...fontVars(font),
  } as CSSProperties;
}
