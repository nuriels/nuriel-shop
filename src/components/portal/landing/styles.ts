import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * הסגנון של דף הנחיתה: הפלטה (משתני CSS על עטיפת הדף בלבד — לא משפיע על חנויות) והכפתורים.
 *
 * הפלטה — מתוך הלוגו של נוריאל מחשבים: כחול-לילה (המילה "מחשבים" והמחשב), כחול רויאל (המילה
 * "נוריאל"), תכלת (הטבעת וה-N) וכחול עמוק (הטבעת) — וזהב לפעולה הראשית, כמו כפתורי החנות של
 * נוריאל. ניגודיות (WCAG): ink על paper 15.9:1 · blue על white 6:1 · muted על paper 8.1:1 ·
 * on-navy על navy 10.4:1 · ink על gold 8.9:1 · gold-ink על white 6.3:1. התכלת — לקישוט ולמסגרת
 * מיקוד על כחול בלבד (לא לטקסט על לבן).
 */
export const LANDING_PALETTE = {
  "--l-ink": "#021352",
  "--l-navy": "#061b63",
  "--l-navy-deep": "#021352",
  "--l-blue": "#0057e6",
  "--l-cyan": "#00aefe",
  "--l-gold": "#e3b448",
  "--l-gold-hover": "#d3a232",
  "--l-gold-ink": "#76560c",
  "--l-paper": "#f3f7fe",
  "--l-line": "#d6e1f5",
  "--l-muted": "#3c4a6e",
  "--l-on-navy": "#c8d3ee",
  // כותרות בדף הנחיתה — Heebo כבד (כמו האותיות בלוגו) במקום הסריף הכללי של האתר (h1/h2 ב-styles.css).
  // רק בתוך העטיפה של הדף; שאר האתרים והחנויות לא מושפעים.
  "--font-display": '"Heebo", ui-sans-serif, system-ui, sans-serif',
} as CSSProperties;

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-(--l-blue) focus-visible:ring-offset-white";

/** הפעולה הראשית (ימי ניסיון) — זהב, בכל רקע */
export const ctaGold = cn(
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-(--l-gold) px-6 text-base font-bold text-(--l-ink) shadow-[0_8px_18px_-10px_rgba(118,86,12,0.75)] transition-colors hover:bg-(--l-gold-hover)",
  focusRing,
);
/** פעולה משנית על רקע בהיר */
export const ctaNavy = cn(
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-(--l-blue) px-6 text-base font-semibold text-white transition-colors hover:bg-(--l-ink)",
  focusRing,
);
export const ctaOutline = cn(
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-(--l-blue)/30 bg-white px-6 text-base font-semibold text-(--l-blue) transition-colors hover:border-(--l-blue)/60 hover:bg-(--l-blue)/5",
  focusRing,
);
/** פעולה משנית על הרקע הכחול (Nuriel Hospitality, הפוטר) */
export const ctaOutlineDark =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/40 px-6 text-base font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--l-cyan) focus-visible:ring-offset-2 focus-visible:ring-offset-(--l-navy)";

/** קישור לאתר אחר (החנות / אתר הצימרים לדוגמה) — לשונית חדשה, בלי להעביר הקשר */
export const EXTERNAL = { target: "_blank", rel: "noopener noreferrer" } as const;
