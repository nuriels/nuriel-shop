// מערכת התמיכה (שלב E4) — שמות, גוונים ועזרים טהורים, משותפים למסך העסק, לפאנל הפלטפורמה
// ולמיילים. בלי React (נבדק ביחידה).
import type {
  SupportPlan,
  SupportPriority,
  SupportStatus,
  SupportTicketRow,
  SupportTopic,
} from "../../types/support";
import type { Tone } from "../ui/tones";

export const TOPIC_LABEL: Record<SupportTopic, string> = {
  bookings: "הזמנות",
  payments: "תשלומים וחיובים",
  website: "האתר",
  calendar: "יומן וסנכרון",
  account: "החשבון והחבילה",
  technical: "תקלה טכנית",
  other: "אחר",
};

export const PRIORITY_LABEL: Record<SupportPriority, string> = {
  low: "נמוכה",
  normal: "רגילה",
  high: "גבוהה",
  urgent: "דחופה",
};

export const PRIORITY_HINT: Record<SupportPriority, string> = {
  low: "שאלה כללית, אין לחץ",
  normal: "צריך עזרה, אבל העסק עובד",
  high: "משהו חשוב לא עובד",
  urgent: "האתר / ההזמנות מושבתים",
};

export const PRIORITY_TONE: Record<SupportPriority, Tone> = {
  low: "neutral",
  normal: "info",
  high: "warning",
  urgent: "danger",
};

/** הסטטוס כפי שהעסק רואה אותו */
export const STATUS_LABEL: Record<SupportStatus, string> = {
  new: "חדשה",
  in_progress: "בטיפול",
  waiting_customer: "ממתינה לתשובת הלקוח",
  resolved: "נפתרה",
  closed: "נסגרה",
};

export const STATUS_TONE: Record<SupportStatus, Tone> = {
  new: "champagne",
  in_progress: "info",
  waiting_customer: "warning",
  resolved: "success",
  closed: "neutral",
};

/** לעסק: מה קורה עכשיו (שורה אחת מתחת לסטטוס) */
export const STATUS_HINT: Record<SupportStatus, string> = {
  new: "הפנייה התקבלה — נחזור אליכם בהקדם",
  in_progress: "צוות התמיכה מטפל בפנייה",
  waiting_customer: "ענינו — מחכים לתשובה שלכם",
  resolved: "סימנו שהבעיה נפתרה. משהו עדיין לא תקין? פשוט עונים כאן",
  closed: "הפנייה סגורה. אפשר לפתוח אותה מחדש",
};

/** זמן המענה לפי החבילה (כמו בפרטי החבילות של שלב E3) */
export const PLAN_SUPPORT: Record<SupportPlan, { title: string; text: string }> = {
  basic: { title: "תמיכה רגילה", text: "מענה תוך יום עסקים" },
  trial: { title: "תמיכה בתקופת הניסיון", text: "מענה תוך יום עסקים" },
  premium: { title: "תמיכה מועדפת", text: "מענה באותו יום + WhatsApp" },
};

export const isOpenStatus = (s: SupportStatus) => s !== "resolved" && s !== "closed";

/** "לפני 5 דקות" / "לפני 3 שעות" / "לפני יומיים" / תאריך */
export function agoText(iso: string | null, now = Date.now()): string {
  if (!iso) return "";
  const min = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  if (min < 1) return "עכשיו";
  if (min < 60) return min === 1 ? "לפני דקה" : `לפני ${min} דקות`;
  const h = Math.floor(min / 60);
  if (h < 24) return h === 1 ? "לפני שעה" : h === 2 ? "לפני שעתיים" : `לפני ${h} שעות`;
  const d = Math.floor(h / 24);
  if (d < 8) return d === 1 ? "אתמול" : d === 2 ? "לפני יומיים" : `לפני ${d} ימים`;
  return new Date(iso).toLocaleDateString("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "numeric",
    month: "numeric",
    year: "numeric",
  });
}

/** כמה זמן הפנייה ממתינה למענה (לפאנל הפלטפורמה): "3 שע'" / "2 ימים"; null — לא ממתינה */
export function waitingText(
  t: Pick<SupportTicketRow, "needs_reply" | "last_message_at">,
  now = Date.now(),
) {
  if (!t.needs_reply) return null;
  const h = Math.floor((now - Date.parse(t.last_message_at)) / 3_600_000);
  if (h < 1) return "פחות משעה";
  if (h < 24) return h === 1 ? "שעה" : `${h} שעות`;
  const d = Math.floor(h / 24);
  return d === 1 ? "יום" : `${d} ימים`;
}

/** ממתינה יותר מדי (לפי החבילה): פרימיום — 4 שעות, אחרות — 24 שעות */
export function isOverdue(
  t: Pick<SupportTicketRow, "needs_reply" | "last_message_at">,
  plan: SupportPlan,
  now = Date.now(),
): boolean {
  if (!t.needs_reply) return false;
  return now - Date.parse(t.last_message_at) > (plan === "premium" ? 4 : 24) * 3_600_000;
}

export const fileSizeText = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;

/** קישור WhatsApp (רק ספרות; 05… → 9725…) */
export function whatsappUrl(phone: string, text?: string): string {
  const digits = phone.replace(/[^0-9]/g, "");
  const intl = digits.startsWith("0") ? `972${digits.slice(1)}` : digits;
  return `https://wa.me/${intl}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** ?new=1 — לפתוח את טופס הפנייה החדשה */
export interface SupportSearch {
  new?: "1" | undefined;
}
export function parseSupportSearch(search: Record<string, unknown>): SupportSearch {
  return search["new"] === "1" || search["new"] === 1 ? { new: "1" } : {};
}

export type SupportTab = "open" | "done" | "all";
export const SUPPORT_TABS: readonly { key: SupportTab; label: string }[] = [
  { key: "open", label: "פתוחות" },
  { key: "done", label: "נפתרו ונסגרו" },
  { key: "all", label: "הכול" },
];
export function inTab(t: Pick<SupportTicketRow, "status">, tab: SupportTab): boolean {
  if (tab === "all") return true;
  return tab === "open" ? isOpenStatus(t.status) : !isOpenStatus(t.status);
}
