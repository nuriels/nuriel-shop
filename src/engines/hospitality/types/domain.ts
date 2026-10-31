// טיפוסי התחום של Hospitality (מה שהפונקציות במסד מחזירות — מיגרציות 3–6)

/** ערך JSON (מה שהמסד מחזיר ב-jsonb) */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export const BOOKING_STATUSES = [
  "pending_approval",
  "pending_payment",
  "confirmed",
  "cancel_requested",
  "checked_in",
  "checked_out",
  "declined",
  "cancelled",
  "expired",
  "no_show",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export type StayStatus = "checked_in" | "checked_out" | "no_show";
export type ManualBookingSource = "phone" | "walk_in" | "owner" | "external";

export interface QuoteNight {
  night: string;
  base_rate: number;
  extras: number;
  price: number;
  rule_applied: "base" | "weekday" | "weekend" | "season" | "holiday" | "manual";
  rule_id: string | null;
}

export interface SchedulePeriod {
  from: string | null;
  until: string | null;
  fee: number;
  kind: string;
}

export interface PolicySnapshot {
  policy_id: string;
  version: number;
  name: string;
  rules: JsonObject;
  timezone: string;
  check_in_time: string;
  currency: string;
  total: number;
  deposit_amount: number;
  schedule: {
    arrival: string;
    free_until: string | null;
    periods: SchedulePeriod[];
    no_show_fee: number;
    total: number;
    deposit_amount: number;
  };
}

export interface Quote {
  available: boolean;
  unit_id: string;
  unit_name: string;
  unit_kind: string;
  check_in: string;
  check_out: string;
  nights_count: number;
  adults: number;
  children: number;
  min_nights: number;
  nights: QuoteNight[];
  subtotal: number;
  discount: number;
  promotion_id: string | null;
  total: number;
  currency: string;
  deposit_amount: number;
  policy: PolicySnapshot;
  policy_hash: string;
}

export interface BookingRequestResult {
  booking_id: string;
  number: number;
  status: BookingStatus;
  duplicate: boolean;
  hold_expires_at: string | null;
  total: number;
  currency: string;
  /** מוחזר פעם אחת בלבד (במסד נשמר רק ה-hash); null בחזרה על אותה בקשה */
  manage_token: string | null;
}

export interface GuestBookingView {
  id: string;
  number: number;
  status: BookingStatus;
  unit_name: string;
  check_in: string;
  check_out: string;
  nights: number;
  adults: number;
  children: number;
  total: number;
  currency: string;
  deposit_amount: number;
  amount_paid: number;
  hold_expires_at: string | null;
  policy: PolicySnapshot;
  cancellation_outcome: JsonObject | null;
  can_request_cancellation: boolean;
}

export interface CancellationQuote {
  fee: number;
  refund_due: number;
  charge_due: number;
  result: "cancelled" | "cancel_requested";
  computed_at: string;
}

export interface StaffActionResult {
  booking_id: string;
  status: BookingStatus;
  revision: number;
  [key: string]: Json;
}

export interface Entitlements {
  plan: string;
  plan_name: string;
  status: "trialing" | "active" | "past_due" | "canceled" | "expired";
  active: boolean;
  implicit: boolean;
  trial_ends_at: string | null;
  current_period_end: string | null;
  max_units: number | null;
  extra_units: number;
  units_used: number;
  features: JsonObject;
}
