// עיצוב ערכים לתצוגה באזור הניהול (עברית, שעון העסק)

const DAY_MS = 24 * 60 * 60 * 1000;

/** "06.10.2027" לפי אזור הזמן של העסק */
export function formatDate(iso: string | null | undefined, timeZone = "Asia/Jerusalem"): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  });
}

/** כמה ימים (מעוגל למעלה) נשארו עד התאריך; 0 אם עבר; null בלי תאריך */
export function daysLeft(iso: string | null | undefined, now: number = Date.now()): number | null {
  if (!iso) return null;
  const end = Date.parse(iso);
  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.ceil((end - now) / DAY_MS));
}

/** "יום אחד" / "2 ימים" */
export function daysText(days: number): string {
  if (days === 1) return "יום אחד";
  return `${days} ימים`;
}

/** "3 מתוך 5" / "3 (ללא הגבלה)" */
export function usageText(used: number, limit: number | null | undefined): string {
  return limit === null || limit === undefined ? `${used} (ללא הגבלה)` : `${used} מתוך ${limit}`;
}
