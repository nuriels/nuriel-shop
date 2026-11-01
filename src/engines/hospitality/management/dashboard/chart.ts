// הגרף של לוח הבקרה (שלב F3) — הגאומטריה, טהורה ונבדקת ביחידה. SVG ברוחב 600 ובגובה 200:
//   • ב-RTL הזמן רץ מימין לשמאל: הנקודה הראשונה בקצה הימני, האחרונה בשמאלי;
//   • הכנסות / תפוסה — קו ושטח; הזמנות — עמודות; התקופה הקודמת — קו מקווקו (לפי אותה חלוקה);
//   • ציר ה-Y ב"מספרים עגולים" (1 / 2 / 2.5 / 5 × 10ⁿ).
import type { DashboardSeriesPoint } from "../../types/dashboard";
import { formatMoney } from "../lib/format";
import { shortDate } from "./model";

export type ChartMetric = "revenue" | "bookings" | "occupancy";

export const CHART_W = 600;
export const CHART_H = 200;
const TOP_PAD = 16;

const MONTHS_SHORT = [
  "ינו׳",
  "פבר׳",
  "מרץ",
  "אפר׳",
  "מאי",
  "יוני",
  "יולי",
  "אוג׳",
  "ספט׳",
  "אוק׳",
  "נוב׳",
  "דצמ׳",
];

export interface ChartPoint {
  /** מרכז הנקודה / העמודה (0 בשמאל, 600 בימין) */
  x: number;
  y: number;
  label: string;
  /** "2.11" / "שבוע מ-2.11" / "נובמבר 2026" — לתיאור הנגיש */
  longLabel: string;
  value: number | null;
  previous: number | null;
}

export interface ChartGeometry {
  points: ChartPoint[];
  /** עמודות (הזמנות) */
  bars: { x: number; y: number; w: number; h: number }[];
  line: string;
  area: string;
  prevLine: string;
  yTicks: { y: number; label: string }[];
  /** תוויות ציר X — מיקום באחוזים משמאל */
  xLabels: { left: number; label: string }[];
  top: number;
  total: number | null;
  empty: boolean;
}

/** "מספר עגול" שגדול או שווה לערך */
export function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const exp = Math.floor(Math.log10(v));
  const base = 10 ** exp;
  for (const m of [1, 2, 2.5, 5, 10]) if (m * base >= v - 1e-9) return m * base;
  return 10 * base;
}

/** "12.5K ₪" / "800 ₪" */
export function compactMoney(n: number, currency = "ILS"): string {
  if (Math.abs(n) >= 1000) {
    const k = Math.round((n / 1000) * 10) / 10;
    return `${k}K ${currency === "ILS" ? "₪" : currency}`;
  }
  return formatMoney(Math.round(n), currency);
}

const valueOf = (p: DashboardSeriesPoint | undefined, metric: ChartMetric): number | null =>
  p ? (p[metric] ?? null) : null;

function bucketLabels(p: DashboardSeriesPoint, bucket: "day" | "week" | "month") {
  if (bucket === "month") {
    const d = new Date(`${p.start}T00:00:00Z`);
    return {
      label: MONTHS_SHORT[d.getUTCMonth()]!,
      longLabel: `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
    };
  }
  if (bucket === "week")
    return { label: shortDate(p.start), longLabel: `השבוע שמתחיל ב-${shortDate(p.start)}` };
  return { label: shortDate(p.start), longLabel: shortDate(p.start) };
}

export function chartGeometry(
  series: DashboardSeriesPoint[],
  previous: DashboardSeriesPoint[] | null,
  metric: ChartMetric,
  bucket: "day" | "week" | "month",
  currency = "ILS",
): ChartGeometry {
  const n = series.length;
  const vals = series.map((p) => valueOf(p, metric));
  const prevVals = previous ? series.map((_, i) => valueOf(previous[i], metric)) : [];
  const known = [...vals, ...prevVals].filter((v): v is number => v !== null);
  const top =
    metric === "occupancy"
      ? 100
      : metric === "bookings"
        ? Math.max(2, niceCeil(Math.max(0, ...known)))
        : niceCeil(Math.max(0, ...known));
  const Y = (v: number) => CHART_H - (Math.max(0, v) / top) * (CHART_H - TOP_PAD);
  const slot = n ? CHART_W / n : CHART_W;
  // נקודת קו: מימין לשמאל; עמודה: מרכז המשבצת
  const lineX = (i: number) => (n === 1 ? CHART_W / 2 : CHART_W - (i / (n - 1)) * CHART_W);
  const slotX = (i: number) => CHART_W - (i + 0.5) * slot;
  const xOf = metric === "bookings" ? slotX : lineX;

  const points: ChartPoint[] = series.map((p, i) => ({
    x: xOf(i),
    y: Y(vals[i] ?? 0),
    ...bucketLabels(p, bucket),
    value: vals[i] ?? null,
    previous: previous ? (prevVals[i] ?? null) : null,
  }));

  const path = (arr: (number | null)[], x: (i: number) => number) => {
    let d = "";
    let pen = false;
    arr.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${Y(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };

  const bars =
    metric === "bookings"
      ? vals.map((v, i) => {
          const w = Math.max(2, Math.min(28, slot * 0.56));
          const y = Y(v ?? 0);
          return { x: slotX(i) - w / 2, y, w, h: CHART_H - y };
        })
      : [];
  const line = metric === "bookings" ? "" : path(vals, lineX);
  const allKnown = vals.every((v) => v !== null);
  const area =
    metric !== "bookings" && n > 1 && allKnown
      ? `${line} L${lineX(n - 1).toFixed(1)} ${CHART_H} L${lineX(0).toFixed(1)} ${CHART_H} Z`
      : "";
  const prevLine = previous ? path(prevVals, xOf) : "";

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = top * f;
    return {
      y: Y(v),
      // בלי "0" בתחתית — הקו התחתון מדבר בעד עצמו, והתווית מתנגשת בציר הזמן
      label:
        f === 0
          ? ""
          : metric === "occupancy"
            ? `${Math.round(v)}%`
            : metric === "revenue"
              ? compactMoney(v, currency)
              : String(Math.round(v * 10) / 10),
    };
  });

  // עד 6 תוויות, מפוזרות; ב-RTL האחוז נמדד משמאל
  const want = Math.min(n, 6);
  const idx =
    want <= 1
      ? n
        ? [0]
        : []
      : Array.from(
          new Set(Array.from({ length: want }, (_, k) => Math.round((k * (n - 1)) / (want - 1)))),
        );
  const xLabels = idx.map((i) => ({
    left: (points[i]!.x / CHART_W) * 100,
    label: points[i]!.label,
  }));

  const total =
    metric === "occupancy"
      ? null
      : vals.some((v) => v !== null)
        ? vals.reduce<number>((a, v) => a + (v ?? 0), 0)
        : null;
  const empty = !known.some((v) => v > 0);
  return { points, bars, line, area, prevLine, yTicks, xLabels, top, total, empty };
}
