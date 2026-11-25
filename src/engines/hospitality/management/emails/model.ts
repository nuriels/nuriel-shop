// מסך המיילים — הסינונים, ו-?filter= בכתובת (קישור ישיר מ"דורש טיפול" בלוח הבקרה, שלב F3)
// מיגרציה 206: מצב ההתראה על מייל שנכשל (חדש / נקרא / טופל / בוטל בכוונה) ומה אפשר לעשות בכל מצב.
import type { EmailAlertAction, EmailFilter, EmailRow } from "../../types/emails";

export const EMAIL_FILTERS: { key: EmailFilter; label: string }[] = [
  { key: "failed", label: "נכשלו" },
  { key: "handled", label: "טופלו" },
  { key: "waiting", label: "ממתינים" },
  { key: "sent", label: "נשלחו" },
  { key: "all", label: "הכול" },
];

export type EmailsSearch = { filter?: EmailFilter };
export function parseEmailsSearch(s: Record<string, unknown>): EmailsSearch {
  const filter = EMAIL_FILTERS.find((f) => f.key === s["filter"])?.key;
  return filter ? { filter } : {};
}

/**
 * מצב ההתראה של מייל שנכשל: new — עוד לא נקרא (נספר בפעמון ובתפריט); seen — נקרא, עוד לא טופל;
 * handled — טופל (לא מופיע ב"נכשלו" וב"דורש טיפול"); cancelled — המערכת ביטלה אותו בכוונה.
 * למייל שלא נכשל — null.
 */
export type AlertState = "new" | "seen" | "handled" | "cancelled";

export function alertState(row: Pick<EmailRow, "status" | "alert">): AlertState | null {
  if (row.status !== "failed" && row.status !== "dead") return null;
  // שרת ישן בלי מיגרציה 206 — כל מייל שנכשל הוא התראה חדשה (כמו קודם)
  const a = row.alert;
  if (!a) return "new";
  if (a.cancelled) return "cancelled";
  if (a.handled) return "handled";
  return a.seen ? "seen" : "new";
}

export const ALERT_STATE_LABEL: Record<AlertState, string> = {
  new: "חדש",
  seen: "נקרא",
  handled: "טופל",
  cancelled: "בוטל בכוונה",
};

/** מה אפשר לעשות בהתראה בכל מצב — "לשלוח שוב" לכל מייל שנכשל, חוץ ממייל שבוטל בכוונה */
export function alertActions(state: AlertState | null): {
  marks: EmailAlertAction[];
  resend: boolean;
} {
  switch (state) {
    case "new":
      return { marks: ["seen", "handled"], resend: true };
    case "seen":
      return { marks: ["handled"], resend: true };
    case "handled":
      return { marks: ["reopen"], resend: true };
    case "cancelled":
    case null:
      return { marks: [], resend: false };
  }
}

export const ALERT_ACTION_LABEL: Record<EmailAlertAction, string> = {
  seen: "סימון כנקרא",
  handled: "סימון כטופל",
  reopen: "החזרה להתראות",
};

export const ALERT_ACTION_DONE: Record<EmailAlertAction, string> = {
  seen: "סומן כנקרא — המספר בפעמון ירד",
  handled: 'סומן כטופל — ההתראה הוסרה. המייל נשאר בהיסטוריה ("טופלו")',
  reopen: 'ההתראה חזרה ל"נכשלו"',
};
