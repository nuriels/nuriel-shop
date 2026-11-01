// שלב F3: לוח הבקרה — לוח התפוסה (אותם כללים כמו במסד), הגרף (RTL, קו התקופה הקודמת), הקישורים
// הישירים (?period / ?tab / ?filter), ורכיבי הממשק מול ההרשאות (בלי נתונים כספיים למי שאין לו).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RouterContextProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";
import { KpiGrid } from "@/engines/hospitality/management/dashboard/KpiGrid";
import { TrendChart } from "@/engines/hospitality/management/dashboard/TrendChart";
import type {
  DashboardNumbers,
  DashboardOverview,
  DashboardSeriesPoint,
} from "@/engines/hospitality/types/dashboard";
import { describe, expect, it } from "vitest";
import {
  boardModel,
  channelKind,
  shortGuestName,
} from "@/engines/hospitality/management/dashboard/board";
import {
  CHART_H,
  CHART_W,
  chartGeometry,
  compactMoney,
  niceCeil,
} from "@/engines/hospitality/management/dashboard/chart";
import { parseDashboardSearch } from "@/engines/hospitality/management/dashboard/model";
import { parseBookingsSearch } from "@/engines/hospitality/management/bookings/model";
import { parseEmailsSearch } from "@/engines/hospitality/management/emails/model";
import type { CalendarView } from "@/engines/hospitality/types/calendar";

const FROM = "2026-11-01"; // יום ראשון

function view(extra: Partial<CalendarView> = {}): CalendarView {
  return {
    from: FROM,
    to: "2026-11-15",
    today: FROM,
    weekend_nights: [4, 5],
    currency: "ILS",
    stamp: "x",
    properties: [{ id: "p", name: "המתחם" }],
    units: [
      {
        id: "u1",
        name: "בקתת האלון",
        property_id: "p",
        kind: "unit",
        unit_type: "cabin",
        is_active: true,
        member_ids: null,
      },
      {
        id: "u2",
        name: "בקתת הזית",
        property_id: "p",
        kind: "unit",
        unit_type: "cabin",
        is_active: true,
        member_ids: null,
      },
      {
        id: "u3",
        name: "סגורה",
        property_id: "p",
        kind: "unit",
        unit_type: "cabin",
        is_active: false,
        member_ids: null,
      },
      {
        id: "w",
        name: "כל המתחם",
        property_id: "p",
        kind: "whole_property",
        unit_type: "whole",
        is_active: true,
        member_ids: ["u1", "u2"],
      },
    ],
    bookings: [],
    blocks: [],
    ...extra,
  };
}

const booking = (
  o: Partial<CalendarView["bookings"][number]> & {
    id: string;
    unit_id: string;
    check_in: string;
    check_out: string;
  },
) => ({
  number: 1001,
  status: "confirmed" as const,
  adults: 2,
  children: 0,
  total: 1000,
  source: "site",
  channel: null,
  guest_name: "נועה לוי",
  ...o,
});

describe("occupancy board (same rules as the database)", () => {
  it("rows: active physical units only; days from today, weekend nights marked", () => {
    const m = boardModel(view(), FROM, 14);
    expect(m.rows.map((r) => r.name)).toEqual(["בקתת האלון", "בקתת הזית"]);
    expect(m.days).toHaveLength(14);
    expect(m.days[0]).toMatchObject({ date: FROM, dow: 0, today: true, weekend: false });
    expect(m.days[4]).toMatchObject({ date: "2026-11-05", weekend: true });
  });

  it("a direct booking, an Airbnb booking, synced Booking.com dates and a pending request", () => {
    const m = boardModel(
      view({
        bookings: [
          booking({ id: "b1", unit_id: "u1", check_in: FROM, check_out: "2026-11-03" }),
          booking({
            id: "b2",
            unit_id: "u2",
            check_in: "2026-11-02",
            check_out: "2026-11-04",
            source: "external",
            channel: "Airbnb",
          }),
          booking({
            id: "b3",
            unit_id: "u1",
            check_in: "2026-11-10",
            check_out: "2026-11-12",
            status: "pending_approval",
          }),
        ],
        blocks: [
          {
            id: "k1",
            unit_id: "u1",
            unit_name: "",
            start_date: "2026-11-05",
            end_date: "2026-11-07",
            reason: null,
            synced: true,
            channel: "booking",
          },
        ],
      }),
      FROM,
      14,
    );
    const u1 = m.rows[0]!.bars;
    expect(u1.map((b) => [b.kind, b.start, b.span])).toEqual([
      ["direct", 0, 2],
      ["booking", 4, 2],
      ["pending", 9, 2],
    ]);
    expect(u1[0]).toMatchObject({ label: "נועה ל.", bookingId: "b1", bookingNumber: 1001 });
    expect(m.rows[1]!.bars[0]).toMatchObject({ kind: "airbnb", start: 1, span: 2 });
    // night 1 (2.11): u1 direct + u2 airbnb → 100%; pending is not counted until approved
    expect(m.nights[1]).toMatchObject({ occupied: 2, available: 2, pct: 100 });
    expect(m.nights[9]).toMatchObject({ occupied: 0, pct: 0 });
    // synced dates are a stay (channel), not an internal block
    expect(m.nights[4]).toMatchObject({ occupied: 1, available: 2, pct: 50 });
  });

  it("an internal block lowers availability and is not a stay; cancelled bookings are ignored", () => {
    const m = boardModel(
      view({
        bookings: [
          booking({
            id: "c",
            unit_id: "u2",
            check_in: FROM,
            check_out: "2026-11-05",
            status: "cancelled",
          }),
        ],
        blocks: [
          {
            id: "k",
            unit_id: "u1",
            unit_name: "",
            start_date: FROM,
            end_date: "2026-11-03",
            reason: "שיפוץ",
            synced: false,
            channel: null,
          },
        ],
      }),
      FROM,
      14,
    );
    expect(m.rows[1]!.bars).toHaveLength(0);
    expect(m.rows[0]!.bars[0]).toMatchObject({ kind: "block", label: "שיפוץ", bookingId: null });
    expect(m.nights[0]).toMatchObject({ occupied: 0, available: 1, pct: 0 });
  });

  it("a whole-property booking occupies every unit in it — once per unit-night, no double counting", () => {
    const m = boardModel(
      view({
        bookings: [
          booking({ id: "w1", unit_id: "w", check_in: FROM, check_out: "2026-11-02" }),
          booking({
            id: "d1",
            unit_id: "u1",
            check_in: FROM,
            check_out: "2026-11-02",
            source: "external",
            channel: "booking.com",
          }),
        ],
      }),
      FROM,
      14,
    );
    expect(m.rows[0]!.bars.map((b) => b.via)).toContain(true);
    expect(m.rows[1]!.bars[0]).toMatchObject({ via: true, bookingId: "w1" });
    expect(m.nights[0]).toMatchObject({ occupied: 2, available: 2, pct: 100 });
  });

  it("bars cut at the edges of the board are marked; past nights are not drawn", () => {
    const m = boardModel(
      view({
        bookings: [
          booking({ id: "x", unit_id: "u1", check_in: "2026-10-30", check_out: "2026-11-20" }),
        ],
      }),
      FROM,
      14,
    );
    expect(m.rows[0]!.bars[0]).toMatchObject({
      start: 0,
      span: 14,
      clippedStart: true,
      clippedEnd: true,
    });
  });

  it("names and channels", () => {
    expect(shortGuestName("נועה לוי")).toBe("נועה ל.");
    expect(shortGuestName("דנה בת שבע כהן")).toBe("דנה כ.");
    expect(shortGuestName("  ")).toBe("אורח");
    expect(channelKind("Airbnb")).toBe("airbnb");
    expect(channelKind("Booking.com")).toBe("booking");
    expect(channelKind("vrbo")).toBe("channel");
  });
});

const series = (vals: number[], start = FROM): DashboardSeriesPoint[] =>
  vals.map((v, i) => ({
    start: new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10),
    days: 1,
    bookings: v,
    revenue: v * 100,
    occupancy: v * 10,
  }));

describe("chart geometry (RTL, previous period dashed)", () => {
  it("time runs right to left: the first point on the right edge, the last on the left", () => {
    const g = chartGeometry(series([1, 2, 3]), null, "revenue", "day");
    expect(g.points[0]!.x).toBe(CHART_W);
    expect(g.points[2]!.x).toBe(0);
    expect(g.line.startsWith(`M${CHART_W}.0`)).toBe(true);
    expect(g.prevLine).toBe("");
    expect(g.total).toBe(600);
  });

  it("bookings are bars inside their slot; occupancy runs to 100%", () => {
    const b = chartGeometry(series([0, 4]), null, "bookings", "day");
    expect(b.bars).toHaveLength(2);
    expect(b.bars[0]!.x).toBeGreaterThan(CHART_W / 2);
    expect(b.bars[0]!.h).toBe(0);
    expect(b.line).toBe("");
    const o = chartGeometry(series([5, 10]), null, "occupancy", "day");
    expect(o.top).toBe(100);
    expect(o.yTicks.at(-1)!.label).toBe("100%");
    expect(o.total).toBeNull();
  });

  it("the previous period is a dashed line aligned by bucket", () => {
    const g = chartGeometry(series([1, 2, 3]), series([3, 2, 1], "2026-10-29"), "revenue", "day");
    expect(g.prevLine.startsWith("M")).toBe(true);
    expect(g.points.map((p) => p.previous)).toEqual([300, 200, 100]);
  });

  it("no revenue for a user without finance access (null values) — nothing drawn, empty state", () => {
    const s = series([1, 2]).map((p) => ({ ...p, revenue: null }));
    const g = chartGeometry(s, null, "revenue", "day");
    expect(g.line).toBe("");
    expect(g.empty).toBe(true);
    expect(g.total).toBeNull();
  });

  it("round axis numbers and compact money", () => {
    expect(niceCeil(0)).toBe(1);
    expect(niceCeil(7)).toBe(10);
    expect(niceCeil(2300)).toBe(2500);
    expect(niceCeil(4200)).toBe(5000);
    expect(compactMoney(12_500)).toBe("12.5K ₪");
    const g = chartGeometry(series([1]), null, "revenue", "day");
    expect(g.points[0]!.x).toBe(CHART_W / 2);
    expect(g.yTicks[0]!.y).toBe(CHART_H);
  });

  it("week and month labels", () => {
    const w = chartGeometry(series([1, 2]), null, "bookings", "week");
    expect(w.points[0]!.longLabel).toBe("השבוע שמתחיל ב-1.11");
    const m = chartGeometry(
      [{ start: "2026-11-01", days: 30, bookings: 3, revenue: 1, occupancy: 1 }],
      null,
      "bookings",
      "month",
    );
    expect(m.points[0]!.label).toBe("נוב׳");
  });
});

describe("deep links", () => {
  it("dashboard period in the address (unknown → default)", () => {
    expect(parseDashboardSearch({ period: "month" })).toEqual({ period: "month" });
    expect(
      parseDashboardSearch({ period: "custom", from: "2026-10-01", to: "2026-10-31" }),
    ).toEqual({
      period: "custom",
      from: "2026-10-01",
      to: "2026-10-31",
    });
    expect(
      parseDashboardSearch({ period: "custom", from: "2026-10-31", to: "2026-10-01" }),
    ).toEqual({});
    expect(parseDashboardSearch({ period: "year" })).toEqual({});
    expect(parseDashboardSearch({})).toEqual({});
  });

  it("bookings tab and emails filter", () => {
    expect(parseBookingsSearch({ tab: "pending" })).toEqual({ tab: "pending" });
    expect(parseBookingsSearch({ tab: "all" })).toEqual({});
    expect(parseEmailsSearch({ filter: "failed" })).toEqual({ filter: "failed" });
    expect(parseEmailsSearch({ filter: "<script>" })).toEqual({});
  });
});

// ---------- הממשק מול ההרשאה הכספית ----------
function renderUi(ui: ReturnType<typeof createElement>): string {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory({ initialEntries: ["/manage"] }),
  });
  return renderToStaticMarkup(createElement(RouterContextProvider, { router, children: ui }));
}

const numbers = (finance: boolean): DashboardNumbers => ({
  bookings: 7,
  cancellations: 1,
  nights_sold: 12,
  occupied_nights: 10,
  channel_nights: 3,
  blocked_nights: 2,
  available_nights: 28,
  occupancy: 35.7,
  revenue: finance ? 3000 : null,
  collected: finance ? 2400 : null,
  adr: finance ? 428.57 : null,
});

const overview = (finance: boolean): DashboardOverview => ({
  me: { first_name: "דנה" },
  period: {
    from: "2026-10-03",
    to: "2026-11-01",
    days: 30,
    bucket: "day",
    previous_from: "2026-09-03",
    previous_to: "2026-10-02",
    today: "2026-11-01",
  },
  currency: "ILS",
  finance,
  units: 3,
  current: numbers(finance),
  previous: { ...numbers(finance), bookings: 5, occupancy: 30 },
  pending: { count: 1, next_expiry: "2026-11-01T18:00:00Z" },
  series: series([1, 2, 3]).map((p) => (finance ? p : { ...p, revenue: null })),
  previous_series: series([1, 1, 1]).map((p) => (finance ? p : { ...p, revenue: null })),
});

describe("dashboard UI follows the finance permission (the database already returns null)", () => {
  it("owner / granted manager: revenue and collected cards, revenue chart tab", () => {
    const kpis = renderUi(createElement(KpiGrid, { data: overview(true), period: "d30" }));
    expect(kpis).toContain("הכנסות מאירוח");
    expect(kpis).toContain("גבייה בפועל");
    expect(kpis).toContain("80% מההכנסות נגבו");
    expect(kpis).toContain('data-kpi="pending"');
    expect(kpis).toContain("tab=pending");
    const chart = renderUi(
      createElement(TrendChart, { data: overview(true), periodLabel: "30 הימים האחרונים" }),
    );
    expect(chart).toContain(">הכנסות<");
    expect(chart).toContain("התקופה הקודמת");
  });

  it("manager without the grant: no money anywhere — nights sold instead, no revenue tab", () => {
    const kpis = renderUi(createElement(KpiGrid, { data: overview(false), period: "d30" }));
    expect(kpis).not.toContain("הכנסות");
    expect(kpis).not.toContain("גבייה");
    expect(kpis).not.toContain("₪");
    expect(kpis).toContain("לילות שנמכרו");
    const chart = renderUi(
      createElement(TrendChart, { data: overview(false), periodLabel: "30 הימים האחרונים" }),
    );
    expect(chart).not.toContain(">הכנסות<");
    expect(chart).not.toContain("₪");
    expect(chart).toContain("הזמנות חדשות");
  });

  it("comparison: occupancy change in points, bookings in percent", () => {
    const kpis = renderUi(createElement(KpiGrid, { data: overview(true), period: "d30" }));
    expect(kpis).toContain("+40%"); // 7 מול 5
    expect(kpis).toContain("נק׳"); // 35.7 מול 30
  });
});
