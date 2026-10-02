/** תקופות לדוחות: חודש בשנה, או שנה מלאה */

/** תקופה: חודש בשנה, או month=null לשנה מלאה */
export type Period = { year: number; month: number | null };

export const MONTH_SHORT = Array.from({ length: 12 }, (_, i) =>
  new Date(2026, i, 1).toLocaleDateString("he-IL", { month: "short" }),
);

export function monthName(month: number): string {
  return new Date(2026, month - 1, 1).toLocaleDateString("he-IL", { month: "long" });
}

export function periodLabel(period: Period): string {
  return period.month === null ? `שנת ${period.year}` : `${monthName(period.month)} ${period.year}`;
}

export function currentPeriod(): Period {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function previousPeriod(period: Period): Period {
  if (period.month === null) return { year: period.year - 1, month: null };
  return period.month === 1
    ? { year: period.year - 1, month: 12 }
    : { year: period.year, month: period.month - 1 };
}

export function shiftPeriod(period: Period, delta: number): Period {
  if (period.month === null) return { year: period.year + delta, month: null };
  const index = period.year * 12 + (period.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function isFuturePeriod(period: Period): boolean {
  const now = currentPeriod();
  if (period.year !== now.year) return period.year > now.year;
  return period.month !== null && period.month > now.month!;
}
