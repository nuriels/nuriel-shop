// הזמנות לצוות (Stage 2h) — מה ש-staff_bookings / staff_booking_detail מחזירות (מיגרציה 16)
import type { PackageSnapshot } from "./packages";
/** ערך JSON (מה שהמסד מחזיר בשדות גמישים) */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type BookingTab = "pending" | "upcoming" | "staying" | "past" | "cancelled" | "all";
export type BookingState =
  | "pending_approval"
  | "pending_payment"
  | "confirmed"
  | "cancel_requested"
  | "checked_in"
  | "checked_out"
  | "declined"
  | "cancelled"
  | "expired"
  | "no_show";

export interface BookingRow {
  id: string;
  number: number;
  status: BookingState;
  /** כמו status, אבל ממתינה שהחלון שלה עבר = expired */
  state: BookingState;
  tab: Exclude<BookingTab, "all">;
  check_in: string;
  check_out: string;
  nights: number;
  adults: number;
  children: number;
  total: number;
  currency: string;
  payment_status: "unpaid" | "deposit_paid" | "paid";
  amount_paid: number;
  source: "site" | "phone" | "walk_in" | "owner" | "external";
  channel: string | null;
  revision: number;
  created_at: string;
  hold_expires_at: string | null;
  cancellation_requested_at: string | null;
  unit_id: string;
  unit_name: string;
  property_name: string;
  guest_name: string;
  /** תמיד ממוסך ברשימה */
  guest_phone: string | null;
  guest_email: string | null;
}

export interface BookingList {
  tab: BookingTab;
  q: string | null;
  today: string;
  total: number;
  limit: number;
  offset: number;
  counts: Record<BookingTab, number>;
  items: BookingRow[];
}

export interface BookingEvent {
  kind: string;
  from: string | null;
  to: string | null;
  actor_kind: "guest" | "staff" | "system";
  actor: string | null;
  note: string | null;
  changes: { [key: string]: Json };
  at: string;
}

export interface BookingEmail {
  id: string;
  event: string;
  recipient_kind: string;
  recipient: string | null;
  status: string;
  attempts: number;
  has_error: boolean;
  created_at: string;
  sent_at: string | null;
}

export interface PolicySnapshotRules {
  free_cancel_days?: number;
  fee_tiers?: { from_days: number; fee: string; value?: number }[];
  no_show_fee?: string;
  deposit_kind?: string;
  deposit_value?: number;
  [k: string]: Json | undefined;
}

export interface BookingDetail {
  id: string;
  number: number;
  status: BookingState;
  state: BookingState;
  tab: Exclude<BookingTab, "all">;
  today: string;
  revision: number;
  check_in: string;
  check_out: string;
  nights: number;
  adults: number;
  children: number;
  unit: { id: string; name: string; kind: string; property_name: string };
  currency: string;
  subtotal: number;
  discount: number;
  total: number;
  deposit_amount: number;
  amount_paid: number;
  payment_status: "unpaid" | "deposit_paid" | "paid";
  price_manual: boolean;
  /** שלב א' 7 (מיגרציה 59): הזמנת חבילה — החבילה כפי שהאורח הזמין; null — הזמנה רגילה */
  package?: PackageSnapshot | null;
  source: BookingRow["source"];
  channel: string | null;
  created_at: string;
  updated_at: string;
  hold_expires_at: string | null;
  special_requests: string | null;
  notes: string | null;
  cancellation_requested_at: string | null;
  cancellation_reason: string | null;
  cancellation_outcome: { [key: string]: Json } | null;
  policy: { name?: string; version?: number; rules?: PolicySnapshotRules; deposit_amount?: number };
  policy_schedule: { from_days?: number; until?: string; fee?: number; refund?: number }[] | null;
  house_rules: { [key: string]: Json } | null;
  guest: {
    id: string;
    name: string;
    anonymized: boolean;
    contact_full: boolean;
    phone: string | null;
    email: string | null;
    bookings_count: number;
  };
  nights_detail: {
    night: string;
    base_rate: number;
    extras: number;
    price: number;
    rule: string;
  }[];
  events: BookingEvent[];
  emails: BookingEmail[];
}

export type StayStatus = "checked_in" | "checked_out" | "no_show";

/** מה שהמסד מחזיר אחרי שינוי / ביטול / החלטה */
export interface BookingChange {
  booking_id: string;
  status: string;
  revision: number;
  total?: number;
  fee?: number;
}
