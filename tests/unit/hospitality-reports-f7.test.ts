// שלב F7: דוחות וייצוא — CSV שנפתח ב-Excel בעברית ובלי הזרקת נוסחאות, התקופות המוכנות, הכתובת,
// הקלט לשרת, ועמודות הכספים רק עם הרשאה.
import { describe, expect, it } from "vitest";
import { CSV_BOM, csvCell, csvFileName, toCsv } from "@/engines/hospitality/management/reports/csv";
import {
  bookingColumns,
  effectiveRange,
  monthColumns,
  parseReportsSearch,
  paymentsByMethod,
  presetRange,
  sourceLabel,
  unitColumns,
} from "@/engines/hospitality/management/reports/model";
import type { ReportBooking, ReportPayment } from "@/engines/hospitality/types/reports";
import { parseReportsQuery } from "@/engines/hospitality/validation/reports";

const ID = "0f0e0d0c-0b0a-4908-8706-050403020100";

describe("CSV export", () => {
  it("opens in Excel in Hebrew: a UTF-8 BOM, CRLF lines, quoting", () => {
    const csv = toCsv(
      [
        { label: "שם", value: (r: { n: string; v: number }) => r.n },
        { label: "סכום", value: (r: { n: string; v: number }) => r.v },
      ],
      [
        { n: "דנה, כהן", v: 1500 },
        { n: 'אמא "שלום"', v: 0 },
      ],
    );
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.slice(1)).toBe('שם,סכום\r\n"דנה, כהן",1500\r\n"אמא ""שלום""",0\r\n');
  });

  it("no formula injection: cells starting with = + - @ (or tab / CR) are prefixed", () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe('"\'=HYPERLINK(""http://evil"",""x"")"');
    expect(csvCell("+972501234567")).toBe("'+972501234567");
    expect(csvCell("-2+3")).toBe("'-2+3");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("\tcmd")).toBe("'\tcmd");
    // numbers stay numbers (also negative — a refund)
    expect(csvCell(-250)).toBe("-250");
    expect(csvCell(null)).toBe("");
    expect(csvCell(Number.NaN)).toBe("");
  });

  it("a safe file name", () => {
    expect(csvFileName("bookings", "2026-11-01", "2026-11-30")).toBe(
      "reports-bookings-2026-11-01_2026-11-30.csv",
    );
    expect(csvFileName("../../etc", "2026-11-01", "2026-11-30")).toBe(
      "reports-etc-2026-11-01_2026-11-30.csv",
    );
  });
});

describe("periods and the address", () => {
  it("ready periods by the business's today", () => {
    expect(presetRange("this_month", "2026-11-17")).toEqual({
      from: "2026-11-01",
      to: "2026-11-30",
    });
    expect(presetRange("last_month", "2026-01-10")).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
    expect(presetRange("last_30", "2026-11-17")).toEqual({ from: "2026-10-19", to: "2026-11-17" });
    expect(presetRange("this_year", "2026-11-17")).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });

  it("a custom range is used only when valid and up to a year; otherwise this month", () => {
    expect(
      effectiveRange({ preset: "custom", from: "2026-02-01", to: "2026-02-10" }, "2026-11-17"),
    ).toEqual({
      from: "2026-02-01",
      to: "2026-02-10",
    });
    expect(
      effectiveRange({ preset: "custom", from: "2026-02-10", to: "2026-02-01" }, "2026-11-17").from,
    ).toBe("2026-11-01");
    expect(
      effectiveRange({ preset: "custom", from: "2024-01-01", to: "2026-01-01" }, "2026-11-17").from,
    ).toBe("2026-11-01");
    expect(effectiveRange({}, "2026-11-17")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
  });

  it("the address keeps only known values", () => {
    expect(
      parseReportsSearch({
        preset: "last_90",
        unit: ID.toUpperCase(),
        source: "external",
        status: "cancelled",
        from: "x",
      }),
    ).toEqual({ preset: "last_90", unit: ID, source: "external", status: "cancelled" });
    expect(
      parseReportsSearch({ preset: "all", unit: "1 OR 1=1", source: "fax", status: "lost" }),
    ).toEqual({});
  });

  it("server input: dates, at most a year, uuids, known sources and statuses", () => {
    expect(
      parseReportsQuery({ from: "2026-11-01", to: "2026-11-30", units: [ID], sources: ["phone"] }),
    ).toEqual({
      from: "2026-11-01",
      to: "2026-11-30",
      units: [ID],
      sources: ["phone"],
      statuses: null,
    });
    expect(() => parseReportsQuery({ from: "2026-11-30", to: "2026-11-01" })).toThrow(/טווח/);
    expect(() => parseReportsQuery({ from: "2025-01-01", to: "2026-11-01" })).toThrow(/שנה/);
    expect(() =>
      parseReportsQuery({ from: "2026-11-01", to: "2026-11-30", units: ["x"] }),
    ).toThrow();
    expect(() =>
      parseReportsQuery({ from: "2026-11-01", to: "2026-11-30", sources: ["fax"] }),
    ).toThrow();
    expect(() =>
      parseReportsQuery({ from: "2026-11-01", to: "2026-11-30", statuses: ["lost"] }),
    ).toThrow();
  });
});

describe("columns and labels", () => {
  it("money columns only with the finance permission", () => {
    expect(monthColumns(false).map((c) => c.label)).not.toContain("הכנסות");
    expect(monthColumns(true).map((c) => c.label)).toContain("הכנסות");
    expect(unitColumns(false).map((c) => c.label)).not.toContain("ממוצע ללילה");
    const b = {
      number: 7,
      status: "confirmed",
      source: "external",
      channel: "airbnb",
      unit: "צימר",
      guest: "=cmd",
      check_in: "2026-11-02",
      check_out: "2026-11-04",
      nights: 2,
      adults: 2,
      children: 0,
      created_at: "2026-10-01T10:00:00Z",
      total: 1000,
      paid: 0,
    } as ReportBooking;
    const noFin = toCsv(bookingColumns(false), [b]);
    expect(noFin).not.toContain("1000");
    expect(noFin).toContain("Airbnb");
    expect(noFin).toContain("'=cmd");
    expect(toCsv(bookingColumns(true), [b])).toContain(",1000,0");
  });

  it("sources and payments by method", () => {
    expect(sourceLabel("external", "booking")).toBe("Booking.com");
    expect(sourceLabel("walk_in")).toBe("הגיעו למקום");
    const p = (method: string, amount: number) => ({ method, amount }) as ReportPayment;
    expect(paymentsByMethod([p("cash", 100), p("transfer", 600), p("cash", -50)])).toEqual([
      { method: "transfer", total: 600 },
      { method: "cash", total: 50 },
    ]);
  });
});
