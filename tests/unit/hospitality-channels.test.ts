// סנכרון ערוצים (iCal): קריאת יומנים בפורמט של Airbnb / Booking.com, בניית יומן הייצוא (בלי
// פרטים אישיים), והגשה בשער רק לטוקן תקין.
import { describe, expect, it, vi } from "vitest";
import type { SiteRef } from "@/platform/engines/contract";
import { buildIcs, icsDate, looksLikeIcs, parseIcs } from "@/engines/hospitality/channels/ical";
import { hospitalityGate } from "@/engines/hospitality/edge/gate";

const AIRBNB = [
  "BEGIN:VCALENDAR",
  "PRODID:-//Airbnb Inc//Hosting Calendar 0.8.8//EN",
  "CALSCALE:GREGORIAN",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "DTEND;VALUE=DATE:20270213",
  "DTSTART;VALUE=DATE:20270210",
  "UID:1418fb94e984-0d8e5e7e5d5a1f2b@airbnb.com",
  "SUMMARY:Reserved",
  "DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMABC\\nPhone Number (Last 4 Digits): 1234",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTEND;VALUE=DATE:20270301",
  "DTSTART;VALUE=DATE:20270225",
  "UID:7f1e0c2b-airbnb-blocked@airbnb.com",
  "SUMMARY:Airbnb (Not available)",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

const BOOKING = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//admin.booking.com//EN",
  "BEGIN:VEVENT",
  "UID:8f0e1f8c5b0c4d3e9a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f@booking.co",
  " m",
  "DTSTART;VALUE=DATE:20270405",
  "DTEND;VALUE=DATE:20270408",
  "SUMMARY:CLOSED - Not available",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:no-end@x",
  "DTSTART:20270410T140000Z",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:backwards@x",
  "DTSTART;VALUE=DATE:20270420",
  "DTEND;VALUE=DATE:20270418",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20270430",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\n");

describe("iCal import", () => {
  it("reads Airbnb events: dates and UID only (no guest details kept)", () => {
    const events = parseIcs(AIRBNB);
    expect(events).toEqual([
      { uid: "1418fb94e984-0d8e5e7e5d5a1f2b@airbnb.com", from: "2027-02-10", to: "2027-02-13" },
      { uid: "7f1e0c2b-airbnb-blocked@airbnb.com", from: "2027-02-25", to: "2027-03-01" },
    ]);
    expect(JSON.stringify(events)).not.toContain("1234");
  });

  it("Booking.com: folded lines, LF endings, missing DTEND = one night, invalid events skipped", () => {
    expect(parseIcs(BOOKING)).toEqual([
      {
        uid: "8f0e1f8c5b0c4d3e9a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f@booking.com",
        from: "2027-04-05",
        to: "2027-04-08",
      },
      { uid: "no-end@x", from: "2027-04-10", to: "2027-04-11" },
    ]);
  });

  it("dates: DATE and DATE-TIME forms, impossible dates rejected; only real calendars accepted", () => {
    expect(icsDate("20270210")).toBe("2027-02-10");
    expect(icsDate("20270210T140000Z")).toBe("2027-02-10");
    expect(icsDate("2027-02-10")).toBe("2027-02-10");
    expect(icsDate("20270231")).toBeNull();
    expect(icsDate("garbage")).toBeNull();
    expect(looksLikeIcs(AIRBNB)).toBe(true);
    expect(looksLikeIcs("<!doctype html><html>")).toBe(false);
  });
});

describe("iCal export", () => {
  it("builds a valid calendar: CRLF, all-day events, 'Not available', no personal data", () => {
    const ics = buildIcs({
      calendarName: "צימר הגפן",
      events: [
        { uid: "b-1", from: "2026-11-01", to: "2026-11-03" },
        { uid: "k-2", from: "2026-11-06", to: "2026-11-08" },
      ],
      now: new Date("2026-11-01T10:00:00Z"),
    });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261101\r\n");
    expect(ics).toContain("DTEND;VALUE=DATE:20261103\r\n");
    expect(ics).toContain("UID:b-1@nuriel-hospitality\r\n");
    expect(ics.match(/SUMMARY:Not available/g)).toHaveLength(2);
    expect(ics).toContain("DTSTAMP:20261101T100000Z");
    // round trip
    expect(parseIcs(ics).map((e) => [e.from, e.to])).toEqual([
      ["2026-11-01", "2026-11-03"],
      ["2026-11-06", "2026-11-08"],
    ]);
    // every physical line ≤ 75 bytes
    for (const line of ics.split("\r\n"))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  it("long names are folded and escaped", () => {
    const ics = buildIcs({ calendarName: "שם ארוך מאוד, עם פסיקים; ".repeat(5), events: [] });
    // פסיקים ונקודה-פסיק בשם מוברחים (\, \;) — שורות מקופלות, לכן בודקים אחרי "פריסה"
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain("מאוד\\, עם פסיקים\\;");
    expect(ics).toContain("\r\n ");
  });
});

describe("edge gate: the export feed", () => {
  const HOSP: SiteRef = {
    id: "22222222-2222-2222-2222-222222222222",
    siteType: "hospitality",
    status: "active",
  };
  const token = "a".repeat(40);
  it("serves /ical/<token> only through the feed function; anything else is a plain 404", async () => {
    const icalFeed = vi.fn(async (t: string) =>
      t === token
        ? new Response("BEGIN:VCALENDAR", { headers: { "content-type": "text/calendar" } })
        : null,
    );
    const ok = await hospitalityGate(
      HOSP,
      { pathname: `/ical/${token}`, method: "GET" },
      {
        managementOpen: async () => false,
        icalFeed,
      },
    );
    expect(ok?.headers.get("content-type")).toBe("text/calendar");
    const wrong = await hospitalityGate(
      HOSP,
      { pathname: `/ical/${"b".repeat(40)}`, method: "GET" },
      {
        managementOpen: async () => false,
        icalFeed,
      },
    );
    expect(wrong?.status).toBe(404);
    const post = await hospitalityGate(
      HOSP,
      { pathname: `/ical/${token}`, method: "POST" },
      {
        managementOpen: async () => false,
        icalFeed,
      },
    );
    expect(post?.status).toBe(404);
    // a malformed token never reaches the feed function
    const bad = await hospitalityGate(
      HOSP,
      { pathname: "/ical/../../etc", method: "GET" },
      {
        managementOpen: async () => false,
        icalFeed,
      },
    );
    expect(bad?.status).toBe(404);
    expect(icalFeed).toHaveBeenCalledTimes(2);
  });
});
