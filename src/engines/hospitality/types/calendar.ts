// לוח היומן (Stage 3a) — מה ש-calendar() מחזירה (מיגרציה 14). בלי פרטי קשר — רק שם האורח.
export type BookingStatus =
  | "pending_approval"
  | "pending_payment"
  | "confirmed"
  | "cancel_requested"
  | "checked_in"
  | "checked_out"
  | "cancelled"
  | "no_show";

export interface CalendarUnit {
  id: string;
  name: string;
  property_id: string;
  kind: "unit" | "room" | "whole_property";
  unit_type: string;
  is_active: boolean;
  member_ids: string[] | null;
  /** מיגרציה 43: הלילה האחרון שפתוח להזמנה באתר (כולל); null — עוד לא נפתחו תאריכים */
  open_until?: string | null;
}

export interface CalendarBooking {
  id: string;
  number: number;
  unit_id: string;
  check_in: string;
  check_out: string;
  status: BookingStatus;
  adults: number;
  children: number;
  total: number;
  source: string;
  channel: string | null;
  guest_name: string | null;
}

export interface CalendarBlock {
  id: string;
  unit_id: string;
  unit_name: string;
  start_date: string;
  end_date: string;
  reason: string | null;
  /** D3: נוצרה מסנכרון יומן חיצוני (iCal) */
  synced?: boolean;
  /** D3: הערוץ של היומן (airbnb / booking / vrbo / google / other) */
  channel?: string | null;
}

export interface CalendarView {
  from: string;
  to: string;
  today: string;
  weekend_nights: number[];
  currency: string;
  stamp: string;
  properties: { id: string; name: string }[];
  units: CalendarUnit[];
  bookings: CalendarBooking[];
  blocks: CalendarBlock[];
}

/** מיגרציה 43: פתיחת תאריכים — עד הלילה האחרון (כולל); null — סגירה */
export interface OpenDatesInput {
  unitIds: string[];
  until: string | null;
}

export interface OpenDatesResult {
  updated: number;
  units: { id: string; open_until: string | null }[];
}

export interface CalendarQuery {
  from: string;
  to: string;
  unitIds: string[] | null;
  includeCancelled: boolean;
}
