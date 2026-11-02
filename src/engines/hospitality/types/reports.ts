// דוחות וייצוא (שלב F7) — מה ש-reports_view מחזירה (מיגרציה 34). המספרים — אותו חישוב כמו בלוח
// הבקרה; כספים (null) — רק עם הרשאת reports.finance.
import type { DashboardNumbers, DashboardSeriesPoint } from "./dashboard";

export interface ReportSource {
  source: string;
  channel: string | null;
  bookings: number;
  nights: number;
  revenue: number | null;
}

export interface ReportUnit {
  unit_id: string;
  name: string;
  kind: "unit" | "room" | "whole_property";
  property: string;
  is_active: boolean;
  bookings: number;
  nights_sold: number;
  /** null — "כל המתחם" (התפוסה נמדדת ביחידות שלו) */
  occupied_nights: number | null;
  available_nights: number | null;
  occupancy: number | null;
  revenue: number | null;
  adr: number | null;
}

export interface ReportCancellation {
  booking_id: string;
  number: number;
  unit: string;
  status: string;
  source: string;
  check_in: string;
  check_out: string;
  cancelled_at: string;
  total: number | null;
}

export interface ReportPayment {
  id: string;
  paid_at: string;
  booking_id: string;
  number: number;
  unit: string;
  kind: string;
  method: string;
  /** החזר — במינוס */
  amount: number;
}

export interface ReportBalance {
  booking_id: string;
  number: number;
  unit: string;
  status: string;
  guest: string | null;
  check_in: string;
  check_out: string;
  total: number;
  paid: number;
  balance: number;
}

export interface ReportBooking {
  booking_id: string;
  number: number;
  status: string;
  source: string;
  channel: string | null;
  unit: string;
  guest: string | null;
  check_in: string;
  check_out: string;
  nights: number;
  adults: number;
  children: number;
  created_at: string;
  total: number | null;
  paid: number | null;
}

export interface ReportsView {
  period: { from: string; to: string; days: number; bucket: "day" | "week" | "month" };
  currency: string;
  finance: boolean;
  guests: boolean;
  units: number;
  summary: DashboardNumbers;
  series: DashboardSeriesPoint[];
  months: DashboardSeriesPoint[];
  sources: ReportSource[];
  by_unit: ReportUnit[];
  cancellations: ReportCancellation[];
  payments: ReportPayment[] | null;
  balances: ReportBalance[] | null;
  bookings: ReportBooking[];
  /** כמה שורות לכל היותר בכל רשימה */
  limit: number;
}
