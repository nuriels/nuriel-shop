import { supabase } from "@/integrations/supabase/client";
import type { DashboardDay } from "@/lib/dashboard";

/** חלק 26: אנליטיקס לבעל החנות (GET /api/admin/analytics) */
export type AnalyticsPeriod = "month" | "last_month" | "year";

export const ANALYTICS_PERIODS: { value: AnalyticsPeriod; label: string; context: string }[] = [
  { value: "month", label: "החודש", context: "לעומת אותה תקופה בחודש שעבר" },
  { value: "last_month", label: "החודש שעבר", context: "לעומת החודש שלפניו" },
  { value: "year", label: "השנה", context: "לעומת אותה תקופה בשנה שעברה" },
];

export type StoreAnalytics = {
  period: AnalyticsPeriod;
  bucket: "day" | "month";
  revenue: number;
  orders: number;
  paidOrders: number;
  aov: number;
  prev: { revenue: number; orders: number; aov: number };
  series: DashboardDay[];
  topProducts: { productId: string; name: string; units: number }[];
  stockAlerts: { productId: string; name: string; variant: string | null; stock: number }[];
  stockAlertsTotal: number;
};

type Raw = Record<string, unknown>;
const num = (value: unknown) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const rows = (value: unknown): Raw[] => (Array.isArray(value) ? (value as Raw[]) : []);

export function parseAnalytics(raw: unknown): StoreAnalytics {
  const r = (raw ?? {}) as Raw;
  const prev = (r["prev"] ?? {}) as Raw;
  return {
    period: (r["period"] as AnalyticsPeriod) ?? "month",
    bucket: r["bucket"] === "month" ? "month" : "day",
    revenue: num(r["revenue"]),
    orders: num(r["orders"]),
    paidOrders: num(r["paid_orders"]),
    aov: num(r["aov"]),
    prev: { revenue: num(prev["revenue"]), orders: num(prev["orders"]), aov: num(prev["aov"]) },
    series: rows(r["series"]).map((d) => ({
      day: String(d["day"] ?? ""),
      revenue: num(d["revenue"]),
      orders: num(d["orders"]),
    })),
    topProducts: rows(r["top_products"]).map((p) => ({
      productId: String(p["product_id"] ?? ""),
      name: String(p["name"] ?? "מוצר"),
      units: num(p["units"]),
    })),
    stockAlerts: rows(r["stock_alerts"]).map((s) => ({
      productId: String(s["product_id"] ?? ""),
      name: String(s["name"] ?? "מוצר"),
      variant: s["variant"] ? String(s["variant"]) : null,
      stock: num(s["stock"]),
    })),
    stockAlertsTotal: num(r["stock_alerts_total"]),
  };
}

export async function fetchStoreAnalytics(period: AnalyticsPeriod): Promise<StoreAnalytics> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("נדרשת התחברות");
  const res = await fetch(`/api/admin/analytics?period=${period}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json().catch(() => null)) as Raw | null;
  if (!res.ok || !body) throw new Error(String(body?.["error"] ?? "טעינת הנתונים נכשלה"));
  return parseAnalytics(body);
}
