// כפתור הנגישות של אתר האירוח — העדפות התצוגה של הגולש: מה נשמר בדפדפן, אילו מחלקות יושבות על
// <html>, הסקריפט שמחיל אותן לפני הציור הראשון (בלי הבהוב), וה-CSS שלהן.
//
// כלי העדפות בלבד: הוא משנה עיצוב דרך מחלקות CSS על <html>. הוא לא משנה תוכן, לא מוסיף ולא משכתב
// ARIA, לא מייצר טקסט חלופי ולא "מתקן" את האתר — ההנגשה עצמה בקוד של האתר (IS 5568 / WCAG 2.0 AA).
// בלי שום הצהרה שהאתר עומד בתקן.
//
// נפרד מתפריט הנגישות של החנויות (src/components/AccessibilityWidget.tsx, מחלקות a11y-* ב-styles.css):
// קידומת אחרת (hosp-a11y-*) ומפתח שמירה אחר, כך ששני המנועים לא נוגעים זה בזה.

export const A11Y_STORAGE_KEY = "hosp-a11y-prefs-v1";
export const A11Y_VERSION = 1;

/** גודל הטקסט באחוזים מגודל ברירת המחדל של הדפדפן — הקטנה / הגדלה בצעדים */
export const TEXT_STEPS = [90, 100, 115, 130, 150] as const;
export type TextStep = (typeof TEXT_STEPS)[number];

export interface A11yPrefs {
  v: typeof A11Y_VERSION;
  text: TextStep;
  /** ניגודיות גבוהה: שחור על לבן, גבולות שחורים, כפתורים שחורים */
  contrast: boolean;
  /** הדגשת קישורים: קו תחתון ומסגרת מקווקוות */
  links: boolean;
  /** ריווח שורות */
  lines: boolean;
  /** ריווח בין אותיות ומילים */
  spacing: boolean;
  /** עצירת אנימציות ומעברים (וגלילה חלקה) */
  motion: boolean;
  /** סמן גדול וברור */
  cursor: boolean;
  /** ניווט מקלדת: מסגרת פוקוס עבה בשני צבעים */
  focus: boolean;
}

export type A11yToggle = Exclude<keyof A11yPrefs, "v" | "text">;
export const A11Y_TOGGLES: readonly A11yToggle[] = [
  "contrast",
  "links",
  "lines",
  "spacing",
  "motion",
  "cursor",
  "focus",
];

export const DEFAULT_PREFS: A11yPrefs = Object.freeze({
  v: A11Y_VERSION,
  text: 100,
  contrast: false,
  links: false,
  lines: false,
  spacing: false,
  motion: false,
  cursor: false,
  focus: false,
});

/** מה שנקרא מהדפדפן — כל שדה נבדק; ערך לא מוכר → ברירת המחדל (גרסה אחרת → הכול מההתחלה) */
export function normalizePrefs(raw: unknown): A11yPrefs {
  if (!raw || typeof raw !== "object") return DEFAULT_PREFS;
  const r = raw as Record<string, unknown>;
  if (r["v"] !== A11Y_VERSION) return DEFAULT_PREFS;
  const text = TEXT_STEPS.find((s) => s === r["text"]) ?? 100;
  const out: A11yPrefs = { ...DEFAULT_PREFS, text };
  for (const k of A11Y_TOGGLES) out[k] = r[k] === true;
  return out;
}

/** צעד אחד למעלה / למטה בגודל הטקסט (בקצוות — נשאר) */
export function stepText(current: TextStep, dir: 1 | -1): TextStep {
  const i = TEXT_STEPS.indexOf(current);
  const next = TEXT_STEPS[Math.min(TEXT_STEPS.length - 1, Math.max(0, (i < 0 ? 1 : i) + dir))];
  return next ?? 100;
}

export function isAnyActive(p: A11yPrefs): boolean {
  return p.text !== 100 || A11Y_TOGGLES.some((k) => p[k]);
}

// מקור אחד למחלקות: גם applyPrefs (בזמן ריצה) וגם הסקריפט המוקדם נבנים מאותה טבלה, כך שלא
// ייווצר פער ביניהם. העמודה השלישית היא ביטוי JS על האובייקט שנקרא מהדפדפן (p).
const CLASS_RULES: ReadonlyArray<readonly [string, (p: A11yPrefs) => boolean, string]> = [
  ...TEXT_STEPS.filter((s) => s !== 100).map(
    (s) => [`hosp-a11y-text-${s}`, (p: A11yPrefs) => p.text === s, `p.text===${s}`] as const,
  ),
  ...A11Y_TOGGLES.map((k) => [`hosp-a11y-${k}`, (p: A11yPrefs) => p[k], `p.${k}===true`] as const),
];

export const A11Y_CLASSES: readonly string[] = CLASS_RULES.map(([cls]) => cls);

export function applyPrefs(el: HTMLElement, p: A11yPrefs): void {
  for (const [cls, on] of CLASS_RULES) el.classList.toggle(cls, on(p));
}

/**
 * סקריפט קטן ב-<head> שרץ לפני ציור העמוד: מחיל את ההעדפות השמורות, כך שמי שבחר ניגודיות גבוהה
 * או טקסט גדול לא רואה הבזק של העיצוב הרגיל. אם הדפדפן חוסם את האחסון — לא עושה כלום.
 */
export const A11Y_BOOTSTRAP: string =
  `(function(){try{var r=localStorage.getItem(${JSON.stringify(A11Y_STORAGE_KEY)});` +
  `if(!r)return;var p=JSON.parse(r);if(!p||p.v!==${A11Y_VERSION})return;` +
  `var c=document.documentElement.classList;` +
  CLASS_RULES.map(([cls, , js]) => `c.toggle(${JSON.stringify(cls)},${js})`).join(";") +
  `}catch(e){}})()`;

/** תנועה מופחתת: מה שהגולש ביקש במערכת ההפעלה, או "עצירת אנימציות" בכפתור הנגישות */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return (
    document.documentElement.classList.contains("hosp-a11y-motion") ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

// ---- ה-CSS ----

const svgUrl = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
/** סמן חץ שחור גדול עם מסגרת לבנה (40px) — נראה על כל רקע */
const ARROW = svgUrl(
  `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24">` +
    `<path d="M4 2v17.5l4.6-4.2 3 6.7 3.2-1.4-2.9-6.6H18z" fill="#000" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
);
/** יד מצביעה שחורה גדולה (קישורים וכפתורים) */
const HAND = svgUrl(
  `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24">` +
    `<path d="M8 3a1.5 1.5 0 0 1 3 0v7a1.5 1.5 0 0 1 3 0v1a1.5 1.5 0 0 1 3 0v1.5a1.5 1.5 0 0 1 3 0V17a5 5 0 0 1-5 5h-3.5a4 4 0 0 1-3.2-1.6l-4.1-5.2a1.6 1.6 0 0 1 2.3-2.2L8 14.3z" fill="#000" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/>` +
    `<path d="M11 10v3.5M14 11v3M17 12.5v2.5" stroke="#fff" stroke-width="1.1" stroke-linecap="round"/></svg>`,
);

const INTERACTIVE =
  'a,button,[role="button"],[role="switch"],[role="checkbox"],[role="tab"],label,select,summary,input[type="checkbox"],input[type="radio"],input[type="submit"],input[type="button"]';

/** משתני הערכה בניגודיות גבוהה — גם במעטפת האתר וגם בחלונות שנפתחים מחוץ לה (data-site-vars) */
const CONTRAST_VARS = [
  "--background:#fff",
  "--foreground:#000",
  "--card:#fff",
  "--card-foreground:#000",
  "--popover:#fff",
  "--popover-foreground:#000",
  "--secondary:#fff",
  "--secondary-foreground:#000",
  "--muted:#f2f2f2",
  "--muted-foreground:#000",
  "--accent:#000",
  "--accent-foreground:#fff",
  "--primary:#000",
  "--primary-foreground:#fff",
  "--border:#000",
  "--input:#000",
  "--ring:#1d4ed8",
  "--site-sand:#fff",
  "--site-deep:#000",
  "--site-deep-foreground:#fff",
  "--site-gold:#ffd60a",
  "--site-gold-ink:#000",
  "--site-shadow:none",
  "--site-hero-shade:linear-gradient(rgb(0 0 0/.72),rgb(0 0 0/.72))",
]
  .map((d) => `${d}!important`)
  .join(";");

const H = "html.hosp-a11y";
const SITE = ":is([data-site-theme],[data-site-vars])";

export const A11Y_CSS = [
  // גודל טקסט — כל המידות באתר ב-rem, ולכן הכול גדל באותו יחס (בלי גלילה לצדדים)
  ...TEXT_STEPS.filter((s) => s !== 100).map((s) => `${H}-text-${s}{font-size:${s}%}`),
  // טקסט גדול: הכותרת עוברת לתפריט המקוצר (כפתור התפריט במקום הקישורים הרחבים), כך שלא נשברת
  `html:is(.hosp-a11y-text-130,.hosp-a11y-text-150) [data-wide-nav]{display:none!important}`,
  `html:is(.hosp-a11y-text-130,.hosp-a11y-text-150) [data-compact-nav]{display:inline-flex!important}`,
  // ניגודיות גבוהה — החלפת משתני הצבע (בלי filter על השורש, שמשבש רכיבים קבועים במסך)
  `${H}-contrast ${SITE}{${CONTRAST_VARS}}`,
  `${H}-contrast ${SITE} :is(.opacity-60,.opacity-70,.opacity-75,.opacity-80,.opacity-85,.opacity-90,.opacity-95){opacity:1!important}`,
  `${H}-contrast ${SITE} :is(.backdrop-blur-md,.backdrop-blur){backdrop-filter:none!important}`,
  // הדגשת קישורים
  `${H}-links a{text-decoration-line:underline!important;text-decoration-thickness:2px!important;text-underline-offset:4px!important;outline:2px dashed currentColor;outline-offset:2px}`,
  // ריווח שורות; ריווח אותיות ומילים (הערכים של WCAG 1.4.12)
  `${H}-lines body *{line-height:1.9!important}`,
  `${H}-lines body :is(h1,h2,h3,.font-display){line-height:1.45!important}`,
  `${H}-spacing body *{letter-spacing:.12em!important;word-spacing:.16em!important}`,
  // עצירת אנימציות, מעברים וגלילה חלקה
  `${H}-motion,${H}-motion *{scroll-behavior:auto!important}`,
  `${H}-motion *,${H}-motion *::before,${H}-motion *::after{animation-duration:.001ms!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:.001ms!important;transition-delay:0s!important}`,
  // סמן גדול וברור
  `${H}-cursor,${H}-cursor *{cursor:${ARROW} 7 3,auto!important}`,
  `${H}-cursor :is(${INTERACTIVE}),${H}-cursor :is(${INTERACTIVE}) *{cursor:${HAND} 16 3,pointer!important}`,
  `${H}-cursor :is(input:not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]),textarea){cursor:text!important}`,
  `${H}-cursor :disabled,${H}-cursor [aria-disabled="true"]{cursor:not-allowed!important}`,
  // ניווט מקלדת: מסגרת פוקוס עבה — שחור מבחוץ, צהוב מבפנים (נראית על רקע בהיר וכהה)
  `${H}-focus :focus-visible{outline:3px solid #000!important;outline-offset:3px!important;box-shadow:0 0 0 6px #ffd60a!important}`,
  // הדפסה — בגודל רגיל
  `@media print{html[class*="hosp-a11y-text-"]{font-size:100%!important}}`,
].join("\n");
