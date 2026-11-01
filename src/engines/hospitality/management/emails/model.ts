// מסך המיילים — הסינונים, ו-?filter= בכתובת (קישור ישיר מ"דורש טיפול" בלוח הבקרה, שלב F3)
import type { EmailFilter } from "../../types/emails";

export const EMAIL_FILTERS: { key: EmailFilter; label: string }[] = [
  { key: "failed", label: "נכשלו" },
  { key: "waiting", label: "ממתינים" },
  { key: "sent", label: "נשלחו" },
  { key: "all", label: "הכול" },
];

export type EmailsSearch = { filter?: EmailFilter };
export function parseEmailsSearch(s: Record<string, unknown>): EmailsSearch {
  const filter = EMAIL_FILTERS.find((f) => f.key === s["filter"])?.key;
  return filter ? { filter } : {};
}
