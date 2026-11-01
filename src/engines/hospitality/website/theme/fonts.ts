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
  /** הפרמטרים ל-fonts.googleapis.com/css2 (null — כבר נטען בכל עמוד) */
  google: string | null;
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
    google: null,
  },
  modern: {
    id: "modern",
    label: "מודרני",
    description: "Heebo מודגש לכותרות ולטקסט — נקי וחד",
    display: HEEBO,
    body: HEEBO,
    displayWeight: "800",
    displayTracking: "-0.02em",
    google: null,
  },
  elegant: {
    id: "elegant",
    label: "אלגנטי",
    description: "Bellefair לכותרות, Assistant לטקסט — דק ומעודן",
    display: '"Bellefair", "Frank Ruhl Libre", Georgia, serif',
    body: ASSISTANT,
    displayWeight: "400",
    displayTracking: "0.01em",
    google: "family=Bellefair&family=Assistant:wght@400;500;600;700",
  },
  soft: {
    id: "soft",
    label: "רך",
    description: "Varela Round לכותרות, Assistant לטקסט — מעוגל וחמים",
    display: '"Varela Round", "Heebo", ui-sans-serif, sans-serif',
    body: ASSISTANT,
    displayWeight: "400",
    displayTracking: "0",
    google: "family=Varela+Round&family=Assistant:wght@400;500;600;700",
  },
  bold: {
    id: "bold",
    label: "נועז",
    description: "Secular One לכותרות, Rubik לטקסט — בולט ונוכח",
    display: '"Secular One", "Heebo", ui-sans-serif, sans-serif',
    body: '"Rubik", "Heebo", ui-sans-serif, system-ui, sans-serif',
    displayWeight: "400",
    displayTracking: "0",
    google: "family=Secular+One&family=Rubik:wght@400;500;600;700",
  },
  literary: {
    id: "literary",
    label: "ספרותי",
    description: "David Libre לכותרות, Alef לטקסט — מסורתי וקריא",
    display: '"David Libre", "Frank Ruhl Libre", Georgia, serif',
    body: '"Alef", "Heebo", ui-sans-serif, system-ui, sans-serif',
    displayWeight: "500",
    displayTracking: "0",
    google: "family=David+Libre:wght@400;500;700&family=Alef:wght@400;700",
  },
};

export const FONT_PAIR_LIST: FontPair[] = Object.values(FONT_PAIRS);

/** הגיליון של Google Fonts לזוג (null — הגופנים כבר נטענים בכל עמוד) */
export function fontHref(id: FontPairId | undefined): string | null {
  const g = id ? FONT_PAIRS[id]?.google : null;
  return g ? `https://fonts.googleapis.com/css2?${g}&display=swap` : null;
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
