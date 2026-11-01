// ערכות העיצוב של האתר הציבורי (Stage 4; D23). כל ערכה = טוקנים (צבעים, גופנים, רדיוס, צללים)
// + בחירות פריסה. הרכיבים משתמשים רק בטוקנים הסמנטיים (bg-background, text-primary, …) ובמשתני
// --site-* — ולכן ערכה חדשה (Nature / Modern / Romantic) = רשומה חדשה כאן, בלי לבנות רכיבים מחדש.
// כרגע: Luxury בלבד (החלטת 01/11). premium — לפי החבילה (Stage 11); כולן חינם בהשקה.
import type { CSSProperties } from "react";

export type ThemeId = "luxury";

export interface SiteTheme {
  id: ThemeId;
  label: string;
  description: string;
  tier: "free" | "premium";
  /** מתאים ל- (להצגה בבחירת הערכה) */
  suits: string[];
  layout: {
    /** גובה הפתיח בעמוד הבית */
    hero: "full" | "tall";
    /** כרטיסי היחידות */
    unitCards: "portrait" | "landscape";
    /** הכותרת שקופה מעל תמונת הפתיח */
    overlayHeader: boolean;
  };
  /** משתני CSS לשורש האתר: הטוקנים הסמנטיים של ערכת הממשק + --site-* של האתר */
  vars: Record<`--${string}`, string>;
}

const LUXURY: SiteTheme = {
  id: "luxury",
  label: "יוקרה",
  description: "שקט, אוורירי ומוקפד — שנהב, דיו כהה ונגיעות שמפניה",
  tier: "free",
  suits: ["צימרים", "וילות", "דירות נופש", "מלונות בוטיק"],
  layout: { hero: "full", unitCards: "portrait", overlayHeader: true },
  vars: {
    "--radius": "0.375rem",
    "--background": "oklch(0.984 0.006 85)",
    "--foreground": "oklch(0.23 0.012 60)",
    "--card": "oklch(0.997 0.003 85)",
    "--card-foreground": "oklch(0.23 0.012 60)",
    "--popover": "oklch(0.997 0.003 85)",
    "--popover-foreground": "oklch(0.23 0.012 60)",
    "--primary": "oklch(0.25 0.014 60)",
    "--primary-foreground": "oklch(0.985 0.008 85)",
    "--secondary": "oklch(0.95 0.012 80)",
    "--secondary-foreground": "oklch(0.28 0.014 60)",
    "--muted": "oklch(0.958 0.009 80)",
    "--muted-foreground": "oklch(0.47 0.014 65)",
    "--accent": "oklch(0.67 0.08 78)",
    "--accent-foreground": "oklch(0.2 0.012 60)",
    "--border": "oklch(0.9 0.012 80)",
    "--input": "oklch(0.88 0.014 80)",
    "--ring": "oklch(0.62 0.085 78)",
    "--destructive": "oklch(0.52 0.19 27)",
    "--destructive-foreground": "oklch(0.99 0.005 95)",
    // האתר עצמו
    "--site-sand": "oklch(0.945 0.016 80)",
    "--site-deep": "oklch(0.2 0.012 60)",
    "--site-deep-foreground": "oklch(0.93 0.012 85)",
    "--site-gold": "oklch(0.7 0.085 80)",
    /** זהב כהה לטקסט על רקע בהיר (ניגודיות AA) */
    "--site-gold-ink": "oklch(0.5 0.08 75)",
    "--site-shadow": "0 18px 50px -24px oklch(0.25 0.02 60 / 0.35)",
    "--site-hero-shade":
      "linear-gradient(180deg, oklch(0.15 0.01 60 / 0.55) 0%, oklch(0.15 0.01 60 / 0.15) 35%, oklch(0.15 0.01 60 / 0.65) 100%)",
  },
};

export const THEMES: Record<ThemeId, SiteTheme> = { luxury: LUXURY };
export const DEFAULT_THEME: ThemeId = "luxury";

/** ערכה לפי מזהה; לא מוכרת / חסרה → ברירת המחדל */
export function themeFor(id?: string | null): SiteTheme {
  return (id && THEMES[id as ThemeId]) || THEMES[DEFAULT_THEME];
}

/** המשתנים כ-style לשורש האתר */
export function themeStyle(theme: SiteTheme): CSSProperties {
  return theme.vars as CSSProperties;
}
