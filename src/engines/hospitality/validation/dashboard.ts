// לוח הבקרה (שלב F3): טווח התאריכים, והרשאת "נתונים כספיים" למנהל. אותם כללים כמו במסד.
import { InputError, isoDate, uuid } from "./input";

type Raw = Record<string, unknown> | null | undefined;

export const DASHBOARD_MAX_DAYS = 366;

/** מספר הימים בטווח (כולל שני הקצוות) */
export function rangeDays(from: string, to: string): number {
  return (
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
  );
}

export function parseDashboardRange(input: Raw): { from: string; to: string } {
  const i = input ?? {};
  const from = isoDate(i["from"], "מתאריך");
  const to = isoDate(i["to"], "עד תאריך");
  if (to < from) throw new InputError("טווח התאריכים לא תקין");
  if (rangeDays(from, to) > DASHBOARD_MAX_DAYS) throw new InputError("אפשר להציג עד שנה אחת");
  return { from, to };
}

export function parseFinanceGrant(input: Raw): { userId: string; enabled: boolean } {
  const i = input ?? {};
  if (typeof i["enabled"] !== "boolean") throw new InputError("חסרים פרטים");
  return { userId: uuid(i["userId"], "המנהל"), enabled: i["enabled"] };
}
