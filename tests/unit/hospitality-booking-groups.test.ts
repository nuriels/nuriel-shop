// מיגרציה 44 — כמה חדרים בבקשה אחת: בדיקת הקלט בשרת, והמיילים (אחד לאורח עם קישור לכל חדר, אחד לעסק)
import { describe, expect, it } from "vitest";
import { EMAIL_EVENT } from "@/engines/hospitality/management/bookings/model";
import { groupRooms, renderBookingEmail } from "@/engines/hospitality/outbox/templates";
import { parseRequestGroup } from "@/engines/hospitality/validation/input";

const A = "6a1e0000-0000-4000-8000-0000000000a1";
const B = "6a1e0000-0000-4000-8000-0000000000b1";
const HASH = "a".repeat(64);
const T1 = "1".repeat(64);
const T2 = "2".repeat(64);
const base = {
  checkIn: "2026-12-10",
  checkOut: "2026-12-12",
  fullName: "דנה לוי",
  email: "dana@example.com",
  phone: "054-1234567",
  idempotencyKey: "abcdefgh12345678",
  policyAccepted: true,
};
const room = (unitId: string, adults = 2, children = 0) => ({
  unitId,
  adults,
  children,
  policyHash: HASH,
});

describe("a request for several rooms: input checks", () => {
  it("two rooms: the guests and the accepted terms of each", () => {
    const r = parseRequestGroup({ ...base, rooms: [room(A, 2, 1), room(B, 3)] });
    expect(r.rooms).toEqual([
      { unitId: A, adults: 2, children: 1, policyHash: HASH },
      { unitId: B, adults: 3, children: 0, policyHash: HASH },
    ]);
    expect(r.checkIn).toBe("2026-12-10");
    expect(r.email).toBe("dana@example.com");
  });
  it("refused: one room, more than 8, the same room twice, terms not accepted, a bad key", () => {
    expect(() => parseRequestGroup({ ...base, rooms: [room(A)] })).toThrow(/בין 2 ל-8/);
    expect(() =>
      parseRequestGroup({ ...base, rooms: Array.from({ length: 9 }, () => room(A)) }),
    ).toThrow(/בין 2 ל-8/);
    expect(() => parseRequestGroup({ ...base, rooms: [room(A), room(A)] })).toThrow(/פעם אחת/);
    expect(() =>
      parseRequestGroup({ ...base, rooms: [room(A), { ...room(B), policyHash: "x" }] }),
    ).toThrow(/תנאי הביטול/);
    expect(() =>
      parseRequestGroup({ ...base, policyAccepted: false, rooms: [room(A), room(B)] }),
    ).toThrow(/תנאי הביטול/);
    expect(() =>
      parseRequestGroup({ ...base, idempotencyKey: "short", rooms: [room(A), room(B)] }),
    ).toThrow(/מזהה בקשה/);
  });
});

describe("the emails of a request for several rooms", () => {
  const ctx = {
    business: {
      name: "נופי דורית",
      phone: "050-0000000",
      email: null,
      address: null,
      checkInTime: null,
      checkOutTime: null,
    },
    bookingUrl: "https://nofi.example/manage/bookings/x",
    siteOrigin: "https://nofi.example",
    escape: (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
  };
  const payload = {
    booking_number: 12,
    unit_name: "יחידת אדיר",
    check_in: "2026-12-10",
    check_out: "2026-12-12",
    nights: 2,
    adults: 2,
    guest_name: "דנה לוי",
    total: 2800,
    currency: "ILS",
    hold_expires_at: "2026-12-01T10:00:00Z",
    room_count: 2,
    rooms: [
      {
        number: 12,
        unit_name: "יחידת אדיר",
        adults: 2,
        children: 1,
        total: 1500,
        manage_token: T1,
      },
      {
        number: 13,
        unit_name: "יחידת מוריה",
        adults: 2,
        children: 0,
        total: 1300,
        manage_token: T2,
      },
    ],
  };

  it("to the guest: one email, every room, a personal link for each room — not one room's number", () => {
    const e = renderBookingEmail("group_request_received", "guest", payload, {
      ...ctx,
      bookingUrl: null,
    })!;
    expect(e.subject).toBe("קיבלנו את בקשת ההזמנה שלך — נופי דורית · 2 חדרים");
    expect(e.html).toContain("#12 · יחידת אדיר");
    expect(e.html).toContain("#13 · יחידת מוריה");
    expect(e.html).toContain(`https://nofi.example/stay/my-booking#t=${T1}`);
    expect(e.html).toContain(`https://nofi.example/stay/my-booking#t=${T2}`);
    expect(e.html).toContain("לניהול ההזמנה — יחידת מוריה");
    expect(e.html).toContain("הקישורים אישיים");
    expect(e.html).toContain("2,800");
  });
  it("to the business: one email with the rooms, the button to the booking — no personal links", () => {
    const { rooms, ...rest } = payload;
    const e = renderBookingEmail(
      "new_group_request",
      "owner",
      { ...rest, rooms: rooms.map(({ manage_token: _t, ...r }) => r) },
      ctx,
    )!;
    expect(e.subject).toBe("בקשת הזמנה חדשה — ממתינה לאישור · 2 חדרים");
    expect(e.html).toContain("#13 · יחידת מוריה");
    expect(e.html).toContain('href="https://nofi.example/manage/bookings/x"');
    expect(e.html).not.toContain("/stay/my-booking");
  });
  it("approved / declined — the same, with the reason when declined; labels in the emails screen", () => {
    expect(
      renderBookingEmail("group_booking_confirmed", "guest", payload, { ...ctx, bookingUrl: null })!
        .subject,
    ).toBe("ההזמנה שלך אושרה — נופי דורית · 2 חדרים");
    const d = renderBookingEmail(
      "group_booking_declined",
      "guest",
      { ...payload, reason: "אין מקום" },
      { ...ctx, bookingUrl: null },
    )!;
    expect(d.html).toContain("אין מקום");
    for (const ev of [
      "group_request_received",
      "group_booking_confirmed",
      "group_booking_declined",
      "new_group_request",
      "new_group_booking",
    ])
      expect(EMAIL_EVENT[ev], ev).toBeTruthy();
  });
  it("only valid rooms and links are used", () => {
    const rooms = groupRooms({
      rooms: [{ unit_name: "א", number: 1, manage_token: "nope" }, { number: 2 }],
    } as never);
    expect(rooms).toHaveLength(1);
    expect(rooms[0]!.manage_token).toBeNull();
  });
});
