// מיילים ולוח בקרה (Stage 2k) — מה ש-staff_emails / dashboard מחזירות (מיגרציה 18)
import type { BookingState } from "./bookings";

export type EmailFilter = "all" | "failed" | "waiting" | "sent";

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
}

export interface EmailList {
  counts: { failed: number; waiting: number; sent: number };
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
