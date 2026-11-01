// לוח היומן (Stage 3a): בדיקת הקלט — אותם כללים והודעות כמו המסד (מיגרציה 14)
import type { CalendarQuery } from "../types/calendar";
import { InputError, uuid } from "./input";

type Raw = Record<string, unknown> | null | undefined;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_RANGE_DAYS = 62;
export const REASON_MAX = 300;

const days = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
const date = (v: unknown, what: string) => {
  if (typeof v !== "string" || !DATE.test(v) || Number.isNaN(Date.parse(v)))
    throw new InputError(`${what} — תאריך לא תקין`);
  return v;
};

export function parseCalendarQuery(input: Raw): CalendarQuery {
  const i = input ?? {};
  const from = date(i["from"], "מתאריך");
  const to = date(i["to"], "עד תאריך");
  if (to <= from) throw new InputError("טווח התאריכים לא תקין");
  if (days(from, to) > MAX_RANGE_DAYS)
    throw new InputError(`אפשר להציג עד ${MAX_RANGE_DAYS} ימים בבת אחת`);
  const raw = i["unitIds"];
  let unitIds: string[] | null = null;
  if (raw !== null && raw !== undefined) {
    if (!Array.isArray(raw) || raw.length > 500) throw new InputError("רשימת היחידות לא תקינה");
    unitIds = raw.map((x) => uuid(x, "היחידה"));
  }
  return { from, to, unitIds, includeCancelled: i["includeCancelled"] === true };
}

export function blockError(from: string, to: string, reason: string, today: string): string | null {
  if (!DATE.test(from) || !DATE.test(to)) return "יש לבחור תאריך התחלה ותאריך סיום";
  if (to <= from) return "יש לבחור תאריך התחלה ותאריך סיום (אחריו)";
  if (days(from, to) > 366) return "חסימה אחת — עד שנה";
  if (to <= today) return "אי אפשר לחסום תאריכים שעברו";
  if (reason.trim().length > REASON_MAX) return `סיבת החסימה ארוכה מדי (עד ${REASON_MAX} תווים)`;
  return null;
}

export function parseBlock(input: Raw): {
  unitId: string | null;
  id: string | null;
  from: string;
  to: string;
  reason: string | null;
} {
  const i = input ?? {};
  const from = date(i["from"], "מתאריך");
  const to = date(i["to"], "עד תאריך");
  if (to <= from) throw new InputError("יש לבחור תאריך התחלה ותאריך סיום (אחריו)");
  if (days(from, to) > 366) throw new InputError("חסימה אחת — עד שנה");
  const reason = i["reason"];
  if (reason !== null && reason !== undefined && typeof reason !== "string")
    throw new InputError("סיבת החסימה — ערך לא תקין");
  if (typeof reason === "string" && reason.trim().length > REASON_MAX)
    throw new InputError(`סיבת החסימה ארוכה מדי (עד ${REASON_MAX} תווים)`);
  return {
    unitId: i["unitId"] === undefined || i["unitId"] === null ? null : uuid(i["unitId"], "היחידה"),
    id: i["id"] === undefined || i["id"] === null ? null : uuid(i["id"], "החסימה"),
    from,
    to,
    reason: typeof reason === "string" && reason.trim() !== "" ? reason.trim() : null,
  };
}
