// אירועים במתחם (מיגרציה 63) — מה שהמסד מחזיר לאזור הניהול. נפרד מהזמנות הלינה.
import type { Json } from "./domain";

export const EVENT_TYPES = [
  "bridal_shower",
  "bar_mitzvah",
  "birthday",
  "private_party",
  "family_event",
  "other",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  bridal_shower: "מסיבת כלה",
  bar_mitzvah: "בר מצווה",
  birthday: "יום הולדת",
  private_party: "מסיבה פרטית",
  family_event: "אירוע משפחתי",
  other: "אחר",
};

/** past — מאושר שכבר הסתיים (עוד לא סומן "הסתיים") */
export type EventStatus = "pending" | "confirmed" | "cancelled" | "completed" | "past";
export type StoredEventStatus = Exclude<EventStatus, "past">;
export type DepositStatus = "pending" | "held" | "returned" | "charged";
export type EventPaymentStatus = "unpaid" | "partial" | "advance_paid" | "paid";
export type EventTab = "upcoming" | "pending" | "past" | "cancelled" | "all";

export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  pending: "ממתין לאישור",
  confirmed: "מאושר",
  cancelled: "בוטל",
  completed: "הסתיים",
  past: "עבר (לסמן הסתיים)",
};
export const DEPOSIT_STATUS_LABEL: Record<DepositStatus, string> = {
  pending: "עוד לא התקבל",
  held: "התקבל ומוחזק",
  returned: "הוחזר",
  charged: "חויב (נזק / איחור)",
};
export const PAYMENT_STATUS_LABEL: Record<EventPaymentStatus, string> = {
  unpaid: "לא שולם",
  partial: "שולם חלקית",
  advance_paid: "המקדמה שולמה",
  paid: "שולם במלואו",
};

export interface EventCustomer {
  guest_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  anonymized: boolean;
}

export interface StaffEvent {
  id: string;
  number: number;
  property_id: string;
  property_name: string | null;
  customer: EventCustomer | null;
  event_type: EventType;
  event_type_other: string | null;
  event_type_label: string;
  event_date: string;
  start_time: string;
  end_time: string;
  starts_at: string;
  ends_at: string;
  ends_next_day: boolean;
  outside_pool_hours: boolean;
  participants: number;
  price: number;
  advance_amount: number;
  amount_paid: number;
  balance_due: number;
  payment_status: EventPaymentStatus;
  deposit_amount: number;
  deposit_status: DepositStatus;
  late_fee_per_hour: number;
  status: EventStatus;
  stored_status: StoredEventStatus;
  cancel_reason: string | null;
  cancelled_at: string | null;
  lodging_ack: boolean;
  internal_notes: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface LodgingOverlap {
  booking_id: string;
  number: number;
  unit_name: string;
  status: string;
  check_in: string;
  check_out: string;
}

export interface EventConflict {
  event_id: string;
  number: number;
  event_type: string;
  event_date: string;
  start_time: string;
  end_time: string;
  status: StoredEventStatus;
}

export interface EventLogEntry {
  id: number;
  kind: string;
  from_status: string | null;
  to_status: string | null;
  actor_kind: "guest" | "staff" | "system";
  changes: { [key: string]: Json };
  note: string | null;
  at: string;
}

export interface BusinessTerms {
  representative_name: string | null;
  business_tax_id: string | null;
  /** החתימה של הנציג המורשה (צד א') — קווים בלבד, כמו חתימת הלקוח */
  representative_signature: string[] | null;
  facilities: string;
  facilities_definite: string;
  /** סעיף 1 בחוזה האירוח; unit_id — כדי לסמן בחוזה את היחידות שהוזמנו */
  unit_lines: { unit_id?: string | null; name: string; description: string }[];
  max_lodging_guests: number;
  max_event_guests: number;
  pool_open_time: string;
  pool_close_time: string;
  deposit_amount: number;
  event_late_fee_per_hour: number;
  lodging_late_fee_per_hour: number;
  free_cancellation_days: number;
  confirmed: boolean;
  confirmed_at: string | null;
  revision: number;
  saved: boolean;
}

export interface BusinessTermsView extends BusinessTerms {
  units: {
    id: string;
    name: string;
    property_id: string | null;
    max_adults: number | null;
    max_children: number | null;
    capacity: number | null;
  }[];
  can_edit: boolean;
  can_confirm: boolean;
}

export interface EventList {
  rows: StaffEvent[];
  total: number;
  counts: Record<EventTab, number>;
  properties: { id: string; name: string }[];
  terms: BusinessTerms;
}

export interface EventDetail extends StaffEvent {
  lodging: LodgingOverlap[];
  conflicts: EventConflict[];
  terms: BusinessTerms;
  log: EventLogEntry[];
}

export interface EventCheck {
  conflicts: EventConflict[];
  lodging: LodgingOverlap[];
  outside_pool_hours: boolean;
  ends_next_day: boolean;
  max_event_guests: number;
  pool_open_time: string;
  pool_close_time: string;
}

/** הקלט של טופס האירוע (יצירה / עדכון) — אותם שמות כמו במסד */
export interface EventInput {
  property_id?: string;
  guest_id?: string;
  customer?: { full_name: string; phone: string; email: string | null };
  event_type?: EventType;
  event_type_other?: string | null;
  event_date?: string;
  start_time?: string;
  end_time?: string;
  participants?: number;
  price?: number;
  advance_amount?: number | null;
  amount_paid?: number | null;
  deposit_amount?: number;
  deposit_status?: DepositStatus;
  internal_notes?: string | null;
  status?: "pending" | "confirmed";
  lodging_ack?: boolean;
}
