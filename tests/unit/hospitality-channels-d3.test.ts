// D3 — סנכרון ערוצים: מקור התפוסה בלוח (האתר / טלפון / ערוץ / חסימה ידנית / סנכרון), תאריכים
// מיומן חיצוני מזוהים בגוון ובשם משלהם, התראות בלוח הבקרה, ומייל ההתנגשות לבעל העסק.
import { describe, expect, it } from "vitest";
import {
  CHANNEL_LABELS,
  TONE_LABELS,
  blockSource,
  bookingSource,
  buildRows,
  type Filters,
} from "@/engines/hospitality/management/calendar/model";
import { channelAlerts } from "@/engines/hospitality/management/dashboard/channel-alerts";
import { EMAIL_EVENT } from "@/engines/hospitality/management/bookings/model";
import { renderBookingEmail } from "@/engines/hospitality/outbox/templates";
import type {
  CalendarBlock,
  CalendarBooking,
  CalendarView,
} from "@/engines/hospitality/types/calendar";
import type { ChannelUnit } from "@/engines/hospitality/types/channels";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U1 = id(11);

const booking = (over: Partial<CalendarBooking> = {}): CalendarBooking => ({
  id: id(101),
  number: 7,
  unit_id: U1,
  check_in: "2026-12-10",
  check_out: "2026-12-12",
  status: "confirmed",
  adults: 2,
  children: 0,
  total: 1000,
  source: "site",
  channel: null,
  guest_name: "דנה כהן",
  ...over,
});

const block = (over: Partial<CalendarBlock> = {}): CalendarBlock => ({
  id: id(201),
  unit_id: U1,
  unit_name: "צימר אלון",
  start_date: "2026-12-20",
  end_date: "2026-12-22",
  reason: null,
  ...over,
});

const view = (bookings: CalendarBooking[], blocks: CalendarBlock[]): CalendarView =>
  ({
    from: "2026-12-01",
    to: "2027-01-01",
    today: "2026-12-03",
    weekend_nights: [4, 5],
    currency: "ILS",
    stamp: "x",
    properties: [{ id: id(1), name: "מתחם" }],
    units: [
      {
        id: U1,
        name: "צימר אלון",
        property_id: id(1),
        kind: "unit",
        unit_type: "zimmer",
        is_active: true,
        member_ids: null,
      },
    ],
    bookings,
    blocks,
  }) as CalendarView;

const all: Filters = { propertyId: "", unitId: "", unitType: "", tone: "" };
const barsOf = (v: CalendarView, f: Filters = all) =>
  buildRows(v, f).flatMap((r) => (r.type === "unit" ? r.bars : []));

describe("where each occupancy comes from", () => {
  it("bookings: the site, phone, walk-in, management, or the channel named on it", () => {
    expect(bookingSource({ source: "site", channel: null }).label).toBe("האתר");
    expect(bookingSource({ source: "phone", channel: null }).label).toBe("טלפון");
    expect(bookingSource({ source: "walk_in", channel: null }).label).toBe("הגיעו למקום");
    expect(bookingSource({ source: "owner", channel: null }).label).toBe("הוזן בניהול");
    expect(bookingSource({ source: "external", channel: "Booking.com" }).label).toBe("Booking.com");
    expect(bookingSource({ source: "external", channel: "airbnb" }).label).toBe("Airbnb");
    expect(bookingSource({ source: "external", channel: null }).label).toBe("ערוץ חיצוני");
  });

  it("blocks: synced from a channel (its name) or a manual block", () => {
    expect(blockSource({ synced: true, channel: "airbnb" })).toEqual({
      kind: "synced",
      label: "Airbnb",
    });
    expect(blockSource({ synced: true, channel: "booking" }).label).toBe("Booking.com");
    expect(blockSource({ synced: true, channel: null }).label).toBe(CHANNEL_LABELS["other"]);
    expect(blockSource({ synced: false, channel: null })).toEqual({
      kind: "block",
      label: "חסימה ידנית",
    });
    // an older server without the field: a manual block
    expect(blockSource({}).kind).toBe("block");
  });
});

describe("the board: external dates are easy to tell apart", () => {
  const v = view(
    [
      booking(),
      booking({
        id: id(102),
        number: 8,
        check_in: "2026-12-14",
        check_out: "2026-12-16",
        source: "external",
        channel: "Booking.com",
      }),
    ],
    [
      block({ synced: true, channel: "airbnb" }),
      block({ id: id(202), start_date: "2026-12-26", end_date: "2026-12-28", reason: "שיפוץ" }),
    ],
  );

  it("a synced block has its own tone and says the channel; a manual block stays 'blocked'", () => {
    const bars = barsOf(v).filter((b) => b.kind === "block");
    const synced = bars.find((b) => b.block?.id === id(201))!;
    const manual = bars.find((b) => b.block?.id === id(202))!;
    expect(synced.tone).toBe("external");
    expect(synced.label).toBe("Airbnb · סנכרון");
    expect(manual.tone).toBe("block");
    expect(manual.label).toBe("חסום — שיפוץ");
    expect(TONE_LABELS.external).toBe("מיומן חיצוני");
  });

  it("a booking from a channel shows the channel first", () => {
    const bars = barsOf(v).filter((b) => b.kind === "booking");
    expect(bars.find((b) => b.booking?.number === 8)!.label).toBe("Booking.com · #8 דנה כהן");
    expect(bars.find((b) => b.booking?.number === 7)!.label).toBe("#7 דנה כהן");
  });

  it("the filter 'from external calendars' shows only the synced dates", () => {
    const bars = barsOf(v, { ...all, tone: "external" });
    expect(bars.map((b) => b.block?.id)).toEqual([id(201)]);
    const blocked = barsOf(v, { ...all, tone: "block" });
    expect(blocked.map((b) => b.block?.id)).toEqual([id(202)]);
  });
});

describe("dashboard alerts", () => {
  const unit = (calendars: ChannelUnit["calendars"]): ChannelUnit => ({
    unit_id: U1,
    name: "צימר אלון",
    kind: "unit",
    is_active: true,
    feed_token: null,
    feed_created_at: null,
    calendars,
  });
  const cal = (over: Partial<ChannelUnit["calendars"][number]> = {}) => ({
    id: id(301),
    channel: "airbnb" as const,
    url: "https://x",
    enabled: true,
    last_sync_at: null,
    last_status: "ok" as const,
    last_error: null,
    events: 1,
    conflicts: [],
    next_sync_at: "2026-12-01T00:00:00Z",
    ...over,
  });

  it("nothing to report → nothing shown", () => {
    expect(channelAlerts([unit([cal()])])).toEqual({ conflicts: [], failing: [] });
  });

  it("conflicts (sorted by date) and calendars that fail to sync; removed calendars are ignored", () => {
    const a = channelAlerts([
      unit([
        cal({
          conflicts: [
            { uid: "b", from: "2026-12-20", to: "2026-12-22" },
            { uid: "a", from: "2026-12-10", to: "2026-12-12" },
          ],
        }),
        cal({ id: id(302), channel: "booking", last_status: "error", last_error: "404" }),
        cal({
          id: id(303),
          enabled: false,
          conflicts: [{ uid: "z", from: "2026-12-01", to: "2026-12-02" }],
        }),
      ]),
    ]);
    expect(a.conflicts.map((c) => c.uid)).toEqual(["a", "b"]);
    expect(a.failing).toEqual([{ unit: "צימר אלון", channel: "booking" }]);
  });
});

describe("the conflict email to the owner", () => {
  const ctx = {
    business: {
      name: "צימרי הגליל",
      phone: null,
      email: null,
      address: null,
      checkInTime: null,
      checkOutTime: null,
    },
    bookingUrl: "https://galil.example/manage/channels",
    escape: (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  };
  const payload = {
    unit_name: "צימר אלון",
    channel_label: "Airbnb",
    conflict_count: 12,
    echo_like: false,
    conflicts: [{ from: "2026-12-10", to: "2026-12-12" }],
  };

  it("says what happened, that no booking changed, the dates, and links to the channels screen", () => {
    const e = renderBookingEmail("channel_conflict", "owner", payload, ctx)!;
    expect(e.subject).toBe("התנגשות ביומן Airbnb — צימר אלון");
    expect(e.html).toContain("לא שינינו ולא ביטלנו שום הזמנה");
    expect(e.html).toContain("10.12.2026");
    expect(e.html).toContain("11 התנגשויות נוספות");
    expect(e.html).toContain('href="https://galil.example/manage/channels"');
    expect(e.html).toContain("לבדיקת היומנים");
    expect(EMAIL_EVENT["channel_conflict"]).toBe("לעסק: התנגשות ביומן חיצוני");
  });

  it("when the dates are exactly ours, it says it may be our own dates coming back", () => {
    const e = renderBookingEmail(
      "channel_conflict",
      "owner",
      { ...payload, echo_like: true },
      ctx,
    )!;
    expect(e.html).toContain("מחזיר את התאריכים שהיומן שלנו שלח אליו");
  });

  it("the channel name is escaped (it is data)", () => {
    const e = renderBookingEmail(
      "channel_conflict",
      "owner",
      { ...payload, unit_name: "<b>x</b>" },
      ctx,
    )!;
    expect(e.html).not.toContain("<b>x</b>");
  });
});
