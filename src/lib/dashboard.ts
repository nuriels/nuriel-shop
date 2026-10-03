/**
 * לוח הבקרה של מנהל החנות — טעינה (admin_dashboard במסד: קריאה אחת,
 * שאילתות מקובצות לפי החנות) ועזרי תצוגה טהורים.
 */

import { supabase } from "@/integrations/supabase/client";
import type { OrderKind, OrderStatus } from "@/lib/orders";

export type DashboardDay = { day: string; revenue: number; orders: number };

export type DashboardRecentOrder = {
  id: string;
  order_number: string;
  kind: OrderKind;
  status: OrderStatus;
  created_at: string;
  delivery_attempts: number;
  is_guest: boolean;
  customer_name: string;
  /** הסכום לתשלום (כולל מע"מ ומשלוח) */
  gross: number;
};

export type DashboardData = {
  generatedAt: string;
  monthStart: string;
  totals: {
    revenueMonth: number;
    revenuePrevPeriod: number;
    ordersMonth: number;
    ordersPrevPeriod: number;
    quotesMonth: number;
  };
  openOrders: { total: number; new: number; awaitingCourier: number };
  customers: { total: number; newMonth: number; awaitingApproval: number };
  /** 14 הימים האחרונים, מהישן לחדש (האחרון = היום) */
  series: DashboardDay[];
  /** 5 ההזמנות האחרונות, מהחדשה */
  recent: DashboardRecentOrder[];
};

type Raw = Record<string, unknown>;
const obj = (value: unknown): Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Raw) : {};
const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** המבנה מהמסד → טיפוסים (מספרים שמגיעים כמחרוזת numeric וכו') */
export function parseDashboard(raw: unknown): DashboardData {
  const root = obj(raw);
  const totals = obj(root["totals"]);
  const open = obj(root["open_orders"]);
  const customers = obj(root["customers"]);
  const series = Array.isArray(root["series"]) ? root["series"] : [];
  const recent = Array.isArray(root["recent"]) ? root["recent"] : [];
  return {
    generatedAt: str(root["generated_at"]),
    monthStart: str(root["month_start"]),
    totals: {
      revenueMonth: num(totals["revenue_month"]),
      revenuePrevPeriod: num(totals["revenue_prev_period"]),
      ordersMonth: num(totals["orders_month"]),
      ordersPrevPeriod: num(totals["orders_prev_period"]),
      quotesMonth: num(totals["quotes_month"]),
    },
    openOrders: {
      total: num(open["total"]),
      new: num(open["new"]),
      awaitingCourier: num(open["awaiting_courier"]),
    },
    customers: {
      total: num(customers["total"]),
      newMonth: num(customers["new_month"]),
      awaitingApproval: num(customers["awaiting_approval"]),
    },
    series: series.map((entry) => {
      const day = obj(entry);
      return { day: str(day["day"]), revenue: num(day["revenue"]), orders: num(day["orders"]) };
    }),
    recent: recent.map((entry) => {
      const row = obj(entry);
      return {
        id: str(row["id"]),
        order_number: str(row["order_number"]),
        kind: (str(row["kind"]) || "order") as OrderKind,
        status: (str(row["status"]) || "pending") as OrderStatus,
        created_at: str(row["created_at"]),
        delivery_attempts: num(row["delivery_attempts"]),
        is_guest: row["is_guest"] === true,
        customer_name: str(row["customer_name"]) || "לקוח",
        gross: num(row["gross"]),
      };
    }),
  };
}

export async function loadDashboard(): Promise<DashboardData> {
  const { data, error } = await supabase.rpc("admin_dashboard");
  if (error) throw new Error(error.message);
  return parseDashboard(data);
}

export type Delta = {
  /** שינוי באחוזים (מעוגל), או null כשאין בסיס להשוואה */
  percent: number | null;
  direction: "up" | "down" | "flat";
};

/** השינוי מול התקופה המקבילה בחודש הקודם */
export function periodDelta(current: number, previous: number): Delta {
  if (previous <= 0) {
    return { percent: null, direction: current > 0 ? "up" : "flat" };
  }
  const percent = Math.round(((current - previous) / previous) * 100);
  return { percent, direction: percent > 0 ? "up" : percent < 0 ? "down" : "flat" };
}

/** "1–3 בספטמבר" — התקופה המקבילה בחודש הקודם (לפי שעון ישראל) */
export function previousPeriodLabel(now: Date = new Date()): string {
  const local = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Jerusalem" }));
  const prevMonth = new Date(local.getFullYear(), local.getMonth() - 1, 1);
  const daysInPrev = new Date(local.getFullYear(), local.getMonth(), 0).getDate();
  const day = Math.min(local.getDate(), daysInPrev);
  const month = prevMonth.toLocaleDateString("he-IL", { month: "long" });
  return day === 1 ? `1 ב${month}` : `1–${day} ב${month}`;
}

/** ₪ בלי אגורות לסכומים גדולים (כרטיסייה), עם אגורות לסכום קטן */
export function formatMoneyTile(value: number): string {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    minimumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
  }).format(value);
}

/** "3.10" — יום בגרף */
export function shortDay(isoDay: string): string {
  const [, month, day] = isoDay.split("-");
  return month && day ? `${Number(day)}.${Number(month)}` : isoDay;
}

/** "לפני 5 דק׳" / "היום 14:32" / "3.10 · 09:15" — זמן הזמנה ברשימה */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const diffMinutes = Math.round((now.getTime() - date.getTime()) / 60000);
  if (diffMinutes < 1) return "עכשיו";
  if (diffMinutes < 60) return `לפני ${diffMinutes} דק׳`;
  const time = date.toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jerusalem",
  });
  const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  if (dayKey(date) === dayKey(now)) return `היום ${time}`;
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (dayKey(date) === dayKey(yesterday)) return `אתמול ${time}`;
  return `${shortDay(dayKey(date))} · ${time}`;
}
