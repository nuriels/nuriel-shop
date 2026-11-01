// זוגות הגופנים המאושרים לאתר (D2): גופן לכותרות + גופן לטקסט, כולם עם עברית מלאה (Google Fonts),
// בזוגות שנבדקו לקריאות. העסק בוחר זוג לכל ערכה בנפרד (כמו הצבעים); בלי בחירה — הגופנים של
// הערכה בדיוק כמו עד היום. "קלאסי" ו"מודרני" כבר נטענים בכל עמוד (ה-root) — בלי טעינה נוספת;
// לשאר נטען גיליון אחד של Google Fonts (display=swap — הטקסט מוצג מיד, בלי "הבהוב" ריק).
import type { FontPairId } from "../design/schema";

export interface FontPair {
  id: FontPairId;
  label: string;
  description: string;
  /** font-family לכותרות */
  display: string;
  /** font-family לטקסט */
  body: string;
  displayWeight: string;
  displayTracking: string;
  /** גיליון הגופנים המאוחסן בשרת שלנו (public/fonts/hosp; null — כבר נטען בכל עמוד). בלי Google Fonts */
  sheet: string | null;
}

const HEEBO = '"Heebo", ui-sans-serif, system-ui, sans-serif';
const FRANK = '"Frank Ruhl Libre", "Heebo", Georgia, serif';
const ASSISTANT = '"Assistant", "Heebo", ui-sans-serif, system-ui, sans-serif';

export const FONT_PAIRS: Record<FontPairId, FontPair> = {
  classic: {
    id: "classic",
    label: "קלאסי",
    description: "Frank Ruhl Libre לכותרות, Heebo לטקסט — סריף עברי מוכר ומכובד",
    display: FRANK,
    body: HEEBO,
    displayWeight: "500",
    displayTracking: "0",
    sheet: null,
  },
  modern: {
    id: "modern",
    label: "מודרני",
    description: "Heebo מודגש לכותרות ולטקסט — נקי וחד",
    display: HEEBO,
    body: HEEBO,
    displayWeight: "800",
    displayTracking: "-0.02em",
    sheet: null,
  },
  elegant: {
    id: "elegant",
    label: "אלגנטי",
    description: "Bellefair לכותרות, Assistant לטקסט — דק ומעודן",
    display: '"Bellefair", "Frank Ruhl Libre", Georgia, serif',
    body: ASSISTANT,
    displayWeight: "400",
    displayTracking: "0.01em",
    sheet: "/fonts/hosp/pair-elegant.css",
  },
  soft: {
    id: "soft",
    label: "רך",
    description: "Varela Round לכותרות, Assistant לטקסט — מעוגל וחמים",
    display: '"Varela Round", "Heebo", ui-sans-serif, sans-serif',
    body: ASSISTANT,
    displayWeight: "400",
    displayTracking: "0",
    sheet: "/fonts/hosp/pair-soft.css",
  },
  bold: {
    id: "bold",
    label: "נועז",
    description: "Secular One לכותרות, Rubik לטקסט — בולט ונוכח",
    display: '"Secular One", "Heebo", ui-sans-serif, sans-serif',
    body: '"Rubik", "Heebo", ui-sans-serif, system-ui, sans-serif',
    displayWeight: "400",
    displayTracking: "0",
    sheet: "/fonts/hosp/pair-bold.css",
  },
  literary: {
    id: "literary",
    label: "ספרותי",
    description: "David Libre לכותרות, Alef לטקסט — מסורתי וקריא",
    display: '"David Libre", "Frank Ruhl Libre", Georgia, serif',
    body: '"Alef", "Heebo", ui-sans-serif, system-ui, sans-serif',
    displayWeight: "500",
    displayTracking: "0",
    sheet: "/fonts/hosp/pair-literary.css",
  },
};

export const FONT_PAIR_LIST: FontPair[] = Object.values(FONT_PAIRS);

/** הגיליון של Google Fonts לזוג (null — הגופנים כבר נטענים בכל עמוד) */
export function fontHref(id: FontPairId | undefined): string | null {
  return (id ? FONT_PAIRS[id]?.sheet : null) ?? null;
}

/** משתני ה-CSS של הזוג — דורסים את הגופנים של הערכה (רק כשהעסק בחר זוג) */
export function fontVars(id: FontPairId | undefined): Record<`--${string}`, string> {
  const f = id ? FONT_PAIRS[id] : undefined;
  if (!f) return {};
  return {
    "--site-display-font": f.display,
    "--site-display-weight": f.displayWeight,
    "--site-display-tracking": f.displayTracking,
    "--font-display": f.display,
    "--font-sans": f.body,
  };
}
