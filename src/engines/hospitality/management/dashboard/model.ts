// לוח הבקרה (שלב F3) — לוגיקה טהורה (נבדקת ביחידה): תקופות, ברכה, שינוי מול התקופה הקודמת,
// ומה כל משימה ב"דורש טיפול" אומרת ולאן היא מובילה (כל כפתור — יעד אמיתי).
import type { DashboardNumbers, DashboardTask } from "../../types/dashboard";
import { manageKeys } from "../lib/query-keys";

export type PeriodKey = "today" | "week" | "month" | "d30" | "prev_month" | "custom";

export const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "היום" },
  { key: "week", label: "השבוע" },
  { key: "month", label: "החודש" },
  { key: "d30", label: "30 הימים האחרונים" },
  { key: "prev_month", label: "החודש הקודם" },
  { key: "custom", label: "טווח מותאם" },
];

/** מפתחות המטמון של לוח הבקרה — כולם תחת [..., "dashboard"], כדי שרענון אחרי פעולה יתפוס הכול */
export const dashboardKeys = {
  all: [...manageKeys.all, "dashboard"] as const,
  overview: (from: string, to: string) =>
    [...manageKeys.all, "dashboard", "overview", from, to] as const,
  today: [...manageKeys.all, "dashboard", "today"] as const,
  tasks: [...manageKeys.all, "dashboard", "tasks"] as const,
};

export interface DashboardSearch {
  period?: PeriodKey;
  from?: string;
  to?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** הכתובת: ?period=month / ?period=custom&from=…&to=… (תקופה לא מוכרת — ברירת המחדל) */
export function parseDashboardSearch(s: Record<string, unknown>): DashboardSearch {
  const period = PERIOD_OPTIONS.find((p) => p.key === s["period"])?.key;
  if (!period) return {};
  if (period !== "custom") return { period };
  const from = typeof s["from"] === "string" && ISO_DATE.test(s["from"]) ? s["from"] : undefined;
  const to = typeof s["to"] === "string" && ISO_DATE.test(s["to"]) ? s["to"] : undefined;
  return from && to && from <= to ? { period, from, to } : {};
}

const MONTHS = [
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
const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (isoDate: string, n: number) =>
  iso(new Date(toDate(isoDate).getTime() + n * 86_400_000));

/** התאריך של היום באזור הזמן של העסק (YYYY-MM-DD) */
export function businessToday(timeZone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return iso(now);
  }
}

/** השעה באזור הזמן של העסק (0–23) */
export function businessHour(timeZone: string, now: Date = new Date()): number {
  try {
    const h = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hour12: false }).format(
      now,
    );
    return Number(h) % 24;
  } catch {
    return now.getHours();
  }
}

export function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return "בוקר טוב";
  if (hour >= 12 && hour < 17) return "צהריים טובים";
  if (hour >= 17 && hour < 22) return "ערב טוב";
  return "לילה טוב";
}

/** "יום שני, 2 בנובמבר 2026" */
export function longDate(isoDate: string): string {
  const d = toDate(isoDate);
  return `יום ${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ב${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "2.11" */
export const shortDate = (isoDate: string) => {
  const d = toDate(isoDate);
  return `${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
};

/** הטווח של כל תקופה (כולל שני הקצוות), לפי התאריך של היום אצל העסק */
export function periodRange(
  key: PeriodKey,
  today: string,
  custom?: { from: string; to: string } | null,
): { from: string; to: string } {
  const t = toDate(today);
  switch (key) {
    case "today":
      return { from: today, to: today };
    case "week": // השבוע מתחיל ביום ראשון
      return { from: addDays(today, -t.getUTCDay()), to: today };
    case "month":
      return { from: iso(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1))), to: today };
    case "d30":
      return { from: addDays(today, -29), to: today };
    case "prev_month": {
      const first = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1));
      const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 0));
      return { from: iso(first), to: iso(last) };
    }
    case "custom":
      return custom && custom.from <= custom.to ? custom : { from: addDays(today, -29), to: today };
  }
}

/** תיאור התקופה במשפט: "30 הימים האחרונים", "אוקטובר 2026", "13.10 – 2.11" */
export function periodText(key: PeriodKey, range: { from: string; to: string }): string {
  switch (key) {
    case "today":
      return "היום";
    case "week":
      return "השבוע";
    case "month": {
      const d = toDate(range.from);
      return `${MONTHS[d.getUTCMonth()]} עד היום`;
    }
    case "d30":
      return "30 הימים האחרונים";
    case "prev_month": {
      const d = toDate(range.from);
      return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    }
    case "custom":
      return range.from === range.to
        ? shortDate(range.from)
        : `${shortDate(range.from)} – ${shortDate(range.to)}`;
  }
}

/** "מול אתמול" / "מול התקופה הקודמת" */
export function compareText(key: PeriodKey): string {
  if (key === "today") return "מול אתמול";
  if (key === "prev_month") return "מול החודש שלפניו";
  return "מול התקופה הקודמת";
}

/** שינוי באחוזים; null — אין בסיס להשוואה (אין תקופה קודמת, או 0 בתקופה הקודמת) */
export function percentChange(
  current: number | null,
  previous: number | null | undefined,
): number | null {
  if (current === null || previous === null || previous === undefined) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

/** שינוי בנקודות אחוז (תפוסה) */
export function pointChange(
  current: number | null,
  previous: number | null | undefined,
): number | null {
  if (current === null || previous === null || previous === undefined) return null;
  return current - previous;
}

export type Deltas = Record<
  "bookings" | "revenue" | "collected" | "cancellations",
  number | null
> & {
  occupancy: number | null;
};

export function deltas(current: DashboardNumbers, previous: DashboardNumbers | null): Deltas {
  return {
    bookings: percentChange(current.bookings, previous?.bookings),
    revenue: percentChange(current.revenue, previous?.revenue),
    collected: percentChange(current.collected, previous?.collected),
    cancellations: percentChange(current.cancellations, previous?.cancellations),
    occupancy: pointChange(current.occupancy, previous?.occupancy),
  };
}

/** כמה מההכנסות נגבו (0–100); null — אין הכנסות */
export function collectedShare(n: DashboardNumbers): number | null {
  if (n.revenue === null || n.collected === null || n.revenue <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((n.collected / n.revenue) * 100)));
}

// ---------- דורש טיפול ----------

export type TaskLink =
  | { to: "/manage/bookings/$bookingId"; params: { bookingId: string }; hash?: string }
  | { to: "/manage/bookings"; search: { tab: "pending" | "upcoming" } }
  | { to: "/manage/channels" }
  | { to: "/manage/emails"; search: { filter: "failed" } }
  | { to: "/manage/pricing" }
  | { to: "/manage/website" }
  | { to: "/manage/calendar"; search: { open: "1" } }
  | { to: "/manage"; hash: "plan" };

export interface TaskView {
  title: string;
  detail: string;
  cta: string;
  link: TaskLink;
  tone: "danger" | "warning" | "info" | "brand";
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : `${n} ${many}`);

/** טקסט "בעוד 2:40 שעות" / "היום ב-14:30" לפקיעה */
export function dueText(
  dueIso: string,
  now: number = Date.now(),
  timeZone = "Asia/Jerusalem",
): string {
  const ms = Date.parse(dueIso) - now;
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "פג עכשיו";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `בעוד ${minutes} דקות`;
  if (minutes < 24 * 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `בעוד ${h}:${String(m).padStart(2, "0")} שעות`;
  }
  try {
    return `ב-${new Intl.DateTimeFormat("he-IL", { timeZone, day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(dueIso))}`;
  } catch {
    return "";
  }
}

export function taskView(task: DashboardTask, now: number = Date.now()): TaskView {
  const single = task.count === 1 && task.booking_id;
  switch (task.kind) {
    case "pending":
      return {
        title: plural(task.count, "בקשה אחת ממתינה לאישור", "בקשות ממתינות לאישור"),
        detail: task.due ? `הקרובה פוקעת ${dueText(task.due, now)}` : "בקשות שלא אושרו פוקעות לבד",
        cta: "לאישור",
        link: single
          ? { to: "/manage/bookings/$bookingId", params: { bookingId: task.booking_id! } }
          : { to: "/manage/bookings", search: { tab: "pending" } },
        tone: "warning",
      };
    case "cancel_requests":
      return {
        title: plural(task.count, "בקשת ביטול מאורח", "בקשות ביטול מאורחים"),
        detail: task.booking_number
          ? `הזמנה #${task.booking_number}${task.count > 1 ? " ועוד" : ""}`
          : "",
        cta: "לטיפול",
        link: single
          ? { to: "/manage/bookings/$bookingId", params: { bookingId: task.booking_id! } }
          : { to: "/manage/bookings", search: { tab: "pending" } },
        tone: "danger",
      };
    case "deposits":
      return {
        title: plural(task.count, "מקדמה לגבייה", "מקדמות לגבייה"),
        detail: task.booking_number
          ? `הזמנה #${task.booking_number} · מגיעים בשבוע הקרוב`
          : "אורחים שמגיעים בשבוע הקרוב",
        cta: "לתשלום",
        link: task.booking_id
          ? {
              to: "/manage/bookings/$bookingId",
              params: { bookingId: task.booking_id },
              hash: "payments",
            }
          : { to: "/manage/bookings", search: { tab: "pending" } },
        tone: "warning",
      };
    case "channels":
      return {
        title: task.conflicts
          ? plural(task.conflicts, "התנגשות ביומן חיצוני", "התנגשויות ביומנים חיצוניים")
          : "יומן חיצוני לא מסתנכרן",
        detail: task.conflicts
          ? "תאריכים שתפוסים גם אצלנו וגם בערוץ"
          : "Airbnb / Booking — בדקו את הקישור",
        cta: "לבדיקה",
        link: { to: "/manage/channels" },
        tone: task.conflicts ? "danger" : "warning",
      };
    case "emails":
      return {
        title: plural(task.count, "מייל שלא נשלח", "מיילים שלא נשלחו"),
        detail: "אפשר לשלוח שוב מהמסך",
        cta: "לבדיקה",
        link: { to: "/manage/emails", search: { filter: "failed" } },
        tone: "warning",
      };
    case "prices":
      return {
        title: plural(task.count, "יחידה בלי מחיר", "יחידות בלי מחיר"),
        detail: "בלי מחיר אי אפשר להזמין אותן",
        cta: "להשלמה",
        link: { to: "/manage/pricing" },
        tone: "info",
      };
    case "site":
      return {
        title: "שינויים באתר שעוד לא פורסמו",
        detail: "האורחים רואים את הגרסה הקודמת",
        cta: "לפרסום",
        link: { to: "/manage/website" },
        tone: "info",
      };
    case "proofs":
      return {
        title: plural(task.count, "אישור העברה לבדיקה", "אישורי העברה לבדיקה"),
        detail: task.booking_number
          ? `הזמנה #${task.booking_number}${task.count > 1 ? " ועוד" : ""} · בדקו שההעברה נכנסה`
          : "בדקו שההעברה נכנסה לחשבון",
        cta: "לבדיקה",
        link: task.booking_id
          ? {
              to: "/manage/bookings/$bookingId",
              params: { bookingId: task.booking_id },
              hash: "transfer-proofs",
            }
          : { to: "/manage/bookings", search: { tab: "upcoming" } },
        tone: "warning",
      };
    case "open_dates":
      return {
        title: task.closed
          ? plural(task.closed, "יחידה לא פתוחה להזמנה באתר", "יחידות לא פתוחות להזמנה באתר")
          : plural(
              task.ending ?? task.count,
              "יחידה שהתאריכים הפתוחים שלה נגמרים",
              "יחידות שהתאריכים הפתוחים שלהן נגמרים",
            ),
        detail: task.closed
          ? "אורחים יכולים להזמין רק בתאריכים שפתחתם"
          : task.until
            ? `פתוח עד ${shortDate(task.until)} — כדאי לפתוח עוד`
            : "כדאי לפתוח עוד תאריכים",
        cta: "פתיחת תאריכים",
        link: { to: "/manage/calendar", search: { open: "1" } },
        tone: task.closed ? "danger" : "warning",
      };
    case "plan":
      return task.inactive
        ? {
            title: "המנוי של האתר לא פעיל",
            detail: "האתר לא מקבל הזמנות חדשות",
            cta: "לפרטים",
            link: { to: "/manage", hash: "plan" },
            tone: "danger",
          }
        : {
            title: "תקופת הניסיון מסתיימת בקרוב",
            detail: task.due ? `מסתיימת ${dueText(task.due, now)}` : "",
            cta: "לפרטים",
            link: { to: "/manage", hash: "plan" },
            tone: "brand",
          };
  }
}

/** סדר התצוגה: דחוף קודם */
export function sortTasks(tasks: DashboardTask[]): DashboardTask[] {
  const rank = { high: 0, medium: 1, low: 2 } as const;
  return [...tasks].sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** ראשי תיבות לאווטאר: "נועה ל." → "נל" */
export function initials(name: string): string {
  const parts = name.replace(/[."׳]/g, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0]![0]! + (parts[1]?.[0] ?? "")).toUpperCase();
}
