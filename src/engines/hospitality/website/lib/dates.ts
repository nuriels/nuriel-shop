// תאריכים בלי אזור זמן (YYYY-MM-DD; הלילה של D = מ-D עד D+1) — טהור, נבדק ביחידה.

const toIso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (iso: string) => new Date(`${iso}T00:00:00Z`);

export function addDays(iso: string, days: number): string {
  const d = parse(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

/** מספר הלילות בין הגעה ליציאה */
export function nightsBetween(from: string, to: string): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86400000);
}

/** האם יש לילה תפוס בטווח [from, to) */
export function rangeHasBusy(from: string, to: string, busy: Set<string>): boolean {
  for (let d = from; d < to; d = addDays(d, 1)) if (busy.has(d)) return true;
  return false;
}

/** שבועות של חודש (ראשון → שבת); null = תא ריק. month: 0–11 */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(Date.UTC(year, month, 1));
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: (string | null)[] = Array.from({ length: first.getUTCDay() }, () => null);
  for (let d = 1; d <= days; d++) cells.push(toIso(new Date(Date.UTC(year, month, d))));
  while (cells.length % 7) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** מיגרציה 43: מצב לילה בלוח השנה באתר */
export type NightKind = "past" | "busy" | "closed" | "free";

/** עבר / תפוס / עוד לא נפתח להזמנה (openUntil: undefined — השרת לא מגביל) / פנוי */
export function nightKind(
  day: string,
  today: string,
  busy: Set<string>,
  openUntil: string | null | undefined,
): NightKind {
  if (day < today) return "past";
  if (busy.has(day)) return "busy";
  if (openUntil !== undefined && (openUntil === null || day > openUntil)) return "closed";
  return "free";
}
