// Stage 3a — היומן: טווחי חודש / שבוע, שורות ופסים (כולל "כל המתחם" ויחידותיו), סינון,
// סדר יום, חיפוש, וירטואליזציה, ובדיקת הקלט (אותן הודעות כמו המסד).
import { describe, expect, it } from "vitest";
import {
  addDays,
  agenda,
  buildRows,
  dayLabel,
  daysOf,
  isFreeNight,
  monthTitle,
  nightsText,
  rangeFor,
  search,
  shift,
  toneOf,
  visibleWindow,
  conflictMarks,
  freeByNight,
  maskGuests,
  monthAnchor,
  monthOptions,
  nightState,
  shortDate,
  unitCards,
  type Row,
} from "@/engines/hospitality/management/calendar/model";
import {
  MAX_RANGE_DAYS,
  blockError,
  parseBlock,
  parseCalendarQuery,
} from "@/engines/hospitality/validation/calendar";
import type { CalendarBooking, CalendarView } from "@/engines/hospitality/types/calendar";

const id = (n: number) => `6a1e0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P1 = id(1);
const P2 = id(2);
const U1 = id(11);
const U2 = id(12);
const W = id(13);
const U3 = id(21);

const booking = (
  n: number,
  unit: string,
  inn: string,
  out: string,
  status: CalendarBooking["status"] = "confirmed",
  guest = "דנה כהן",
): CalendarBooking => ({
  id: id(100 + n),
  number: n,
  unit_id: unit,
  check_in: inn,
  check_out: out,
  status,
  adults: 2,
  children: 0,
  total: 1000,
  source: "site",
  channel: null,
  guest_name: guest,
});

const view = (over: Partial<CalendarView> = {}): CalendarView => ({
  from: "2026-12-01",
  to: "2027-01-01",
  today: "2026-12-03",
  weekend_nights: [4, 5],
  currency: "ILS",
  stamp: "x",
  properties: [
    { id: P1, name: "מתחם הגפן" },
    { id: P2, name: "בית התאנה" },
  ],
  units: [
    {
      id: U1,
      name: "צימר אלון",
      property_id: P1,
      kind: "unit",
      unit_type: "zimmer",
      is_active: true,
      member_ids: null,
    },
    {
      id: U2,
      name: "צימר ברוש",
      property_id: P1,
      kind: "unit",
      unit_type: "suite",
      is_active: true,
      member_ids: null,
    },
    {
      id: W,
      name: "כל המתחם — מתחם הגפן",
      property_id: P1,
      kind: "whole_property",
      unit_type: "villa",
      is_active: true,
      member_ids: [U1, U2],
    },
    {
      id: U3,
      name: "הבית",
      property_id: P2,
      kind: "unit",
      unit_type: "villa",
      is_active: true,
      member_ids: null,
    },
  ],
  bookings: [
    booking(1, U1, "2026-11-29", "2026-12-03"),
    booking(2, U2, "2026-12-10", "2026-12-12", "pending_approval", "יוסי לוי"),
    booking(3, W, "2026-12-20", "2026-12-22", "checked_in", "משפחת שמש"),
    booking(4, U3, "2026-12-30", "2027-01-04", "cancelled", "רון"),
  ],
  blocks: [
    {
      id: id(200),
      unit_id: U3,
      unit_name: "הבית",
      start_date: "2026-12-05",
      end_date: "2026-12-07",
      reason: "שיפוץ",
    },
  ],
  ...over,
});

const units = (rows: Row[]) =>
  rows.filter((r): r is Extract<Row, { type: "unit" }> => r.type === "unit");

describe("dates and ranges", () => {
  it("month: the first of the month to the first of the next; across a year", () => {
    expect(rangeFor("month", "2026-12-17")).toEqual({ from: "2026-12-01", to: "2027-01-01" });
    expect(rangeFor("month", "2027-02-10")).toEqual({ from: "2027-02-01", to: "2027-03-01" });
  });
  it("week: Sunday to Sunday; agenda: 14 days from the anchor", () => {
    expect(rangeFor("week", "2026-12-03")).toEqual({ from: "2026-11-29", to: "2026-12-06" });
    expect(rangeFor("agenda", "2026-12-03")).toEqual({ from: "2026-12-03", to: "2026-12-17" });
  });
  it("prev / next", () => {
    expect(shift("month", "2026-12-01", 1)).toBe("2027-01-01");
    expect(shift("month", "2026-01-01", -1)).toBe("2025-12-01");
    expect(shift("week", "2026-12-03", -1)).toBe("2026-11-26");
  });
  it("days, labels, nights", () => {
    expect(daysOf("2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30"); // שעון קיץ — בלי הסטה
    expect(monthTitle("2026-12-01")).toBe("דצמבר 2026");
    expect(dayLabel("2026-12-03")).toBe("ה׳ 3.12");
    expect(nightsText({ check_in: "2026-12-01", check_out: "2026-12-02" })).toBe("לילה אחד");
    expect(nightsText({ check_in: "2026-12-01", check_out: "2026-12-04" })).toBe("3 לילות");
  });
});

describe("rows and bars", () => {
  const all = { propertyId: "", unitId: "", unitType: "", tone: "" as const };

  it("rows by property: a heading, then its units; the whole property as its own row", () => {
    const rows = buildRows(view(), all);
    expect(rows.map((r) => (r.type === "property" ? `# ${r.name}` : r.unit.name))).toEqual([
      "# מתחם הגפן",
      "צימר אלון",
      "צימר ברוש",
      "כל המתחם — מתחם הגפן",
      "# בית התאנה",
      "הבית",
    ]);
  });

  it("a booking that started before the month is clipped at the start", () => {
    const [alon] = units(buildRows(view(), all));
    const b = alon!.bars.find((x) => !x.via)!;
    expect(b).toMatchObject({
      start: 0,
      span: 2,
      clippedStart: true,
      clippedEnd: false,
      tone: "confirmed",
      label: "#1 דנה כהן",
    });
  });

  it("whole property: its booking shows on each of its units (dimmed); a unit's booking shows on the whole row (dimmed)", () => {
    const rows = units(buildRows(view(), all));
    const alon = rows.find((r) => r.unit.id === U1)!;
    const whole = rows.find((r) => r.unit.id === W)!;
    expect(alon.bars.filter((b) => b.via).map((b) => b.booking!.number)).toEqual([3]);
    expect(whole.bars.filter((b) => !b.via).map((b) => b.booking!.number)).toEqual([3]);
    expect(
      whole.bars
        .filter((b) => b.via)
        .map((b) => b.booking!.number)
        .sort(),
    ).toEqual([1, 2]);
    // ימים תפוסים "דרך" — לא פנויים לחסימה
    expect(isFreeNight(alon, 19)).toBe(false);
    expect(isFreeNight(alon, 25)).toBe(true);
    expect(isFreeNight(whole, 9)).toBe(false);
  });

  it("blocks: a striped bar with the reason; clipped at the end of the range", () => {
    const bait = units(buildRows(view(), all)).find((r) => r.unit.id === U3)!;
    expect(bait.bars.map((b) => [b.kind, b.label, b.start, b.span, b.clippedEnd])).toEqual([
      ["block", "חסום — שיפוץ", 4, 2, false],
      ["booking", "#4 רון", 29, 2, true],
    ]);
    expect(toneOf("cancelled")).toBe("cancelled");
  });

  it("one unit (its own calendar): the unit and the whole property it belongs to; a whole property: its units too", () => {
    expect(units(buildRows(view(), { ...all, unitId: U1 })).map((r) => r.unit.name)).toEqual([
      "צימר אלון",
      "כל המתחם — מתחם הגפן",
    ]);
    expect(units(buildRows(view(), { ...all, unitId: W })).map((r) => r.unit.name)).toEqual([
      "צימר אלון",
      "צימר ברוש",
      "כל המתחם — מתחם הגפן",
    ]);
    expect(units(buildRows(view(), { ...all, unitId: U3 })).map((r) => r.unit.name)).toEqual([
      "הבית",
    ]);
    // the agenda follows the same filter: the whole-property stay is on Alon's agenda, the house block is not
    const days = agenda(view({ from: "2026-12-05", to: "2026-12-22" }), {
      propertyId: "",
      unitId: U1,
    });
    expect(days.flatMap((d) => d.arrivals.map((b) => b.number))).toEqual([3]);
    expect(days.flatMap((d) => d.blocks)).toEqual([]);
  });

  it("filters: property, unit type (the whole property stays), status", () => {
    expect(units(buildRows(view(), { ...all, propertyId: P2 })).map((r) => r.unit.name)).toEqual([
      "הבית",
    ]);
    expect(units(buildRows(view(), { ...all, unitType: "suite" })).map((r) => r.unit.name)).toEqual(
      ["צימר ברוש", "כל המתחם — מתחם הגפן"],
    );
    const pending = units(buildRows(view(), { ...all, tone: "pending" }));
    expect(
      pending.flatMap((r) => r.bars.filter((b) => !b.via).map((b) => b.booking!.number)),
    ).toEqual([2]);
    const blocks = units(buildRows(view(), { ...all, tone: "block" }));
    expect(blocks.flatMap((r) => r.bars.map((b) => b.kind))).toEqual(["block"]);
  });

  it("hundreds of units: rows built once, quickly", () => {
    const many = view({
      units: Array.from({ length: 600 }, (_, i) => ({
        id: id(1000 + i),
        name: `יחידה ${i}`,
        property_id: i % 2 ? P1 : P2,
        kind: "unit" as const,
        unit_type: "room",
        is_active: true,
        member_ids: null,
      })),
      bookings: Array.from({ length: 3000 }, (_, i) =>
        booking(
          10 + i,
          id(1000 + (i % 600)),
          addDays("2026-12-01", i % 28),
          addDays("2026-12-01", (i % 28) + 2),
        ),
      ),
      blocks: [],
    });
    const t = performance.now();
    const rows = buildRows(many, all);
    expect(performance.now() - t).toBeLessThan(500);
    expect(units(rows)).toHaveLength(600);
    expect(units(rows).reduce((n, r) => n + r.bars.length, 0)).toBe(3000);
  });
});

describe("agenda, search, virtual rows", () => {
  it("agenda: arrivals, departures, staying and blocks per day; cancelled bookings left out", () => {
    const days = agenda(view({ from: "2026-12-03", to: "2026-12-07" }));
    expect(days[0]).toMatchObject({ date: "2026-12-03" });
    expect(days[0]!.departures.map((b) => b.number)).toEqual([1]);
    expect(days[2]!.blocks.map((k) => k.reason)).toEqual(["שיפוץ"]);
    const late = agenda(view({ from: "2026-12-30", to: "2026-12-31" }));
    expect(late[0]!.arrivals).toEqual([]);
  });
  it("search by number (with or without #) or by part of the guest's name", () => {
    expect(search(view(), "#2").map((b) => b.number)).toEqual([2]);
    expect(search(view(), "3").map((b) => b.number)).toEqual([3]);
    expect(search(view(), "שמש").map((b) => b.number)).toEqual([3]);
    expect(search(view(), "  ")).toEqual([]);
  });
  it("only the visible rows (plus a margin) are drawn", () => {
    expect(visibleWindow(0, 440, 44, 600)).toEqual({ first: 0, last: 16 });
    expect(visibleWindow(4400, 440, 44, 600)).toEqual({ first: 94, last: 116 });
    expect(visibleWindow(26000, 440, 44, 600).last).toBe(600);
  });
});

describe("input checks (same messages as the database)", () => {
  it("calendar range: dates, order, at most two months", () => {
    expect(parseCalendarQuery({ from: "2026-12-01", to: "2027-01-01" })).toEqual({
      from: "2026-12-01",
      to: "2027-01-01",
      unitIds: null,
      includeCancelled: false,
    });
    expect(() => parseCalendarQuery({ from: "2026-12-01", to: "2026-12-01" })).toThrow(
      "טווח התאריכים לא תקין",
    );
    expect(() =>
      parseCalendarQuery({ from: "2026-12-01", to: addDays("2026-12-01", MAX_RANGE_DAYS + 1) }),
    ).toThrow("עד 62 ימים");
    expect(() => parseCalendarQuery({ from: "1.12.2026", to: "2027-01-01" })).toThrow(
      "תאריך לא תקין",
    );
    expect(() =>
      parseCalendarQuery({ from: "2026-12-01", to: "2027-01-01", unitIds: ["x"] }),
    ).toThrow();
  });
  it("block: dates in order, not in the past, up to a year, reason up to 300 characters", () => {
    expect(blockError("2026-12-05", "2026-12-07", "", "2026-12-03")).toBeNull();
    expect(blockError("2026-12-05", "2026-12-05", "", "2026-12-03")).toContain("אחריו");
    expect(blockError("2026-11-01", "2026-11-03", "", "2026-12-03")).toBe(
      "אי אפשר לחסום תאריכים שעברו",
    );
    expect(blockError("2026-12-05", "2028-12-05", "", "2026-12-03")).toBe("חסימה אחת — עד שנה");
    expect(blockError("2026-12-05", "2026-12-07", "א".repeat(301), "2026-12-03")).toContain(
      "ארוכה מדי",
    );
    expect(parseBlock({ unitId: U1, from: "2026-12-05", to: "2026-12-07", reason: "  " })).toEqual({
      unitId: U1,
      id: null,
      from: "2026-12-05",
      to: "2026-12-07",
      reason: null,
    });
    expect(() =>
      parseBlock({ unitId: "not-a-uuid", from: "2026-12-05", to: "2026-12-07" }),
    ).toThrow();
    expect(() =>
      parseBlock({ unitId: U1, from: "2026-12-05", to: "2026-12-07", reason: 5 }),
    ).toThrow("ערך לא תקין");
  });
});

// ---------- Calendar Pro ----------
describe("Calendar Pro: one glance — free / occupied, conflicts, unit cards", () => {
  const all = { propertyId: "", unitId: "", unitType: "", tone: "" as const };
  const ix = (d: string) => Math.round((Date.parse(d) - Date.parse("2026-12-01")) / 86400000);

  it("each night of a unit: booked / pending / blocked / external / free; cancelled does not occupy", () => {
    const rows = units(
      buildRows(
        view({
          blocks: [
            ...view().blocks,
            {
              id: id(201),
              unit_id: U2,
              unit_name: "צימר ברוש",
              start_date: "2026-12-15",
              end_date: "2026-12-16",
              reason: null,
              synced: true,
              channel: "airbnb",
            },
          ],
        }),
        all,
      ),
    );
    const u1 = rows.find((r) => r.unit.id === U1)!;
    const u2 = rows.find((r) => r.unit.id === U2)!;
    const u3 = rows.find((r) => r.unit.id === U3)!;
    expect(nightState(u1, ix("2026-12-02"))).toBe("booked");
    expect(nightState(u1, ix("2026-12-03"))).toBe("free");
    // the whole property's booking occupies its units ("via")
    expect(nightState(u1, ix("2026-12-20"))).toBe("booked");
    expect(nightState(u2, ix("2026-12-10"))).toBe("pending");
    expect(nightState(u2, ix("2026-12-15"))).toBe("external");
    expect(nightState(u3, ix("2026-12-05"))).toBe("block");
    const withCancelled = units(buildRows(view(), all));
    expect(
      nightState(
        withCancelled.find((r) => r.unit.id === U3)!,
        ix("2026-12-30"),
      ),
    ).toBe("free");
  });

  it("the free row: active units only (not the whole property), per night", () => {
    const free = freeByNight(buildRows(view(), all), 31);
    expect(free[ix("2026-12-02")]).toEqual({ free: 2, total: 3 });
    // the whole property is booked: both of its units are taken, the other property is free
    expect(free[ix("2026-12-20")]).toEqual({ free: 1, total: 3 });
    expect(free[ix("2026-12-05")]).toEqual({ free: 2, total: 3 });
    expect(free[ix("2026-12-25")]).toEqual({ free: 3, total: 3 });
  });

  it("conflicts with external calendars: only inside the range, per unit, with the channel name", () => {
    const marks = conflictMarks(
      [
        {
          unit_id: U1,
          calendars: [
            {
              id: "c1",
              channel: "airbnb",
              conflicts: [{ uid: "a", from: "2026-12-02", to: "2026-12-04" }],
            },
            {
              id: "c2",
              channel: "booking",
              conflicts: [{ uid: "b", from: "2027-02-01", to: "2027-02-03" }],
            },
          ],
        },
      ],
      "2026-12-01",
      "2027-01-01",
    );
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ unitId: U1, label: "Airbnb", start: 1, span: 2 });
  });

  it("without the guests permission: no guest names anywhere (number only)", () => {
    const masked = maskGuests(view());
    expect(masked.bookings.every((b) => b.guest_name === null)).toBe(true);
    expect(units(buildRows(masked, all)).find((r) => r.unit.id === U1)!.bars[0]!.label).toBe("#1");
    expect(search(masked, "דנה")).toEqual([]);
    expect(view().bookings[0]!.guest_name).toBe("דנה כהן");
  });

  it("unit cards: tonight, arriving / leaving today, the next arrival, the 14-night strip", () => {
    const v = view({ from: "2026-12-03", to: "2026-12-17", today: "2026-12-03" });
    const cards = unitCards(v, all);
    expect(cards.map((c) => c.unit.id)).toEqual([U1, U2, U3]);
    const u1 = cards[0]!;
    expect(u1.tonight).toBe("free");
    expect(u1.leaving?.number).toBe(1);
    expect(u1.strip).toHaveLength(14);
    const u2 = cards[1]!;
    expect(u2.next?.number).toBe(2);
    expect(u2.strip[ix("2026-12-10") - 2]).toBe("pending");
    const u3 = cards[2]!;
    expect(u3.strip[2]).toBe("block");
    expect(u3.freeNights).toBe(12);
  });

  it("units view range and quick month navigation", () => {
    expect(rangeFor("units", "2026-12-03")).toEqual({ from: "2026-12-03", to: "2026-12-17" });
    expect(shift("units", "2026-12-03", 1)).toBe("2026-12-17");
    expect(monthAnchor("2027-03")).toBe("2027-03-01");
    expect(monthAnchor("2027-13")).toBeNull();
    expect(monthAnchor("x")).toBeNull();
    expect(shortDate("2026-12-05")).toBe("5.12");
    const opts = monthOptions("2026-12-03", "2026-12");
    expect(opts).toHaveLength(31);
    expect(opts[0]).toEqual({ value: "2025-12", label: "דצמבר 2025" });
    expect(opts.find((o) => o.value === "2026-12")?.label).toBe("דצמבר 2026");
    // a month far away (navigated with "next") is still in the list
    expect(monthOptions("2026-12-03", "2029-04").some((o) => o.value === "2029-04")).toBe(true);
  });
});
