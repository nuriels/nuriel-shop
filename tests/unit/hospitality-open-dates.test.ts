// מיגרציה 43 — פתיחת תאריכים להזמנה: המצב של כל יחידה וההתראה ביומן, תאריכים מוכנים, בדיקת הקלט,
// לוח השנה באתר (פנוי / תפוס / עוד לא נפתח) והסגנון שלו, משימה בלוח הבקרה, המייל, ויומן הפעולות.
import { describe, expect, it } from "vitest";
import {
  addMonths,
  isClosedNight,
  openStatus,
  openSummary,
  openText,
  quickUntil,
} from "@/engines/hospitality/management/calendar/open-dates";
import { shortDate } from "@/engines/hospitality/management/calendar/model";
import { taskView } from "@/engines/hospitality/management/dashboard/model";
import { EMAIL_EVENT } from "@/engines/hospitality/management/bookings/model";
import { activityText } from "@/engines/hospitality/management/team/activity";
import { renderBookingEmail } from "@/engines/hospitality/outbox/templates";
import { openDatesError, parseOpenDates } from "@/engines/hospitality/validation/calendar";
import { normalizeDesign } from "@/engines/hospitality/website/design/schema";
import { nightKind } from "@/engines/hospitality/website/lib/dates";
import type { CalendarUnit } from "@/engines/hospitality/types/calendar";

const TODAY = "2026-11-02";
const A = "6a1e0000-0000-4000-8000-0000000000a1";
const B = "6a1e0000-0000-4000-8000-0000000000b1";
const unit = (over: Partial<CalendarUnit>): CalendarUnit => ({
  id: A,
  name: "יחידת אדיר",
  property_id: "p",
  kind: "unit",
  unit_type: "suite",
  is_active: true,
  member_ids: null,
  open_until: null,
  ...over,
});

describe("open dates: the state of a unit", () => {
  it("closed until opened; open through the last open night (inclusive)", () => {
    expect(isClosedNight({ open_until: null }, "2026-11-05")).toBe(true);
    expect(isClosedNight({ open_until: "2026-11-30" }, "2026-11-30")).toBe(false);
    expect(isClosedNight({ open_until: "2026-11-30" }, "2026-12-01")).toBe(true);
  });
  it("status: closed / ending (less than 14 nights left) / open — and the nights left", () => {
    expect(openStatus({ open_until: null }, TODAY)).toEqual({
      state: "closed",
      until: null,
      nightsLeft: 0,
    });
    expect(openStatus({ open_until: "2026-11-01" }, TODAY).state).toBe("closed");
    expect(openStatus({ open_until: "2026-11-02" }, TODAY)).toEqual({
      state: "ending",
      until: "2026-11-02",
      nightsLeft: 1,
    });
    expect(openStatus({ open_until: "2026-11-14" }, TODAY).state).toBe("ending");
    expect(openStatus({ open_until: "2026-11-15" }, TODAY)).toEqual({
      state: "open",
      until: "2026-11-15",
      nightsLeft: 14,
    });
  });
  it("the calendar alert counts active units only", () => {
    const s = openSummary(
      [
        unit({ id: A, open_until: null }),
        unit({ id: B, open_until: "2026-11-10" }),
        unit({ id: "c", open_until: "2027-03-01" }),
        unit({ id: "d", open_until: null, is_active: false }),
      ],
      TODAY,
    );
    expect(s.active).toBe(3);
    expect(s.closed.map((u) => u.id)).toEqual([A]);
    expect(s.ending.map((u) => u.id)).toEqual([B]);
  });
  it("the text in the list", () => {
    expect(openText(openStatus({ open_until: null }, TODAY), shortDate)).toBe(
      "עוד לא נפתחו תאריכים",
    );
    expect(openText(openStatus({ open_until: "2026-11-02" }, TODAY), shortDate)).toContain(
      "לילה אחד",
    );
    expect(openText(openStatus({ open_until: "2026-12-31" }, TODAY), shortDate)).toMatch(
      /^פתוח עד .+ · עוד 60 לילות$/,
    );
  });
});

describe("open dates: ready-made dates", () => {
  it("months ahead (the last day of a short month) and the end of the year", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-02", 3)).toBe("2027-02-02");
    expect(quickUntil("month", TODAY)).toBe("2026-12-01");
    expect(quickUntil("three", TODAY)).toBe("2027-02-01");
    expect(quickUntil("six", TODAY)).toBe("2027-05-01");
    expect(quickUntil("year_end", TODAY)).toBe("2026-12-31");
    // in December — the end of next year
    expect(quickUntil("year_end", "2026-12-15")).toBe("2027-12-31");
  });
});

describe("open dates: input checks (same rules as the database)", () => {
  it("units: at least one, ids only, no duplicates; until: a date or null (close)", () => {
    expect(parseOpenDates({ unitIds: [A, A, B], until: "2026-12-31" })).toEqual({
      unitIds: [A, B],
      until: "2026-12-31",
    });
    expect(parseOpenDates({ unitIds: [A], until: null })).toEqual({ unitIds: [A], until: null });
    expect(() => parseOpenDates({ unitIds: [], until: "2026-12-31" })).toThrow(/לא נבחרו/);
    expect(() => parseOpenDates({ unitIds: ["x"], until: "2026-12-31" })).toThrow();
    expect(() => parseOpenDates({ unitIds: [A], until: "31/12/2026" })).toThrow(/תאריך/);
  });
  it("the form: a past date, more than two years ahead", () => {
    expect(openDatesError("2026-11-01", TODAY)).toMatch(/עבר/);
    expect(openDatesError("2028-11-03", TODAY)).toMatch(/שנתיים/);
    expect(openDatesError("2026-11-02", TODAY)).toBeNull();
    expect(openDatesError(null, TODAY)).toBeNull();
  });
});

describe("the site calendar: free / taken / not open yet", () => {
  const busy = new Set(["2026-11-10"]);
  it("the night state", () => {
    expect(nightKind("2026-11-01", TODAY, busy, "2026-12-31")).toBe("past");
    expect(nightKind("2026-11-10", TODAY, busy, "2026-12-31")).toBe("busy");
    expect(nightKind("2026-11-11", TODAY, busy, "2026-12-31")).toBe("free");
    expect(nightKind("2027-01-01", TODAY, busy, "2026-12-31")).toBe("closed");
    expect(nightKind("2026-11-11", TODAY, busy, null)).toBe("closed");
    // an answer without open_until (an older server) — not limited
    expect(nightKind("2027-01-01", TODAY, busy, undefined)).toBe("free");
  });
  it("the calendar look the owner picks: kept when valid (classic — the default, not stored)", () => {
    expect(normalizeDesign({ theme: "nature", calendar: "colors" }).calendar).toBe("colors");
    expect(normalizeDesign({ theme: "nature", calendar: "minimal" }).calendar).toBe("minimal");
    expect(normalizeDesign({ theme: "nature", calendar: "classic" }).calendar).toBeUndefined();
    expect(normalizeDesign({ theme: "nature", calendar: "neon" }).calendar).toBeUndefined();
    expect(normalizeDesign({ theme: "nature" }).calendar).toBeUndefined();
  });
});

describe("the dashboard task", () => {
  it("closed units — urgent, to the calendar with the open-dates form", () => {
    const v = taskView({
      kind: "open_dates",
      severity: "high",
      count: 2,
      closed: 2,
      ending: 0,
      until: null,
    });
    expect(v.title).toBe("2 יחידות לא פתוחות להזמנה באתר");
    expect(v.tone).toBe("danger");
    expect(v.link).toEqual({ to: "/manage/calendar", search: { open: "1" } });
  });
  it("ending soon — with the date", () => {
    const v = taskView({
      kind: "open_dates",
      severity: "medium",
      count: 1,
      closed: 0,
      ending: 1,
      until: "2026-11-10",
    });
    expect(v.title).toBe("יחידה שהתאריכים הפתוחים שלה נגמרים");
    expect(v.detail).toContain("פתוח עד");
    expect(v.tone).toBe("warning");
  });
});

describe("the reminder email to the owner", () => {
  const ctx = {
    business: {
      name: "נופי דורית",
      phone: null,
      email: null,
      address: null,
      checkInTime: null,
      checkOutTime: null,
    },
    bookingUrl: "https://nofi.example/manage/calendar?open=1",
    escape: (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  };
  it("lists the units and their open dates, links to the calendar", () => {
    const e = renderBookingEmail(
      "open_dates_reminder",
      "owner",
      {
        units: [
          { name: "יחידת מוריה", open_until: null },
          { name: "יחידת אדיר", open_until: "2026-11-10" },
        ],
        unit_count: 3,
        closed_count: 1,
        ending_count: 1,
        today: TODAY,
      },
      ctx,
    )!;
    expect(e.subject).toBe("יש יחידות שלא פתוחות להזמנה באתר");
    expect(e.html).toContain("יחידת מוריה");
    expect(e.html).toContain("לא פתוחה להזמנה");
    expect(e.html).toContain("פתוח עד יום שלישי, 10.11.2026");
    expect(e.html).toContain("ועוד");
    expect(e.html).toContain('href="https://nofi.example/manage/calendar?open=1"');
    expect(e.html).toContain("לפתיחת תאריכים");
    expect(e.html).toContain("לכל היותר פעם בשבוע");
    expect(EMAIL_EVENT["open_dates_reminder"]).toBe("לעסק: תזכורת לפתיחת תאריכים");
  });
  it("only ending soon — another subject", () => {
    const e = renderBookingEmail(
      "open_dates_reminder",
      "owner",
      {
        units: [{ name: "יחידת אדיר", open_until: "2026-11-10" }],
        unit_count: 1,
        closed_count: 0,
        ending_count: 1,
        today: TODAY,
      },
      ctx,
    )!;
    expect(e.subject).toBe("התאריכים הפתוחים להזמנה באתר נגמרים בקרוב");
  });
});

describe("the action log", () => {
  const entry = (action: string, changes: Record<string, unknown>) =>
    ({
      id: "1",
      at: "2026-11-02T10:00:00Z",
      actor: "דורית",
      actor_role: "owner",
      action,
      target: "יחידת אדיר",
      changes,
    }) as never;
  it("opened until a date / closed", () => {
    expect(activityText(entry("calendar.dates_opened", { until: "2026-12-31", units: 1 }))).toBe(
      "דורית פתח/ה להזמנה באתר את יחידת אדיר עד 31.12.2026",
    );
    expect(activityText(entry("calendar.dates_closed", { until: null }))).toBe(
      "דורית סגר/ה להזמנות באתר את יחידת אדיר",
    );
  });
});
