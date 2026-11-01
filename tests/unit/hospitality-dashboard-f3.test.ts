// שלב F3: לוח הבקרה — תקופות, ברכה, שינוי מול התקופה הקודמת, "דורש טיפול" (כל משימה — יעד אמיתי)
import { describe, expect, it } from "vitest";
import {
  businessToday,
  collectedShare,
  deltas,
  greeting,
  initials,
  longDate,
  percentChange,
  periodRange,
  periodText,
  pointChange,
  sortTasks,
  taskView,
} from "@/engines/hospitality/management/dashboard/model";
import {
  parseDashboardRange,
  parseFinanceGrant,
  rangeDays,
} from "@/engines/hospitality/validation/dashboard";
import type { DashboardNumbers } from "@/engines/hospitality/types/dashboard";

const n = (extra: Partial<DashboardNumbers> = {}): DashboardNumbers => ({
  bookings: 10,
  cancellations: 1,
  nights_sold: 20,
  occupied_nights: 20,
  channel_nights: 5,
  blocked_nights: 2,
  available_nights: 40,
  occupancy: 50,
  revenue: 10000,
  collected: 8000,
  adr: 500,
  ...extra,
});

describe("periods (business date)", () => {
  const today = "2026-11-02"; // a Monday
  it("today, this week (from Sunday), this month, 30 days, previous month", () => {
    expect(periodRange("today", today)).toEqual({ from: today, to: today });
    expect(periodRange("week", today)).toEqual({ from: "2026-11-01", to: today });
    expect(periodRange("month", today)).toEqual({ from: "2026-11-01", to: today });
    expect(periodRange("d30", today)).toEqual({ from: "2026-10-04", to: today });
    expect(periodRange("prev_month", today)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(periodRange("prev_month", "2026-03-15")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(periodRange("prev_month", "2026-01-10")).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });
  it("a custom range is used as given; a reversed one falls back to 30 days", () => {
    expect(periodRange("custom", today, { from: "2026-10-13", to: "2026-11-02" })).toEqual({
      from: "2026-10-13",
      to: "2026-11-02",
    });
    expect(periodRange("custom", today, { from: "2026-11-05", to: "2026-11-01" })).toEqual(
      periodRange("d30", today),
    );
  });
  it("texts in Hebrew", () => {
    expect(periodText("prev_month", periodRange("prev_month", today))).toBe("אוקטובר 2026");
    expect(periodText("custom", { from: "2026-10-13", to: "2026-11-02" })).toBe("13.10 – 2.11");
    expect(longDate(today)).toBe("יום שני, 2 בנובמבר 2026");
  });
  it("the business date follows its time zone, not the server's", () => {
    // 23:30 UTC on 1.11 is already 2.11 in Israel
    expect(businessToday("Asia/Jerusalem", new Date("2026-11-01T23:30:00Z"))).toBe("2026-11-02");
    expect(businessToday("UTC", new Date("2026-11-01T23:30:00Z"))).toBe("2026-11-01");
  });
  it("greeting by the hour", () => {
    expect(greeting(8)).toBe("בוקר טוב");
    expect(greeting(13)).toBe("צהריים טובים");
    expect(greeting(19)).toBe("ערב טוב");
    expect(greeting(2)).toBe("לילה טוב");
  });
});

describe("comparison with the previous period", () => {
  it("percent change; none when there is no previous period or it was zero", () => {
    expect(percentChange(120, 100)).toBe(20);
    expect(percentChange(80, 100)).toBe(-20);
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(5, null)).toBeNull();
    expect(percentChange(null, 5)).toBeNull();
  });
  it("occupancy in percentage points", () => {
    expect(pointChange(71, 66)).toBe(5);
    expect(pointChange(50, null)).toBeNull();
  });
  it("all deltas at once; finance hidden → null", () => {
    const d = deltas(n(), n({ bookings: 8, revenue: 8000, occupancy: 45 }));
    expect(d.bookings).toBe(25);
    expect(d.revenue).toBe(25);
    expect(d.occupancy).toBe(5);
    expect(deltas(n({ revenue: null, collected: null }), n()).revenue).toBeNull();
    expect(deltas(n(), null).bookings).toBeNull();
  });
  it("collected share of revenue", () => {
    expect(collectedShare(n())).toBe(80);
    expect(collectedShare(n({ revenue: 0 }))).toBeNull();
    expect(collectedShare(n({ revenue: null }))).toBeNull();
  });
});

describe("needs attention — every task leads somewhere real", () => {
  const now = Date.parse("2026-11-02T10:00:00Z");
  it("one pending request → its booking; several → the pending tab", () => {
    const one = taskView(
      {
        kind: "pending",
        severity: "high",
        count: 1,
        booking_id: "b1",
        due: "2026-11-02T12:40:00Z",
      },
      now,
    );
    expect(one.link).toEqual({ to: "/manage/bookings/$bookingId", params: { bookingId: "b1" } });
    expect(one.detail).toContain("2:40");
    const many = taskView({ kind: "pending", severity: "high", count: 3, booking_id: "b1" }, now);
    expect(many.title).toBe("3 בקשות ממתינות לאישור");
    expect(many.link).toEqual({ to: "/manage/bookings", search: { tab: "pending" } });
  });
  it("deposit → the payments card of the booking; channels, emails, prices, site, plan", () => {
    expect(
      taskView({
        kind: "deposits",
        severity: "medium",
        count: 1,
        booking_id: "b6",
        booking_number: 1006,
      }).link,
    ).toEqual({
      to: "/manage/bookings/$bookingId",
      params: { bookingId: "b6" },
      hash: "payments",
    });
    expect(taskView({ kind: "channels", severity: "high", count: 1, conflicts: 1 }).link).toEqual({
      to: "/manage/channels",
    });
    expect(taskView({ kind: "emails", severity: "medium", count: 2 }).link).toEqual({
      to: "/manage/emails",
      search: { filter: "failed" },
    });
    expect(taskView({ kind: "prices", severity: "medium", count: 1 }).link).toEqual({
      to: "/manage/pricing",
    });
    expect(taskView({ kind: "site", severity: "low", count: 1 }).link).toEqual({
      to: "/manage/website",
    });
    expect(taskView({ kind: "plan", severity: "high", count: 1, inactive: true }).link).toEqual({
      to: "/manage",
      hash: "plan",
    });
  });
  it("urgent first", () => {
    expect(
      sortTasks([
        { kind: "site", severity: "low", count: 1 },
        { kind: "pending", severity: "high", count: 1 },
        { kind: "emails", severity: "medium", count: 1 },
      ]).map((t) => t.kind),
    ).toEqual(["pending", "emails", "site"]);
  });
  it("avatar initials", () => {
    expect(initials("נועה ל.")).toBe("נל");
    expect(initials("אורח")).toBe("א");
  });
});

describe("input: range and finance grant (same rules as the database)", () => {
  it("range: inclusive days, end before start refused, a year at most", () => {
    expect(rangeDays("2026-11-01", "2026-11-01")).toBe(1);
    expect(parseDashboardRange({ from: "2026-10-04", to: "2026-11-02" })).toEqual({
      from: "2026-10-04",
      to: "2026-11-02",
    });
    expect(() => parseDashboardRange({ from: "2026-11-02", to: "2026-11-01" })).toThrow(/טווח/);
    expect(() => parseDashboardRange({ from: "2026-01-01", to: "2027-01-02" })).toThrow(/שנה/);
    expect(() => parseDashboardRange({ from: "x", to: "2026-11-01" })).toThrow();
  });
  it("grant: a manager id and an explicit true / false", () => {
    const id = "3f1c2b9a-6d4e-4f8a-9b1c-2d3e4f5a6b7c";
    expect(parseFinanceGrant({ userId: id, enabled: true })).toEqual({ userId: id, enabled: true });
    expect(() => parseFinanceGrant({ userId: id, enabled: "yes" })).toThrow();
    expect(() => parseFinanceGrant({ userId: "x", enabled: false })).toThrow();
  });
});
