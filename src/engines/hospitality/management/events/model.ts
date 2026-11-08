// אירועים במתחם — לשוניות, תוויות, צבעי מצב ועזרים לתצוגה (טהור, נבדק ביחידה)
import type {
  EventConflict,
  EventLogEntry,
  EventStatus,
  EventTab,
  LodgingOverlap,
  StaffEvent,
} from "../../types/events";
import {
  DEPOSIT_STATUS_LABEL,
  EVENT_STATUS_LABEL,
  EVENT_TYPE_LABEL,
  PAYMENT_STATUS_LABEL,
} from "../../types/events";
import { manageKeys } from "../lib/query-keys";

export const EVENTS_KEY = [...manageKeys.all, "events"] as const;
export const eventsKey = (tab: EventTab, q: string, type: string, from: string, to: string) =>
  [...EVENTS_KEY, "list", tab, q, type, from, to] as const;
export const eventKey = (id: string) => [...EVENTS_KEY, "detail", id] as const;
export const TERMS_KEY = [...manageKeys.all, "business-terms"] as const;

export const EVENT_TABS: { key: EventTab; label: string; empty: string }[] = [
  { key: "upcoming", label: "קרובים", empty: "אין אירועים קרובים" },
  { key: "pending", label: "ממתינים לאישור", empty: "אין אירועים שממתינים לאישור" },
  { key: "past", label: "עבר", empty: "עוד אין אירועים שהסתיימו" },
  { key: "cancelled", label: "בוטלו", empty: "אין אירועים שבוטלו" },
  { key: "all", label: "הכל", empty: "עוד אין אירועים" },
];

export const STATUS_TONE: Record<EventStatus, string> = {
  pending: "bg-amber-100 text-amber-950",
  confirmed: "bg-emerald-100 text-emerald-950",
  cancelled: "bg-zinc-200 text-zinc-800",
  completed: "bg-sky-100 text-sky-950",
  past: "bg-sky-50 text-sky-900",
};

export { DEPOSIT_STATUS_LABEL, EVENT_STATUS_LABEL, EVENT_TYPE_LABEL, PAYMENT_STATUS_LABEL };

/** "18.11.2026" מתאריך ISO (יום בלבד — בלי אזור זמן) */
export function dayText(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)}.${Number(m)}.${y}`;
}

/** "17:00–23:30" / "21:00–01:00 (למחרת)" */
export function hoursText(
  e: Pick<StaffEvent, "start_time" | "end_time" | "ends_next_day">,
): string {
  return `${e.start_time}–${e.end_time}${e.ends_next_day ? " (למחרת)" : ""}`;
}

export function conflictText(c: EventConflict): string {
  return `אירוע #${c.number} — ${c.event_type}, ${dayText(c.event_date)} ${c.start_time}–${c.end_time}`;
}

export function lodgingText(l: LodgingOverlap): string {
  return `הזמנה #${l.number} — ${l.unit_name}, ${dayText(l.check_in)}–${dayText(l.check_out)}`;
}

const FIELD_LABEL: Record<string, string> = {
  property_id: "המתחם",
  event_type: "סוג האירוע",
  event_type_other: "סוג האירוע (אחר)",
  event_date: "התאריך",
  start_time: "שעת ההתחלה",
  end_time: "שעת הסיום",
  participants: "משתתפים",
  price: "המחיר",
  advance_amount: "המקדמה",
  amount_paid: "שולם",
  deposit_amount: "הפיקדון",
  deposit_status: "מצב הפיקדון",
  internal_notes: "הערות פנימיות",
};

function valueText(field: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (field === "deposit_status")
    return DEPOSIT_STATUS_LABEL[v as keyof typeof DEPOSIT_STATUS_LABEL] ?? String(v);
  if (field === "event_type")
    return EVENT_TYPE_LABEL[v as keyof typeof EVENT_TYPE_LABEL] ?? String(v);
  if (field === "event_date" && typeof v === "string") return dayText(v);
  if ((field === "start_time" || field === "end_time") && typeof v === "string")
    return v.slice(0, 5);
  if (field === "property_id") return "מתחם אחר";
  return String(v);
}

/** שורה בהיסטוריה — בעברית, עם "לפני → אחרי" לכל שדה שהשתנה */
export function logText(l: EventLogEntry): string {
  const who = l.actor_kind === "staff" ? "" : l.actor_kind === "guest" ? " (הלקוח)" : " (המערכת)";
  if (l.kind === "created")
    return `האירוע נוצר — ${EVENT_STATUS_LABEL[(l.to_status ?? "pending") as EventStatus]}${who}`;
  if (l.kind === "status_changed") {
    const from = EVENT_STATUS_LABEL[(l.from_status ?? "pending") as EventStatus];
    const to = EVENT_STATUS_LABEL[(l.to_status ?? "pending") as EventStatus];
    const ack =
      l.to_status === "confirmed" && l.changes["lodging_ack"] === true
        ? " — אושר למרות אורחים בצימרים"
        : "";
    return `${from} ← ${to}${ack}${l.note ? ` (${l.note})` : ""}${who}`;
  }
  if (l.kind === "updated") {
    const parts = Object.entries(l.changes).map(([k, v]) => {
      const c = v as { from?: unknown; to?: unknown };
      return `${FIELD_LABEL[k] ?? k}: ${valueText(k, c.from)} → ${valueText(k, c.to)}`;
    });
    return `עודכן — ${parts.join(" · ")}${who}`;
  }
  if (l.kind === "customer_changed") return `פרטי הלקוח עודכנו${who}`;
  // מיגרציה 65: תיקון פרטי הלקוח (אימייל וטלפון — ממוסכים בלבד)
  if (l.kind === "customer_updated") {
    const names: Record<string, string> = { full_name: "שם", phone: "טלפון", email: "אימייל" };
    const fields = Array.isArray(l.changes["fields"]) ? l.changes["fields"] : [];
    const list = fields
      .map((f) => names[String(f)])
      .filter(Boolean)
      .join(", ");
    const email = l.changes["email"];
    const emailText =
      email && typeof email === "object" && !Array.isArray(email)
        ? ` (${typeof email["from"] === "string" ? email["from"] : "—"} ← ${typeof email["to"] === "string" ? email["to"] : "בלי אימייל"})`
        : "";
    const moved = l.changes["guest_changed"] === true ? " · רק באירוע הזה (כרטיס לקוח אחר)" : "";
    return `פרטי הלקוח תוקנו${list ? `: ${list}` : ""}${emailText}${moved}${who}`;
  }
  return `${l.kind}${who}`;
}
