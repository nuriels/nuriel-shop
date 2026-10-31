// בדיקת הקלט של פונקציות השרת של Hospitality (Stage 1f)
import { describe, expect, it } from "vitest";
import {
  InputError,
  isoDate,
  normalizePhone,
  parseBookingAction,
  parseCancellationDecision,
  parseGuestBookingRef,
  parseManualBooking,
  parseModifyBooking,
  parseQuote,
  parseRequestBooking,
  parseStayStatus,
  stay,
} from "@/engines/hospitality/validation/input";

const UNIT = "71d30000-0000-0000-0000-0000000000a1";
const HASH = "a".repeat(64);
const request = (over: Record<string, unknown> = {}) => ({
  unitId: UNIT,
  checkIn: "2027-01-10",
  checkOut: "2027-01-12",
  fullName: "דנה כהן",
  email: " Dana@Example.com ",
  phone: "+972-52-111-1111",
  idempotencyKey: "key-0001-abcd",
  policyAccepted: true,
  policyHash: HASH,
  ...over,
});

describe("Hospitality input validation", () => {
  it("dates: real calendar dates only", () => {
    expect(isoDate("2028-02-29")).toBe("2028-02-29");
    expect(() => isoDate("2027-02-29")).toThrow(InputError);
    expect(() => isoDate("10/01/2027")).toThrow(InputError);
  });

  it("stay: at least one night, at most 60", () => {
    expect(stay("2027-01-10", "2027-01-11")).toEqual({
      checkIn: "2027-01-10",
      checkOut: "2027-01-11",
    });
    expect(() => stay("2027-01-10", "2027-01-10")).toThrow("תאריכי השהייה לא תקינים");
    expect(() => stay("2027-01-10", "2027-03-12")).toThrow("עד 60 לילות");
  });

  it("phone: normalised like the database (972… → 0…)", () => {
    expect(normalizePhone("+972-52-111-1111")).toBe("0521111111");
    expect(normalizePhone("052 111 1111")).toBe("0521111111");
    expect(normalizePhone("12")).toBeNull();
  });

  it("quote: defaults (2 adults, 0 children), bounds and unit id", () => {
    expect(
      parseQuote({ unitId: UNIT.toUpperCase(), checkIn: "2027-01-10", checkOut: "2027-01-12" }),
    ).toMatchObject({
      unitId: UNIT,
      adults: 2,
      children: 0,
      promoCode: null,
    });
    expect(() =>
      parseQuote({ unitId: "x", checkIn: "2027-01-10", checkOut: "2027-01-12" }),
    ).toThrow("היחידה");
    expect(() =>
      parseQuote({ unitId: UNIT, checkIn: "2027-01-10", checkOut: "2027-01-12", adults: 0 }),
    ).toThrow();
    expect(() =>
      parseQuote({ unitId: UNIT, checkIn: "2027-01-10", checkOut: "2027-01-12", children: 1.5 }),
    ).toThrow();
  });

  it("request: email lower-cased, policy acceptance and hash required, idempotency key required", () => {
    expect(parseRequestBooking(request())).toMatchObject({
      email: "dana@example.com",
      language: "he",
      marketingConsent: false,
    });
    expect(() => parseRequestBooking(request({ policyAccepted: false }))).toThrow("תנאי הביטול");
    expect(() => parseRequestBooking(request({ policyAccepted: "true" }))).toThrow("תנאי הביטול");
    expect(() => parseRequestBooking(request({ policyHash: "abc" }))).toThrow("תנאי הביטול");
    expect(() => parseRequestBooking(request({ idempotencyKey: "short" }))).toThrow("מזהה בקשה");
    expect(() => parseRequestBooking(request({ email: "nope" }))).toThrow("האימייל");
    expect(() => parseRequestBooking(request({ phone: "12" }))).toThrow("הטלפון");
    expect(() => parseRequestBooking(request({ fullName: "א" }))).toThrow("השם");
  });

  it("guest booking reference: a well-formed token, or a booking id", () => {
    expect(parseGuestBookingRef({ token: "F".repeat(64) })).toEqual({
      token: "f".repeat(64),
      bookingId: null,
    });
    expect(parseGuestBookingRef({ bookingId: UNIT })).toEqual({ token: null, bookingId: UNIT });
    expect(() => parseGuestBookingRef({ token: "x' OR 1=1 --" })).toThrow("ההזמנה לא נמצאה");
    expect(() => parseGuestBookingRef({})).toThrow();
  });

  it("owner actions: revision optional for simple actions, required for modify", () => {
    expect(parseBookingAction({ bookingId: UNIT })).toEqual({
      bookingId: UNIT,
      expectedRevision: null,
      reason: null,
    });
    expect(parseBookingAction({ bookingId: UNIT, expectedRevision: 3 }).expectedRevision).toBe(3);
    expect(() =>
      parseModifyBooking({ bookingId: UNIT, checkIn: "2027-01-10", checkOut: "2027-01-12" }),
    ).toThrow("גרסת ההזמנה");
  });

  it("manual booking: defaults (confirmed, phone), terms flag only when exactly true, price ≥ 0 in agorot", () => {
    const base = {
      unitId: UNIT,
      checkIn: "2027-01-10",
      checkOut: "2027-01-11",
      fullName: "משה",
      phone: "0571111111",
    };
    expect(parseManualBooking(base)).toMatchObject({
      status: "confirmed",
      source: "phone",
      termsExplained: false,
      email: null,
    });
    expect(
      parseManualBooking({ ...base, termsExplained: true, totalOverride: 1000.5 }),
    ).toMatchObject({
      termsExplained: true,
      totalOverride: 1000.5,
    });
    expect(() => parseManualBooking({ ...base, totalOverride: -1 })).toThrow("המחיר");
    expect(() => parseManualBooking({ ...base, totalOverride: 10.001 })).toThrow("המחיר");
    expect(() => parseManualBooking({ ...base, status: "cancelled" })).toThrow("הסטטוס");
  });

  it("cancellation decision and stay status", () => {
    expect(
      parseCancellationDecision({ bookingId: UNIT, feeOverride: 0, overrideReason: "לקוח חוזר" }),
    ).toMatchObject({
      feeOverride: 0,
      overrideReason: "לקוח חוזר",
    });
    expect(parseStayStatus({ bookingId: UNIT, status: "no_show" }).status).toBe("no_show");
    expect(() => parseStayStatus({ bookingId: UNIT, status: "confirmed" })).toThrow();
  });
});
