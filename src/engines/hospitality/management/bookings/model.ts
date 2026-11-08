// הזמנות (Stage 2h) — טקסטים וחישובים בלי React: לשוניות, מצבים, מקור, ספירה לאחור לאישור,
// מה אפשר לעשות עכשיו, ותיאור האירועים בהיסטוריה.
import type { BookingDetail, BookingRow, BookingState, BookingTab } from "../../types/bookings";
import type { BookingPayments, PaymentKind } from "../../types/payments";
import { manageKeys } from "../lib/query-keys";
import type { Json } from "../../types/domain";

export const bookingsKey = (tab: BookingTab, q: string) =>
  [...manageKeys.all, "bookings", tab, q] as const;
export const bookingKey = (id: string) => [...manageKeys.all, "booking", id] as const;
/** יומן התשלומים של הזמנה (יתרה / החזר) — מתעדכן גם אחרי אישור, ביטול או שינוי של ההזמנה */
export const paymentsKey = (id: string) => [...manageKeys.all, "payments", id] as const;
export const proofsKey = (id: string) => [...manageKeys.all, "proofs", id] as const;

export const TABS: { key: Exclude<BookingTab, "all">; label: string; empty: string }[] = [
  { key: "pending", label: "ממתינות לטיפול", empty: "אין בקשות שממתינות לאישור." },
  { key: "upcoming", label: "קרובות", empty: "אין הזמנות קרובות." },
  { key: "staying", label: "שוהים עכשיו", empty: "אין אורחים שוהים עכשיו." },
  { key: "past", label: "עבר", empty: "אין עדיין הזמנות שהסתיימו." },
  { key: "cancelled", label: "בוטלו", empty: "אין הזמנות שבוטלו." },
];

/** ?tab= / ?q= בכתובת (קישור ישיר ללשונית מ"דורש טיפול", חיפוש מהיר מהסרגל העליון) */
export type BookingsSearch = { tab?: Exclude<BookingTab, "all">; q?: string };
export function parseBookingsSearch(s: Record<string, unknown>): BookingsSearch {
  const tab = TABS.find((t) => t.key === s["tab"])?.key;
  const q = typeof s["q"] === "string" ? s["q"].trim().slice(0, 100) : "";
  return { ...(tab ? { tab } : {}), ...(q ? { q } : {}) };
}

export const STATE_LABELS: Record<BookingState, string> = {
  pending_approval: "ממתינה לאישור",
  pending_payment: "ממתינה לתשלום",
  confirmed: "מאושרת",
  cancel_requested: "האורח ביקש לבטל",
  checked_in: "שוהים עכשיו",
  checked_out: "עזבו",
  declined: "נדחתה",
  cancelled: "בוטלה",
  expired: "פג תוקף",
  no_show: "לא הגיעו",
};
export type Tone = "warn" | "ok" | "info" | "muted" | "bad";
export const stateTone = (s: BookingState): Tone =>
  s === "pending_approval" || s === "pending_payment" || s === "cancel_requested"
    ? "warn"
    : s === "confirmed"
      ? "ok"
      : s === "checked_in"
        ? "info"
        : s === "checked_out"
          ? "muted"
          : "bad";

export const TONE_CLASS: Record<Tone, string> = {
  warn: "bg-amber-100 text-amber-950",
  ok: "bg-emerald-100 text-emerald-900",
  info: "bg-sky-100 text-sky-900",
  muted: "bg-muted text-muted-foreground",
  bad: "bg-rose-100 text-rose-900",
};

export const SOURCE_LABELS: Record<BookingRow["source"], string> = {
  site: "האתר",
  phone: "טלפון",
  walk_in: "הגיעו למקום",
  owner: "הבעלים",
  external: "ערוץ חיצוני",
};
export const sourceText = (b: Pick<BookingRow, "source" | "channel">) =>
  b.channel ? `${SOURCE_LABELS[b.source]} · ${b.channel}` : SOURCE_LABELS[b.source];

export const PAYMENT_LABELS: Record<BookingRow["payment_status"], string> = {
  unpaid: "לא שולם",
  deposit_paid: "שולמה מקדמה",
  paid: "שולם",
};

const toDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const DAY_SHORT = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
export const dayText = (iso: string) => {
  const d = toDate(iso);
  return `${DAY_SHORT[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`;
};
export const stayText = (b: Pick<BookingRow, "check_in" | "check_out" | "nights">) =>
  `${dayText(b.check_in)} – ${dayText(b.check_out)} · ${b.nights === 1 ? "לילה אחד" : `${b.nights} לילות`}`;
export const guestsText = (b: Pick<BookingRow, "adults" | "children">) =>
  `${b.adults} מבוגרים${b.children ? `, ${b.children} ילדים` : ""}`;
export const dateTimeText = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("he-IL", {
        timeZone: "Asia/Jerusalem",
        day: "numeric",
        month: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

/** "נשארו 5 שעות ו-20 דקות לאישור" — או "הזמן לאישור עבר" */
export function holdText(holdExpiresAt: string | null, now = Date.now()): string | null {
  if (!holdExpiresAt) return null;
  const ms = Date.parse(holdExpiresAt) - now;
  if (ms <= 0) return "הזמן לאישור עבר";
  const minutes = Math.ceil(ms / 60000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `נשארו ${m} דקות לאישור`;
  return `נשארו ${h === 1 ? "שעה" : `${h} שעות`}${m ? ` ו-${m} דקות` : ""} לאישור`;
}

/** מה אפשר לעשות עכשיו (המסד בודק שוב — כאן רק אילו כפתורים להציג) */
export function actionsFor(b: Pick<BookingDetail, "state" | "check_in" | "today">) {
  const arrived = b.today >= b.check_in;
  return {
    approve: b.state === "pending_approval",
    decline: b.state === "pending_approval",
    checkIn: b.state === "confirmed" && arrived,
    noShow: b.state === "confirmed" && arrived,
    checkOut: b.state === "checked_in",
  };
}

const EVENT_STATUS_TEXT: Partial<Record<string, string>> = {
  pending_approval: "בקשה חדשה — ממתינה לאישור",
  pending_payment: "ממתינה לתשלום",
  confirmed: "ההזמנה אושרה",
  declined: "הבקשה נדחתה",
  expired: "פג תוקף הבקשה",
  cancel_requested: "האורח ביקש לבטל",
  cancelled: "ההזמנה בוטלה",
  checked_in: "האורחים הגיעו",
  checked_out: "האורחים עזבו",
  no_show: "האורחים לא הגיעו",
};
/** מיגרציה 65: אילו פרטי לקוח תוקנו (בהיסטוריה — אימייל וטלפון ממוסכים בלבד) */
const CUSTOMER_FIELD_TEXT: Record<string, string> = {
  full_name: "שם",
  phone: "טלפון",
  email: "אימייל",
};
function customerChangeText(changes: { [key: string]: Json } | undefined): string {
  const fields = Array.isArray(changes?.["fields"]) ? (changes["fields"] as Json[]) : [];
  const names = fields.map((f) => CUSTOMER_FIELD_TEXT[String(f)]).filter(Boolean);
  const email = changes?.["email"];
  const moved = changes?.["guest_changed"] === true;
  let text = names.length ? `פרטי הלקוח תוקנו: ${names.join(", ")}` : "פרטי הלקוח תוקנו";
  if (email && typeof email === "object" && !Array.isArray(email)) {
    const from = typeof email["from"] === "string" ? email["from"] : "—";
    const to = typeof email["to"] === "string" ? email["to"] : "בלי אימייל";
    text += ` (${from} ← ${to})`;
  }
  return moved ? `${text} · רק בהזמנה הזו (כרטיס לקוח אחר)` : text;
}

export function eventText(e: {
  kind: string;
  from: string | null;
  to: string | null;
  changes?: { [key: string]: Json };
}): string {
  if (e.kind === "customer_updated") return customerChangeText(e.changes);
  if (e.kind === "details_sent") {
    const email = e.changes?.["email"];
    return `פרטי ההזמנה וקישור אישי חדש נשלחו ללקוח${typeof email === "string" ? ` (${email})` : ""}`;
  }
  if (e.kind === "created")
    return e.to === "confirmed"
      ? "ההזמנה נוצרה ואושרה"
      : (EVENT_STATUS_TEXT[e.to ?? ""] ?? "ההזמנה נוצרה");
  if (e.kind === "modified") return "ההזמנה שונתה";
  if (e.kind === "policy_accepted") return "תנאי הביטול אושרו";
  if (e.kind === "payment_recorded") return "נרשם תשלום";
  if (e.kind === "refund_recorded") return "נרשם החזר";
  if (e.kind === "payment_voided") return "רישום תשלום בוטל";
  // שלב א' 5: העברה בנקאית
  if (e.kind === "payment_method_chosen") return "האורח בחר אמצעי תשלום";
  if (e.kind === "payment_proof_submitted") return "האורח העלה אישור העברה";
  if (e.kind === "payment_proof_rejected") return "אישור ההעברה נדחה";
  if (e.to && e.to !== e.from) return EVENT_STATUS_TEXT[e.to] ?? `${e.from ?? ""} ← ${e.to}`;
  return e.kind.replace(/_/g, " ");
}
export const ACTOR_TEXT = { guest: "האורח", staff: "צוות", system: "המערכת" } as const;

export const EMAIL_STATUS: Record<string, string> = {
  queued: "בתור לשליחה",
  sending: "נשלח עכשיו",
  sent: "נשלח",
  failed: "נכשל — ננסה שוב",
  dead: "נכשל",
};

/** שם המייל לפי האירוע (מסך המיילים וכרטיס ההזמנה) */
export const EMAIL_EVENT: Record<string, string> = {
  request_received: "לאורח: הבקשה התקבלה",
  booking_confirmed: "לאורח: ההזמנה אושרה",
  booking_declined: "לאורח: הבקשה לא אושרה",
  request_expired: "לאורח: הבקשה פגה",
  booking_cancelled: "לאורח: ההזמנה בוטלה",
  cancellation_received: "לאורח: בקשת הביטול התקבלה",
  cancellation_declined: "לאורח: בקשת הביטול לא אושרה",
  new_request: "לעסק: בקשה חדשה",
  new_booking: "לעסק: הזמנה חדשה",
  approval_reminder: "לעסק: תזכורת לאישור",
  request_expired_owner: "לעסק: בקשה פגה",
  cancellation_requested: "לעסק: בקשת ביטול",
  cancelled_by_guest: "לעסק: האורח ביטל",
  request_withdrawn: "לעסק: הבקשה נמשכה",
  channel_conflict: "לעסק: התנגשות ביומן חיצוני",
  support_reply: "לעסק: תשובה מהתמיכה",
  open_dates_reminder: "לעסק: תזכורת לפתיחת תאריכים",
  group_request_received: "לאורח: בקשה לכמה חדרים התקבלה",
  group_booking_confirmed: "לאורח: ההזמנה לכמה חדרים אושרה",
  group_booking_declined: "לאורח: הבקשה לכמה חדרים לא אושרה",
  new_group_request: "לעסק: בקשה חדשה לכמה חדרים",
  new_group_booking: "לעסק: הזמנה חדשה לכמה חדרים",
  booking_details: "לאורח: פרטי ההזמנה וקישור אישי חדש",
};

/** סוגי תשלום ואמצעי תשלום (כרטיס התשלומים, הדוחות) */
export const PAYMENT_KIND_LABELS: Record<string, string> = {
  deposit: "מקדמה",
  balance: "יתרה",
  full: "תשלום מלא",
  refund: "החזר",
  other: "אחר",
};
/**
 * מה סביר שנרשם עכשיו (ברירת המחדל בטופס הרישום) — כדי שתשלום מלא לא יירשם בטעות כ"מקדמה":
 * החזר שמגיע לאורח → החזר; עוד לא שולם כלום ויש מקדמה קטנה מהסכום → המקדמה; עוד לא שולם כלום →
 * תשלום מלא; כבר שולם חלק → היתרה. בעל העסק יכול לשנות לפני הרישום.
 */
export function suggestedPayment(
  p: Pick<BookingPayments, "deposit_amount" | "amount_paid" | "balance_due" | "refund_due">,
): { kind: PaymentKind; amount: number } {
  const n = (v: number) => Number(v) || 0;
  if (n(p.refund_due) > 0) return { kind: "refund", amount: n(p.refund_due) };
  const due = n(p.balance_due);
  if (n(p.amount_paid) <= 0) {
    const deposit = n(p.deposit_amount);
    return deposit > 0 && deposit < due
      ? { kind: "deposit", amount: deposit }
      : { kind: "full", amount: due };
  }
  return { kind: "balance", amount: due };
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: "מזומן",
  transfer: "העברה בנקאית",
  bit: "Bit",
  card: "כרטיס אשראי (במסוף העסק)",
  check: "צ'ק",
  provider: "סליקה מקוונת",
  other: "אחר",
};
