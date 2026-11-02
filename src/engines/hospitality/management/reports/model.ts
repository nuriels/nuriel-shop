// דוחות (שלב F7) — הכתובת (?preset / from / to / unit / source / status), התקופות המוכנות, השמות,
// והעמודות של כל ייצוא CSV. טהור (נבדק ביחידה).
import type {
  ReportBalance,
  ReportBooking,
  ReportCancellation,
  ReportPayment,
  ReportSource,
  ReportUnit,
} from "../../types/reports";
import type { DashboardSeriesPoint } from "../../types/dashboard";
import { REPORT_SOURCES, REPORT_STATUSES } from "../../validation/reports";
import { PAYMENT_KIND_LABELS, PAYMENT_METHOD_LABELS } from "../bookings/model";
import { BOOKING_SOURCE_LABELS, CHANNEL_LABELS, STATUS_LABELS } from "../calendar/model";
import { manageKeys } from "../lib/query-keys";
import type { CsvColumn } from "./csv";

export type ReportPreset =
  "this_month" | "last_month" | "last_30" | "last_90" | "this_year" | "custom";

export const PRESETS: readonly { key: ReportPreset; label: string }[] = [
  { key: "this_month", label: "החודש" },
  { key: "last_month", label: "החודש שעבר" },
  { key: "last_30", label: "30 הימים האחרונים" },
  { key: "last_90", label: "90 הימים האחרונים" },
  { key: "this_year", label: "השנה" },
  { key: "custom", label: "טווח אחר" },
];

export interface ReportsSearch {
  preset?: ReportPreset | undefined;
  from?: string | undefined;
  to?: string | undefined;
  unit?: string | undefined;
  source?: string | undefined;
  status?: string | undefined;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseReportsSearch(raw: Record<string, unknown>): ReportsSearch {
  const out: ReportsSearch = {};
  const p = raw["preset"];
  if (typeof p === "string" && PRESETS.some((x) => x.key === p)) out.preset = p as ReportPreset;
  for (const k of ["from", "to"] as const) {
    const v = raw[k];
    if (typeof v === "string" && DATE.test(v)) out[k] = v;
  }
  if (typeof raw["unit"] === "string" && UUID.test(raw["unit"]))
    out.unit = raw["unit"].toLowerCase();
  if (
    typeof raw["source"] === "string" &&
    (REPORT_SOURCES as readonly string[]).includes(raw["source"])
  )
    out.source = raw["source"];
  if (
    typeof raw["status"] === "string" &&
    (REPORT_STATUSES as readonly string[]).includes(raw["status"])
  )
    out.status = raw["status"];
  return out;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => iso(new Date(Date.UTC(y, m, d)));

/** הטווח של תקופה מוכנה (תאריכים כוללים), לפי "היום" של העסק */
export function presetRange(preset: ReportPreset, today: string): { from: string; to: string } {
  const d = new Date(`${today}T00:00:00Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (preset) {
    case "last_month":
      return { from: utc(y, m - 1, 1), to: utc(y, m, 0) };
    case "last_30":
      return { from: utc(y, m, d.getUTCDate() - 29), to: today };
    case "last_90":
      return { from: utc(y, m, d.getUTCDate() - 89), to: today };
    case "this_year":
      return { from: utc(y, 0, 1), to: utc(y, 11, 31) };
    default:
      return { from: utc(y, m, 1), to: utc(y, m + 1, 0) };
  }
}

/** הטווח שבתוקף: טווח אחר תקין (עד שנה), אחרת התקופה המוכנה (ברירת מחדל — החודש) */
export function effectiveRange(s: ReportsSearch, today: string): { from: string; to: string } {
  if (s.preset === "custom" && s.from && s.to && s.from <= s.to) {
    const days = (Date.parse(s.to) - Date.parse(s.from)) / 86_400_000 + 1;
    if (days <= 366) return { from: s.from, to: s.to };
  }
  return presetRange(s.preset && s.preset !== "custom" ? s.preset : "this_month", today);
}

export const reportsKey = (q: unknown) => [...manageKeys.all, "reports", q] as const;

export const sourceLabel = (source: string, channel?: string | null) =>
  source === "external" && channel
    ? (CHANNEL_LABELS[channel] ?? channel)
    : (BOOKING_SOURCE_LABELS[source] ?? source);

export const statusLabel = (s: string) => STATUS_LABELS[s as keyof typeof STATUS_LABELS] ?? s;

const HE_MONTHS = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
];
export const monthLabel = (isoDate: string) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return `${HE_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
export const dateLabel = (isoDate: string) => {
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`;
};

// ---------- עמודות הייצוא (כספים — רק כשיש הרשאה) ----------

const fin = <T>(on: boolean, cols: CsvColumn<T>[]) => (on ? cols : []);

export const monthColumns = (finance: boolean): CsvColumn<DashboardSeriesPoint>[] => [
  { label: "חודש", value: (r) => monthLabel(r.start) },
  { label: "הזמנות חדשות", value: (r) => r.bookings },
  ...fin<DashboardSeriesPoint>(finance, [{ label: "הכנסות", value: (r) => r.revenue }]),
  { label: "תפוסה %", value: (r) => r.occupancy },
];

export const seriesColumns = (finance: boolean): CsvColumn<DashboardSeriesPoint>[] => [
  { label: "מתאריך", value: (r) => r.start },
  { label: "ימים", value: (r) => r.days },
  { label: "הזמנות חדשות", value: (r) => r.bookings },
  ...fin<DashboardSeriesPoint>(finance, [{ label: "הכנסות", value: (r) => r.revenue }]),
  { label: "תפוסה %", value: (r) => r.occupancy },
];

export const sourceColumns = (finance: boolean): CsvColumn<ReportSource>[] => [
  { label: "מקור", value: (r) => sourceLabel(r.source, r.channel) },
  { label: "הזמנות חדשות", value: (r) => r.bookings },
  { label: "לילות בתקופה", value: (r) => r.nights },
  ...fin<ReportSource>(finance, [{ label: "הכנסות", value: (r) => r.revenue }]),
];

export const unitColumns = (finance: boolean): CsvColumn<ReportUnit>[] => [
  { label: "יחידה", value: (r) => r.name },
  { label: "מתחם", value: (r) => r.property },
  { label: "הזמנות", value: (r) => r.bookings },
  { label: "לילות שנמכרו", value: (r) => r.nights_sold },
  { label: "לילות תפוסים", value: (r) => r.occupied_nights },
  { label: "לילות זמינים", value: (r) => r.available_nights },
  { label: "תפוסה %", value: (r) => r.occupancy },
  ...fin<ReportUnit>(finance, [
    { label: "הכנסות", value: (r) => r.revenue },
    { label: "ממוצע ללילה", value: (r) => r.adr },
  ]),
];

export const cancellationColumns = (finance: boolean): CsvColumn<ReportCancellation>[] => [
  { label: "מספר הזמנה", value: (r) => r.number },
  { label: "יחידה", value: (r) => r.unit },
  { label: "סטטוס", value: (r) => statusLabel(r.status) },
  { label: "מקור", value: (r) => sourceLabel(r.source) },
  { label: "הגעה", value: (r) => r.check_in },
  { label: "עזיבה", value: (r) => r.check_out },
  { label: "בוטלה ב", value: (r) => r.cancelled_at.slice(0, 10) },
  ...fin<ReportCancellation>(finance, [{ label: "סכום ההזמנה", value: (r) => r.total }]),
];

export const paymentColumns: CsvColumn<ReportPayment>[] = [
  { label: "תאריך", value: (r) => r.paid_at },
  { label: "מספר הזמנה", value: (r) => r.number },
  { label: "יחידה", value: (r) => r.unit },
  { label: "סוג", value: (r) => PAYMENT_KIND_LABELS[r.kind] ?? r.kind },
  { label: "אמצעי תשלום", value: (r) => PAYMENT_METHOD_LABELS[r.method] ?? r.method },
  { label: "סכום", value: (r) => r.amount },
];

export const balanceColumns: CsvColumn<ReportBalance>[] = [
  { label: "מספר הזמנה", value: (r) => r.number },
  { label: "אורח", value: (r) => r.guest },
  { label: "יחידה", value: (r) => r.unit },
  { label: "הגעה", value: (r) => r.check_in },
  { label: "עזיבה", value: (r) => r.check_out },
  { label: "סכום ההזמנה", value: (r) => r.total },
  { label: "שולם", value: (r) => r.paid },
  { label: "יתרה", value: (r) => r.balance },
];

export const bookingColumns = (finance: boolean): CsvColumn<ReportBooking>[] => [
  { label: "מספר הזמנה", value: (r) => r.number },
  { label: "סטטוס", value: (r) => statusLabel(r.status) },
  { label: "מקור", value: (r) => sourceLabel(r.source, r.channel) },
  { label: "יחידה", value: (r) => r.unit },
  { label: "אורח", value: (r) => r.guest },
  { label: "הגעה", value: (r) => r.check_in },
  { label: "עזיבה", value: (r) => r.check_out },
  { label: "לילות", value: (r) => r.nights },
  { label: "מבוגרים", value: (r) => r.adults },
  { label: "ילדים", value: (r) => r.children },
  { label: "נוצרה", value: (r) => r.created_at.slice(0, 10) },
  ...fin<ReportBooking>(finance, [
    { label: "סכום", value: (r) => r.total },
    { label: "שולם", value: (r) => r.paid },
  ]),
];

/** סיכום לפי אמצעי תשלום */
export function paymentsByMethod(
  rows: readonly ReportPayment[],
): { method: string; total: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.method, (m.get(r.method) ?? 0) + r.amount);
  return [...m.entries()]
    .map(([method, total]) => ({ method, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total);
}
