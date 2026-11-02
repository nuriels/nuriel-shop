// לוח היומן (Stage 3a) — חישובים בלי React: תאריכים (UTC, בלי שעות), טווחי חודש / שבוע, שורות
// לפי מתחם, פסים להזמנות ולחסימות (מחושבים פעם אחת לכל טעינה), "כל המתחם" ויחידותיו,
// סדר יום לטלפון וחיפוש לפי מספר הזמנה / שם האורח.
import type {
  BookingStatus,
  CalendarBlock,
  CalendarBooking,
  CalendarUnit,
  CalendarView,
} from "../../types/calendar";
import { manageKeys } from "../lib/query-keys";

export const calendarKey = (from: string, to: string, units: string | null, cancelled: boolean) =>
  [...manageKeys.all, "calendar", from, to, units, cancelled] as const;

const DAY = 86400000;
export const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (isoDate: string, n: number) =>
  iso(new Date(toDate(isoDate).getTime() + n * DAY));
export const diffDays = (a: string, b: string) =>
  Math.round((toDate(b).getTime() - toDate(a).getTime()) / DAY);
export const dow = (isoDate: string) => toDate(isoDate).getUTCDay();

/** units (Calendar Pro) — כרטיס לכל יחידה: הלילה, הגעה / עזיבה, ההזמנה הבאה ו-14 הלילות הקרובים */
export type ViewMode = "month" | "week" | "day" | "agenda" | "units";

/** החודש של התאריך: מהראשון לחודש עד הראשון לחודש הבא; שבוע: 7 ימים מיום ראשון */
export function rangeFor(mode: ViewMode, anchor: string): { from: string; to: string } {
  const d = toDate(anchor);
  if (mode === "month") {
    const from = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
    const to = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
    return { from, to };
  }
  if (mode === "week") {
    const from = addDays(anchor, -dow(anchor));
    return { from, to: addDays(from, 7) };
  }
  // יום: גם הלילה הקודם — כדי לראות את מי שעוזב היום
  if (mode === "day") return { from: addDays(anchor, -1), to: addDays(anchor, 1) };
  return { from: anchor, to: addDays(anchor, 14) };
}

export function shift(mode: ViewMode, anchor: string, dir: 1 | -1): string {
  if (mode === "month") {
    const d = toDate(anchor);
    return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + dir, 1)));
  }
  return addDays(anchor, dir * (mode === "week" ? 7 : mode === "day" ? 1 : 14));
}

export const daysOf = (from: string, to: string) =>
  Array.from({ length: Math.max(0, diffDays(from, to)) }, (_, i) => addDays(from, i));

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
export const DAY_SHORT = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
export const monthTitle = (isoDate: string) => {
  const d = toDate(isoDate);
  return `${HE_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
export const dayLabel = (isoDate: string) => {
  const d = toDate(isoDate);
  return `${DAY_SHORT[d.getUTCDay()]} ${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
};

// ---------- מצבים וצבעים (גם בלי צבע: דוגמה וטקסט) ----------

export const STATUS_LABELS: Record<BookingStatus, string> = {
  pending_approval: "ממתינה לאישור",
  pending_payment: "ממתינה לתשלום",
  confirmed: "מאושרת",
  cancel_requested: "ביקשו לבטל",
  checked_in: "שוהים עכשיו",
  checked_out: "עזבו",
  cancelled: "בוטלה",
  no_show: "לא הגיעו",
};
/** קבוצה לצבע / לסינון */
export type Tone =
  | "pending"
  | "confirmed"
  | "staying"
  | "past"
  | "cancelled"
  | "block"
  /** D3: תאריכים מסנכרון יומן חיצוני (Airbnb / Booking.com …) */
  | "external";
export const toneOf = (s: BookingStatus): Tone =>
  s === "pending_approval" || s === "pending_payment" || s === "cancel_requested"
    ? "pending"
    : s === "checked_in"
      ? "staying"
      : s === "checked_out" || s === "no_show"
        ? "past"
        : s === "cancelled"
          ? "cancelled"
          : "confirmed";
export const TONE_LABELS: Record<Tone, string> = {
  pending: "ממתינה לאישור",
  confirmed: "מאושרת",
  staying: "שוהים עכשיו",
  past: "עזבו",
  cancelled: "בוטלה",
  block: "חסום",
  external: "מיומן חיצוני",
};

// ---------- מקור התפוסה (D3) ----------

export const CHANNEL_LABELS: Record<string, string> = {
  airbnb: "Airbnb",
  booking: "Booking.com",
  vrbo: "Vrbo",
  google: "Google",
  other: "יומן חיצוני",
};

const BOOKING_SOURCE_LABELS: Record<string, string> = {
  site: "האתר",
  phone: "טלפון",
  walk_in: "הגיעו למקום",
  owner: "הוזן בניהול",
  external: "ערוץ חיצוני",
};

export interface OccupancySource {
  kind: "booking" | "block" | "synced";
  /** "האתר", "טלפון", "Airbnb", "חסימה ידנית"… */
  label: string;
}

/** מאיפה הגיעה ההזמנה: האתר / טלפון / הגיעו למקום / ניהול / ערוץ (לפי השם שנרשם) */
export function bookingSource(b: Pick<CalendarBooking, "source" | "channel">): OccupancySource {
  const channel = b.channel?.trim();
  if (b.source === "external" && channel)
    return { kind: "booking", label: CHANNEL_LABELS[channel.toLowerCase()] ?? channel };
  return { kind: "booking", label: BOOKING_SOURCE_LABELS[b.source] ?? "אחר" };
}

/** חסימה: מסנכרון (הערוץ) או ידנית */
export function blockSource(k: Pick<CalendarBlock, "synced" | "channel">): OccupancySource {
  if (k.synced)
    return {
      kind: "synced",
      label: CHANNEL_LABELS[k.channel ?? "other"] ?? CHANNEL_LABELS["other"]!,
    };
  return { kind: "block", label: "חסימה ידנית" };
}

// ---------- שורות ופסים ----------

export interface Bar {
  key: string;
  kind: "booking" | "block";
  /** "via" — הזמנה של "כל המתחם" על יחידה שבו (מעומעם), או הזמנה של יחידה על שורת "כל המתחם" */
  via: boolean;
  start: number;
  span: number;
  /** ממשיך מלפני / אחרי הטווח שעל המסך */
  clippedStart: boolean;
  clippedEnd: boolean;
  tone: Tone;
  label: string;
  booking?: CalendarBooking;
  block?: CalendarBlock;
}

export type Row =
  | { type: "property"; key: string; name: string }
  | { type: "unit"; key: string; unit: CalendarUnit; bars: Bar[] };

function bar(
  from: string,
  to: string,
  start: string,
  end: string,
): Pick<Bar, "start" | "span" | "clippedStart" | "clippedEnd"> | null {
  const s = Math.max(0, diffDays(from, start));
  const e = Math.min(diffDays(from, to), diffDays(from, end));
  if (e <= s) return null;
  return { start: s, span: e - s, clippedStart: start < from, clippedEnd: end > to };
}

export interface Filters {
  propertyId: string;
  /** יחידה אחת ("היומן של היחידה"); "כל המתחם" שהיא בו / יחידותיו נשארים לידה */
  unitId: string;
  unitType: string;
  /** "" = הכול; או קבוצת מצב אחת */
  tone: "" | Tone;
}

/** סוג חדר (RT) לקיבוץ השורות בלוח */
export interface RoomGroup {
  id: string;
  name: string;
  room_ids: string[];
}

/**
 * השורות של הלוח: לפי מתחם (כותרת), יחידות פיזיות ואז "כל המתחם"; הפסים של כל שורה.
 * מלון: חדרים מאותו סוג — יחד, תחת כותרת הסוג (במקום של החדר הראשון שלו).
 */
export function buildRows(view: CalendarView, filters: Filters, groups: RoomGroup[] = []): Row[] {
  const unitById = new Map(view.units.map((u) => [u.id, u]));
  const wholeOf = new Map<string, string>();
  for (const u of view.units) for (const m of u.member_ids ?? []) wholeOf.set(m, u.id);
  const bars = new Map<string, Bar[]>();
  const push = (unitId: string, b: Bar) =>
    (bars.get(unitId) ?? bars.set(unitId, []).get(unitId)!).push(b);
  for (const b of view.bookings) {
    const geo = bar(view.from, view.to, b.check_in, b.check_out);
    if (!geo) continue;
    const tone = toneOf(b.status);
    if (filters.tone && filters.tone !== tone) continue;
    // הזמנה מערוץ חיצוני (נרשמה ידנית עם שם הערוץ) — שם הערוץ בתחילת הפס
    const via = b.source === "external" ? `${bookingSource(b).label} · ` : "";
    const label = `${via}#${b.number} ${b.guest_name ?? ""}`.trim();
    push(b.unit_id, {
      key: `b-${b.id}`,
      kind: "booking",
      via: false,
      tone,
      label,
      booking: b,
      ...geo,
    });
    const u = unitById.get(b.unit_id);
    // "כל המתחם": על כל יחידה שבו — מעומעם
    for (const m of u?.member_ids ?? [])
      push(m, {
        key: `b-${b.id}-${m}`,
        kind: "booking",
        via: true,
        tone,
        label,
        booking: b,
        ...geo,
      });
    // יחידה שבתוך "כל המתחם": גם על שורת "כל המתחם" — מעומעם (התפוסה שלו)
    const w = wholeOf.get(b.unit_id);
    if (w)
      push(w, { key: `b-${b.id}-w`, kind: "booking", via: true, tone, label, booking: b, ...geo });
  }
  if (!filters.tone || filters.tone === "block" || filters.tone === "external") {
    for (const k of view.blocks) {
      const geo = bar(view.from, view.to, k.start_date, k.end_date);
      if (!geo) continue;
      // D3: תאריכים מיומן חיצוני — גוון משלהם ושם הערוץ, כדי שיהיה ברור מאיפה הם
      const tone: Tone = k.synced ? "external" : "block";
      if (filters.tone && filters.tone !== tone) continue;
      const label = k.synced
        ? `${blockSource(k).label} · סנכרון`
        : k.reason
          ? `חסום — ${k.reason}`
          : "חסום";
      push(k.unit_id, {
        key: `k-${k.id}`,
        kind: "block",
        via: false,
        tone,
        label,
        block: k,
        ...geo,
      });
      for (const m of unitById.get(k.unit_id)?.member_ids ?? [])
        push(m, {
          key: `k-${k.id}-${m}`,
          kind: "block",
          via: true,
          tone,
          label,
          block: k,
          ...geo,
        });
      const w = wholeOf.get(k.unit_id);
      if (w)
        push(w, {
          key: `k-${k.id}-w`,
          kind: "block",
          via: true,
          tone,
          label,
          block: k,
          ...geo,
        });
    }
  }
  const rows: Row[] = [];
  const only = filters.unitId ? relatedUnits(view, filters.unitId) : null;
  for (const p of view.properties) {
    if (filters.propertyId && filters.propertyId !== p.id) continue;
    const units = view.units.filter(
      (u) =>
        u.property_id === p.id &&
        (!only || only.has(u.id)) &&
        (!filters.unitType || u.unit_type === filters.unitType || u.kind === "whole_property"),
    );
    if (units.length === 0) continue;
    rows.push({ type: "property", key: `p-${p.id}`, name: p.name });
    const unitRow = (u: CalendarUnit): Row => ({
      type: "unit",
      key: u.id,
      unit: u,
      bars: (bars.get(u.id) ?? []).sort((a, b) => a.start - b.start),
    });
    const groupOf = new Map<string, RoomGroup>();
    for (const g of groups) for (const id of g.room_ids) groupOf.set(id, g);
    const done = new Set<string>();
    for (const u of units) {
      const g = groupOf.get(u.id);
      if (!g) {
        rows.push(unitRow(u));
        continue;
      }
      if (done.has(g.id)) continue;
      done.add(g.id);
      const members = units.filter((x) => groupOf.get(x.id)?.id === g.id);
      rows.push({
        type: "property",
        key: `g-${g.id}`,
        name: `${g.name} · ${members.length} חדרים`,
      });
      for (const m of members) rows.push(unitRow(m));
    }
  }
  return rows;
}

/** היחידה, "כל המתחם" שהיא בו (התפוסה שלו היא גם שלה) ויחידותיו אם היא "כל המתחם" */
export function relatedUnits(view: CalendarView, unitId: string): Set<string> {
  const out = new Set([unitId]);
  for (const u of view.units) {
    if (u.id === unitId) for (const m of u.member_ids ?? []) out.add(m);
    if ((u.member_ids ?? []).includes(unitId)) out.add(u.id);
  }
  return out;
}

/** היום הוא לילה פנוי ביחידה? (לבחירת טווח לחסימה) */
export function isFreeNight(row: Extract<Row, { type: "unit" }>, index: number): boolean {
  return !row.bars.some((b) => index >= b.start && index < b.start + b.span);
}

// ---------- סדר היום (טלפון) ----------

export interface AgendaDay {
  date: string;
  arrivals: CalendarBooking[];
  departures: CalendarBooking[];
  staying: CalendarBooking[];
  blocks: CalendarBlock[];
}
const holding = (b: CalendarBooking) => b.status !== "cancelled" && b.status !== "no_show";
/** סדר היום — לפי הסינון (מתחם / יחידה) */
export function agenda(
  view: CalendarView,
  filters?: Pick<Filters, "propertyId" | "unitId">,
): AgendaDay[] {
  const property = new Map(view.units.map((u) => [u.id, u.property_id]));
  const only = filters?.unitId ? relatedUnits(view, filters.unitId) : null;
  const shown = (unitId: string) =>
    (!only || only.has(unitId)) &&
    (!filters?.propertyId || property.get(unitId) === filters.propertyId);
  const bookings = view.bookings.filter((b) => holding(b) && shown(b.unit_id));
  const blocks = view.blocks.filter((k) => shown(k.unit_id));
  return daysOf(view.from, view.to).map((date) => ({
    date,
    arrivals: bookings.filter((b) => b.check_in === date),
    departures: bookings.filter((b) => b.check_out === date),
    staying: bookings.filter((b) => b.check_in < date && b.check_out > date),
    blocks: blocks.filter((k) => k.start_date <= date && k.end_date > date),
  }));
}

/** חיפוש: מספר הזמנה ("#12" / "12") או חלק משם האורח */
export function search(view: CalendarView, q: string): CalendarBooking[] {
  const t = q.trim().replace(/^#/, "");
  if (t === "") return [];
  if (/^\d+$/.test(t)) return view.bookings.filter((b) => String(b.number) === t);
  return view.bookings.filter((b) => (b.guest_name ?? "").includes(t)).slice(0, 20);
}

export const nightsText = (b: Pick<CalendarBooking, "check_in" | "check_out">) => {
  const n = diffDays(b.check_in, b.check_out);
  return n === 1 ? "לילה אחד" : `${n} לילות`;
};

/** חלון השורות שעל המסך (וירטואליזציה): מאילו שורות עד אילו, עם מרווח */
export function visibleWindow(
  scrollTop: number,
  height: number,
  rowHeight: number,
  total: number,
  overscan = 6,
) {
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(total, Math.ceil((scrollTop + height) / rowHeight) + overscan);
  return { first, last };
}

// ---------- תצוגת יום (Stage 3b) ----------

export interface DayUnit {
  unit: CalendarUnit;
  /** מה קורה ביחידה בלילה של היום */
  night: "free" | "booked" | "blocked";
  staying: CalendarBooking | null;
  arriving: CalendarBooking | null;
  leaving: CalendarBooking | null;
  block: CalendarBlock | null;
}

/** יום אחד: לכל יחידה — מי מגיע, מי עוזב, מי נשאר, חסום או פנוי הלילה ("כל המתחם" — דרך יחידותיו) */
export function dayOverview(
  view: CalendarView,
  date: string,
  filters?: Pick<Filters, "propertyId" | "unitId">,
): DayUnit[] {
  const only = filters?.unitId ? relatedUnits(view, filters.unitId) : null;
  const wholeOf = new Map<string, string>();
  for (const u of view.units) for (const m of u.member_ids ?? []) wholeOf.set(m, u.id);
  const holdingB = view.bookings.filter((b) => holding(b));
  const covers = (unitId: string) => {
    const ids = new Set([unitId]);
    const w = wholeOf.get(unitId);
    if (w) ids.add(w);
    for (const m of view.units.find((u) => u.id === unitId)?.member_ids ?? []) ids.add(m);
    return ids;
  };
  return view.units
    .filter((u) => u.is_active || holdingB.some((b) => b.unit_id === u.id))
    .filter(
      (u) =>
        (!only || only.has(u.id)) && (!filters?.propertyId || u.property_id === filters.propertyId),
    )
    .map((u) => {
      const ids = covers(u.id);
      const own = holdingB.filter((b) => b.unit_id === u.id);
      const staying =
        holdingB.find((b) => ids.has(b.unit_id) && b.check_in <= date && b.check_out > date) ??
        null;
      const block =
        view.blocks.find((k) => ids.has(k.unit_id) && k.start_date <= date && k.end_date > date) ??
        null;
      return {
        unit: u,
        night: staying ? "booked" : block ? "blocked" : "free",
        staying,
        arriving: own.find((b) => b.check_in === date) ?? null,
        leaving: own.find((b) => b.check_out === date) ?? null,
        block,
      };
    });
}

// ---------- Calendar Pro: מבט אחד — פנוי / תפוס, התנגשויות, כרטיסי יחידות ----------

/** מה יש בלילה ביחידה (לשורת "פנויות", לרצועת הלילות ולכרטיס היחידה) */
export type NightState = "free" | "booked" | "pending" | "block" | "external";

export const NIGHT_LABELS: Record<NightState, string> = {
  free: "פנוי",
  booked: "תפוס",
  pending: "ממתינה לאישור",
  block: "חסום",
  external: "תפוס ביומן חיצוני",
};

type UnitRow = Extract<Row, { type: "unit" }>;
const counts = (b: Bar) => !b.booking || b.booking.status !== "cancelled";

/** הלילה ה-index בשורה: הזמנה / חסימה / יומן חיצוני (גם "דרך כל המתחם"), או פנוי. מבוטלת לא תופסת */
export function nightState(row: UnitRow, index: number): NightState {
  const covering = row.bars.filter(
    (b) => index >= b.start && index < b.start + b.span && counts(b),
  );
  const own = covering.find((b) => !b.via) ?? covering[0];
  if (!own) return "free";
  if (own.kind === "block") return own.tone === "external" ? "external" : "block";
  return own.tone === "pending" ? "pending" : "booked";
}

/** שורת "פנויות" בלוח: בכל לילה — כמה יחידות פעילות (בלי "כל המתחם") פנויות, מתוך כמה */
export function freeByNight(rows: Row[], nights: number): { free: number; total: number }[] {
  const units = rows.filter(
    (r): r is UnitRow => r.type === "unit" && r.unit.kind !== "whole_property" && r.unit.is_active,
  );
  return Array.from({ length: nights }, (_, i) => ({
    total: units.length,
    free: units.filter((r) => nightState(r, i) === "free").length,
  }));
}

/** בלי הרשאת "אורחים": בלי שמות אורחים בכל היומן (רק מספר ההזמנה) */
export function maskGuests(view: CalendarView): CalendarView {
  return { ...view, bookings: view.bookings.map((b) => ({ ...b, guest_name: null })) };
}

export interface ConflictMark {
  key: string;
  unitId: string;
  channel: string;
  /** "Airbnb" / "Booking.com"… */
  label: string;
  from: string;
  to: string;
  start: number;
  span: number;
}

/**
 * התנגשויות עם יומנים חיצוניים (D3, קריאה בלבד): תאריכים שתפוסים אצלנו ותפוסים גם בערוץ — לא
 * נכתבו (אין הזמנה כפולה), אבל צריך לסגור אותם בערוץ. בטווח שעל המסך, לכל יחידה.
 */
export function conflictMarks(
  units: {
    unit_id: string;
    calendars: {
      id: string;
      channel: string;
      conflicts: { uid: string; from: string; to: string }[];
    }[];
  }[],
  from: string,
  to: string,
): ConflictMark[] {
  const out: ConflictMark[] = [];
  for (const u of units)
    for (const c of u.calendars)
      for (const x of c.conflicts ?? []) {
        const geo = bar(from, to, x.from, x.to);
        if (!geo) continue;
        out.push({
          key: `${c.id}-${x.uid}-${x.from}`,
          unitId: u.unit_id,
          channel: c.channel,
          label: CHANNEL_LABELS[c.channel] ?? c.channel,
          from: x.from,
          to: x.to,
          start: geo.start,
          span: geo.span,
        });
      }
  return out;
}

export interface UnitCard {
  unit: CalendarUnit;
  propertyName: string;
  /** הלילה של היום (או של היום הראשון בטווח, כשהיום לא בו) */
  tonight: NightState;
  stay: CalendarBooking | null;
  block: CalendarBlock | null;
  arriving: CalendarBooking | null;
  leaving: CalendarBooking | null;
  /** ההגעה הבאה (אחרי היום) בטווח */
  next: CalendarBooking | null;
  /** הלילות בטווח (14 בתצוגת היחידות) */
  strip: NightState[];
  freeNights: number;
}

/** תצוגת היחידות: כרטיס לכל יחידה פעילה (בלי "כל המתחם" — התפוסה שלו מופיעה ביחידות שלו) */
export function unitCards(
  view: CalendarView,
  filters: Filters,
  groups: RoomGroup[] = [],
): UnitCard[] {
  const rows = buildRows(view, { ...filters, tone: "" }, groups);
  const nights = diffDays(view.from, view.to);
  const idx = Math.min(Math.max(0, diffDays(view.from, view.today)), Math.max(0, nights - 1));
  const day = addDays(view.from, idx);
  const property = new Map(view.properties.map((p) => [p.id, p.name]));
  const wholeOf = new Map<string, string>();
  for (const u of view.units) for (const m of u.member_ids ?? []) wholeOf.set(m, u.id);
  const live = view.bookings.filter((b) => holding(b));
  return rows
    .filter((r): r is UnitRow => r.type === "unit" && r.unit.kind !== "whole_property")
    .filter((r) => r.unit.is_active)
    .map((r) => {
      const ids = new Set([r.unit.id]);
      const w = wholeOf.get(r.unit.id);
      if (w) ids.add(w);
      const mine = live.filter((b) => ids.has(b.unit_id));
      const covering = r.bars.filter((b) => idx >= b.start && idx < b.start + b.span && counts(b));
      const own = covering.find((b) => !b.via) ?? covering[0];
      const strip = Array.from({ length: nights }, (_, i) => nightState(r, i));
      return {
        unit: r.unit,
        propertyName: property.get(r.unit.property_id) ?? "",
        tonight: nightState(r, idx),
        stay: own?.booking ?? null,
        block: own?.block ?? null,
        arriving: mine.find((b) => b.check_in === day) ?? null,
        leaving: mine.find((b) => b.check_out === day) ?? null,
        next:
          mine
            .filter((b) => b.check_in > day)
            .sort((a, b) => a.check_in.localeCompare(b.check_in))[0] ?? null,
        strip,
        freeNights: strip.filter((n) => n === "free").length,
      };
    });
}

/** "10.12" — תאריך קצר לתוויות */
export const shortDate = (isoDate: string) => {
  const d = toDate(isoDate);
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
};

/** "2026-11" → הראשון בחודש (מעבר מהיר לחודש); לא תקין → null */
export function monthAnchor(value: string): string | null {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? `${value}-01` : null;
}

/** מעבר מהיר לחודש: שנה אחורה ושנה וחצי קדימה מהיום (והחודש שעל המסך, אם הוא רחוק יותר) */
export function monthOptions(today: string, current: string): { value: string; label: string }[] {
  const d = toDate(today);
  const out: { value: string; label: string }[] = [];
  for (let i = -12; i <= 18; i++) {
    const m = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1)));
    out.push({ value: m.slice(0, 7), label: monthTitle(m) });
  }
  if (monthAnchor(current) && !out.some((o) => o.value === current))
    out.push({ value: current, label: monthTitle(`${current}-01`) });
  return out.sort((a, b) => a.value.localeCompare(b.value));
}
