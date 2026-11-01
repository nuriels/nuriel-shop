// לוח התפוסה של לוח הבקרה (שלב F3) — טהור, נבדק ביחידה. מעל מה ש-calendar() מחזירה:
//   • שורה לכל יחידה פיזית פעילה; הזמנה של "כל המתחם" מופיעה על כל יחידה שבו;
//   • פס לכל הזמנה (ישירה / מערוץ / ממתינה) ולכל חסימה (מסונכרנת מ-Airbnb / Booking, או פנימית);
//   • תפוסה לכל לילה — אותו כלל כמו במסד (dashboard_overview): הזמנות מאושרות ותאריכים מסונכרנים
//     נספרים כתפוסים, כל לילה-יחידה פעם אחת; חסימה פנימית מורידה זמינות ולא נספרת כלינה;
//     בקשה שממתינה לאישור — לא נספרת עד שתאושר.
import type { CalendarView } from "../../types/calendar";
import { addDays } from "./model";

/** כמה לילות מוצגים בלוח של לוח הבקרה */
export const BOARD_DAYS = 14;

export type BoardKind = "direct" | "airbnb" | "booking" | "channel" | "pending" | "block";

export const BOARD_KIND_LABELS: Record<BoardKind, string> = {
  direct: "הזמנה ישירה",
  airbnb: "Airbnb",
  booking: "Booking.com",
  channel: "ערוץ אחר",
  pending: "ממתינה לאישור",
  block: "חסימה פנימית",
};

export interface BoardBar {
  key: string;
  kind: BoardKind;
  /** מהיום הראשון בלוח (0) */
  start: number;
  span: number;
  /** ממשיך מלפני / אחרי הלוח */
  clippedStart: boolean;
  clippedEnd: boolean;
  /** "נועה ל." / "Airbnb" / "שיפוץ" */
  label: string;
  /** הזמנה של "כל המתחם" שמופיעה על יחידה שבו */
  via: boolean;
  bookingId: string | null;
  bookingNumber: number | null;
}

export interface BoardRow {
  id: string;
  name: string;
  bars: BoardBar[];
}

export interface BoardDay {
  date: string;
  /** 0 = ראשון */
  dow: number;
  today: boolean;
  /** לילה של סוף שבוע (לפי הגדרות העסק) */
  weekend: boolean;
}

export interface BoardNight {
  date: string;
  occupied: number;
  available: number;
  /** אחוז שלם; null — אין יחידות זמינות בלילה הזה */
  pct: number | null;
}

export interface BoardModel {
  days: BoardDay[];
  rows: BoardRow[];
  nights: BoardNight[];
}

const HOLDS = new Set(["confirmed", "cancel_requested", "checked_in", "checked_out"]);
const PENDING = new Set(["pending_approval", "pending_payment"]);

const dayIndex = (from: string, date: string) =>
  Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** "נועה לוי" → "נועה ל." (בלוח — בלי שמות מלאים) */
export function shortGuestName(full: string | null | undefined): string {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "אורח";
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${parts[parts.length - 1]![0]}.`;
}

/** הערוץ לפי השם שנרשם / הערוץ של היומן */
export function channelKind(channel: string | null | undefined): BoardKind {
  const c = (channel ?? "").toLowerCase();
  if (c.includes("airbnb")) return "airbnb";
  if (c.includes("booking")) return "booking";
  return "channel";
}

export function boardModel(view: CalendarView, from: string, days: number): BoardModel {
  const to = addDays(from, days);
  const dayList: BoardDay[] = Array.from({ length: days }, (_, i) => {
    const date = addDays(from, i);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    return {
      date,
      dow,
      today: date === view.today,
      weekend: view.weekend_nights.includes(dow),
    };
  });

  const physical = view.units.filter((u) => u.is_active && u.kind !== "whole_property");
  const ids = new Set(physical.map((u) => u.id));
  const membersOf = new Map(view.units.map((u) => [u.id, u.member_ids ?? []]));
  /** היחידות הפיזיות שהזמנה / חסימה על היחידה הזו תופסת */
  const targets = (unitId: string): { id: string; via: boolean }[] => {
    const members = membersOf.get(unitId) ?? [];
    if (members.length) return members.filter((m) => ids.has(m)).map((m) => ({ id: m, via: true }));
    return ids.has(unitId) ? [{ id: unitId, via: false }] : [];
  };
  const geo = (start: string, end: string) => {
    const s = Math.max(0, dayIndex(from, start));
    const e = Math.min(days, dayIndex(from, end));
    if (e <= s) return null;
    return { start: s, span: e - s, clippedStart: start < from, clippedEnd: end > to };
  };

  const bars = new Map<string, BoardBar[]>(physical.map((u) => [u.id, []]));
  // תפוס / חסום לכל יחידה ולילה
  const occupied = new Map<string, Set<number>>(physical.map((u) => [u.id, new Set<number>()]));
  const blocked = new Map<string, Set<number>>(physical.map((u) => [u.id, new Set<number>()]));
  const mark = (
    target: Map<string, Set<number>>,
    unitId: string,
    g: { start: number; span: number },
  ) => {
    for (let i = g.start; i < g.start + g.span; i++) target.get(unitId)!.add(i);
  };

  for (const b of view.bookings) {
    const g = geo(b.check_in, b.check_out);
    if (!g) continue;
    const pending = PENDING.has(b.status);
    if (!pending && !HOLDS.has(b.status)) continue; // בוטלה / לא הגיעו
    const kind: BoardKind = pending
      ? "pending"
      : b.source === "external"
        ? channelKind(b.channel)
        : "direct";
    for (const t of targets(b.unit_id)) {
      bars.get(t.id)!.push({
        key: `b-${b.id}-${t.id}`,
        kind,
        ...g,
        label: shortGuestName(b.guest_name),
        via: t.via,
        bookingId: b.id,
        bookingNumber: b.number,
      });
      if (!pending) mark(occupied, t.id, g);
    }
  }
  for (const k of view.blocks) {
    const g = geo(k.start_date, k.end_date);
    if (!g) continue;
    const kind: BoardKind = k.synced ? channelKind(k.channel) : "block";
    for (const t of targets(k.unit_id)) {
      bars.get(t.id)!.push({
        key: `k-${k.id}-${t.id}`,
        kind,
        ...g,
        label: k.synced ? BOARD_KIND_LABELS[kind] : k.reason?.trim() || "חסימה",
        via: t.via,
        bookingId: null,
        bookingNumber: null,
      });
      mark(k.synced ? occupied : blocked, t.id, g);
    }
  }

  const rows: BoardRow[] = physical.map((u) => ({
    id: u.id,
    name: u.name,
    bars: bars.get(u.id)!.sort((a, b) => a.start - b.start || a.span - b.span),
  }));
  const nights: BoardNight[] = dayList.map((d, i) => {
    let occ = 0;
    let avail = 0;
    for (const u of physical) {
      const isOcc = occupied.get(u.id)!.has(i);
      if (isOcc) occ += 1;
      if (isOcc || !blocked.get(u.id)!.has(i)) avail += 1;
    }
    return {
      date: d.date,
      occupied: occ,
      available: avail,
      pct: avail ? Math.round((occ / avail) * 100) : null,
    };
  });
  return { days: dayList, rows, nights };
}
