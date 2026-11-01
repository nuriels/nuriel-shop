// אורחים (Stage 2j) — מה ש-staff_guests / staff_guest_detail מחזירות (מיגרציה 17)
import type { BookingState, Json } from "./bookings";

export interface GuestRow {
  id: string;
  name: string;
  anonymized: boolean;
  /** ממוסך תמיד ברשימה */
  phone: string | null;
  email: string | null;
  stays: number;
  last_stay: string | null;
  next_stay: string | null;
  has_notes: boolean;
  created_at: string;
}

export interface GuestList {
  q: string | null;
  limit: number;
  offset: number;
  total: number;
  items: GuestRow[];
}

export interface GuestDetail {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  marketing_consent: boolean;
  has_account: boolean;
  anonymized_at: string | null;
  created_at: string;
  updated_at: string;
  can_privacy: boolean;
  active_bookings: number;
  bookings: {
    id: string;
    number: number;
    status: BookingState;
    state: BookingState;
    check_in: string;
    check_out: string;
    nights: number;
    total: number;
    currency: string;
    unit_name: string;
  }[];
}

export type GuestExport = { [key: string]: Json };
