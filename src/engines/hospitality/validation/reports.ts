// דוחות (שלב F7) — בדיקת הקלט, משותפת לדפדפן ולשרת. המסד בודק שוב (טווח, ערכים מוכרים, הרשאות).
import { InputError, isoDate, uuid } from "./input";

export const REPORT_SOURCES = ["site", "phone", "walk_in", "owner", "external"] as const;
export const REPORT_STATUSES = [
  "pending_approval",
  "pending_payment",
  "confirmed",
  "cancel_requested",
  "checked_in",
  "checked_out",
  "cancelled",
  "no_show",
] as const;

type Raw = Record<string, unknown> | null | undefined;

function list<T extends string>(
  v: unknown,
  allowed: readonly T[] | null,
  what: string,
  max: number,
): T[] | null {
  if (v === undefined || v === null || v === "") return null;
  const arr = Array.isArray(v) ? v : [v];
  if (arr.length === 0) return null;
  if (arr.length > max) throw new InputError(`יותר מדי ערכים ב${what}`);
  return arr.map((x) => {
    const s = String(x);
    if (allowed && !(allowed as readonly string[]).includes(s))
      throw new InputError(`${what} לא מוכר`);
    return s as T;
  });
}

export function parseReportsQuery(input: Raw) {
  const v = input ?? {};
  const from = isoDate(v["from"], "מתאריך");
  const to = isoDate(v["to"], "עד תאריך");
  if (to < from) throw new InputError("טווח התאריכים לא תקין");
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 > 366)
    throw new InputError("אפשר להציג עד שנה אחת");
  const units = list(v["units"], null, "היחידות", 200)?.map((x) => uuid(x, "היחידה")) ?? null;
  return {
    from,
    to,
    units,
    sources: list(v["sources"], REPORT_SOURCES, "המקור", 10),
    statuses: list(v["statuses"], REPORT_STATUSES, "הסטטוס", 10),
  };
}
export type ReportsQuery = ReturnType<typeof parseReportsQuery>;
