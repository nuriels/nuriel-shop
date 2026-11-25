// מיילים ולוח בקרה (Stage 2k) — מה ש-staff_emails / dashboard מחזירות (מיגרציה 18)
import type { BookingState } from "./bookings";

/** "handled" — מיילים שנכשלו וההתראה עליהם טופלה, או שהמערכת ביטלה בכוונה (מיגרציה 206) */
export type EmailFilter = "all" | "failed" | "handled" | "waiting" | "sent";

/**
 * ההתראה על מייל שנכשל (מיגרציה 206) — נפרדת מהמייל עצמו: הסימון לא משנה את הסטטוס, הניסיונות,
 * השגיאה או ההיסטוריה של המייל, רק את מה שמוצג לבעל העסק.
 */
export interface EmailAlert {
  /** סומן "נקרא" — לא נספר במספר שבפעמון ובתפריט */
  seen: boolean;
  /** סומן "טופל" — יוצא מ"נכשלו" ומ"דורש טיפול" (ועובר ל"טופלו") */
  handled: boolean;
  handled_at: string | null;
  /** המערכת ביטלה את המייל בכוונה (פרטי הלקוח נמחקו / כתובת המייל תוקנה) — אין מה לטפל ולא שולחים שוב */
  cancelled: boolean;
}

/** "נקרא" / "טופל" / "להחזיר להתראות" */
export type EmailAlertAction = "seen" | "handled" | "reopen";

export interface EmailRow {
  id: string;
  event: string;
  recipient_kind: "guest" | "owner";
  recipient: string | null;
  status: "queued" | "sending" | "sent" | "failed" | "dead";
  attempts: number;
  has_error: boolean;
  next_attempt_at: string | null;
  created_at: string;
  sent_at: string | null;
  booking_id: string | null;
  booking_number: number | null;
  /** רק למייל שנכשל (failed / dead); לשאר — null */
  alert: EmailAlert | null;
}

export interface EmailList {
  /** failed — התראות פתוחות בלבד; handled — טופלו או בוטלו בכוונה */
  counts: { failed: number; handled: number; waiting: number; sent: number };
  items: EmailRow[];
}

export interface DashboardNumbers {
  today: string;
  units: number;
  arrivals_today: number;
  departures_today: number;
  staying: number;
  pending: number;
  cancel_requests: number;
  failed_emails: number;
  occupied_tonight: number;
  blocked_tonight: number;
  occupancy_7: number;
  occupancy_30: number;
  revenue_month: number;
  currency: string;
  recent: {
    id: string;
    number: number;
    status: BookingState;
    state: BookingState;
    guest_name: string;
    unit_name: string;
    check_in: string;
    check_out: string;
    total: number;
    created_at: string;
  }[];
}
