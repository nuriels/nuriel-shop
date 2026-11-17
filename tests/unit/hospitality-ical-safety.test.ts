// iCal import safety (audit findings B-3/B-4): a cancelled reservation must not keep blocking the dates,
// and a feed cut off mid-download must not be treated as "the calendar" — the sync releases every block
// that is missing from the new list, so a truncated feed would free dates that are still booked.
import { describe, expect, it } from "vitest";
import { looksCompleteIcs, parseIcs } from "@/engines/hospitality/channels/ical";

const wrap = (events: string[], end = true) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, ...(end ? ["END:VCALENDAR"] : [])].join("\r\n");
const ev = (uid: string, from: string, to: string, extra: string[] = []) =>
  [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTART;VALUE=DATE:${from}`,
    `DTEND;VALUE=DATE:${to}`,
    ...extra,
    "END:VEVENT",
  ].join("\r\n");

describe("iCal — cancelled events", () => {
  it("STATUS:CANCELLED is not a block", () => {
    const text = wrap([
      ev("kept@x", "20270301", "20270304", ["STATUS:CONFIRMED"]),
      ev("gone@x", "20270310", "20270312", ["STATUS:CANCELLED"]),
      ev("gone-lower@x", "20270320", "20270322", ["status:cancelled"]),
      ev("plain@x", "20270401", "20270402"),
    ]);
    expect(parseIcs(text).map((e) => e.uid)).toEqual(["kept@x", "plain@x"]);
  });

  it("TENTATIVE stays a block (the dates are not free)", () => {
    expect(parseIcs(wrap([ev("t@x", "20270301", "20270302", ["STATUS:TENTATIVE"])]))).toHaveLength(
      1,
    );
  });
});

describe("iCal — truncated feeds", () => {
  it("a complete calendar passes; one without END:VCALENDAR is incomplete", () => {
    expect(looksCompleteIcs(wrap([ev("a@x", "20270301", "20270302")]))).toBe(true);
    expect(looksCompleteIcs(wrap([ev("a@x", "20270301", "20270302")], false))).toBe(false);
  });

  it("a feed cut in the middle of an event is incomplete", () => {
    const cut =
      wrap([ev("a@x", "20270301", "20270302")], false) +
      "\r\nBEGIN:VEVENT\r\nUID:b@x\r\nDTSTART;VALUE=DA";
    expect(looksCompleteIcs(cut)).toBe(false);
  });

  it("an HTML error page is neither", () => {
    expect(looksCompleteIcs("<!doctype html><html>BEGIN:VCALENDAR")).toBe(false);
  });
});
