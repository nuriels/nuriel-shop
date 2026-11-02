// פתיחת תאריכים להזמנה (מיגרציה 43): המצב של כל יחידה, סיכום להתראה ביומן, ותאריכים מוכנים
// לבחירה מהירה. open_until = הלילה האחרון שפתוח להזמנה באתר (כולל); null — עוד לא נפתח.
import type { CalendarUnit } from "../../types/calendar";
import { addDays } from "./model";

/** כמה לילות פתוחים נשארו לפני שמזכירים לפתוח עוד (כמו במסד: פחות מ-14) */
export const ENDING_DAYS = 14;

export type OpenState = "closed" | "ending" | "open";

export interface OpenStatus {
  state: OpenState;
  until: string | null;
  /** כמה לילות פתוחים נשארו מהיום (כולל היום); 0 — סגור */
  nightsLeft: number;
}

const DAY = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/** הלילה הזה סגור להזמנה באתר (לא נפתח / אחרי הלילה האחרון שנפתח) */
export function isClosedNight(unit: Pick<CalendarUnit, "open_until">, night: string): boolean {
  return !unit.open_until || night > unit.open_until;
}

export function openStatus(unit: Pick<CalendarUnit, "open_until">, today: string): OpenStatus {
  const until = unit.open_until ?? null;
  if (!until || until < today) return { state: "closed", until, nightsLeft: 0 };
  const nightsLeft = daysBetween(today, until) + 1;
  return { state: nightsLeft < ENDING_DAYS ? "ending" : "open", until, nightsLeft };
}

/** יחידות פעילות שצריך לפתוח בהן תאריכים — לפס ההתראה ביומן */
export function openSummary(units: CalendarUnit[], today: string) {
  const active = units.filter((u) => u.is_active);
  const closed = active.filter((u) => openStatus(u, today).state === "closed");
  const ending = active.filter((u) => openStatus(u, today).state === "ending");
  return { active: active.length, closed, ending };
}

/** אותו יום בעוד n חודשים (סוף חודש קצר — היום האחרון שלו) */
export function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

export type QuickUntil = "month" | "three" | "six" | "year_end";

export const QUICK_LABELS: Record<QuickUntil, string> = {
  month: "חודש קדימה",
  three: "3 חודשים",
  six: "חצי שנה",
  year_end: "עד סוף השנה",
};

/** תאריך מוכן: מהיום (או מהלילה האחרון שכבר פתוח — "הארכה") */
export function quickUntil(kind: QuickUntil, today: string): string {
  if (kind === "year_end") {
    const y = Number(today.slice(0, 4));
    // בסוף דצמבר — סוף השנה הבאה
    return today.slice(5) >= "12-01" ? `${y + 1}-12-31` : `${y}-12-31`;
  }
  return addDays(addMonths(today, kind === "month" ? 1 : kind === "three" ? 3 : 6), -1);
}

/** "פתוח עד 15.12 · עוד 43 לילות" / "סגור להזמנות באתר" — לרשימה ולקורא מסך */
export function openText(s: OpenStatus, format: (d: string) => string): string {
  if (s.state === "closed")
    return s.until ? `נסגר — היה פתוח עד ${format(s.until)}` : "עוד לא נפתחו תאריכים";
  const left = s.nightsLeft === 1 ? "לילה אחד" : `עוד ${s.nightsLeft} לילות`;
  return `פתוח עד ${format(s.until!)} · ${left}`;
}
