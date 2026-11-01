// D4 — תשלום טלפוני (בלי סליקה באתר): ההודעה לאורח אחרי השליחה, שאין תשלום באתר, בלי פרטי
// כרטיס (טופס האורח והערת התשלום), והפרדה בין בקשה / אישור / תשלום.
import { describe, expect, it } from "vitest";
import {
  CARD_IN_GUEST_TEXT,
  PAYMENT_MODE,
  looksLikeCardNumber,
  paymentState,
  phoneFlow,
} from "@/engines/hospitality/payments/phone";
import { parseRequestBooking } from "@/engines/hospitality/validation/input";
import { he } from "@/engines/hospitality/website/copy/he";
import { renderBookingEmail } from "@/engines/hospitality/outbox/templates";

const EXACT = "בקשת ההזמנה התקבלה. נציג העסק יצור איתך קשר טלפונית להשלמת התשלום ואישור ההזמנה";

describe("the decision: phone payment only", () => {
  it("one mode, phone — no online clearing yet", () => {
    expect(PAYMENT_MODE).toBe("phone");
  });

  it("after sending a request the guest sees exactly the agreed message", () => {
    expect(he.received.phone).toBe(EXACT);
  });

  it("the guest is told clearly that paying on the site is not possible — before and after sending", () => {
    expect(he.book.payByPhone).toContain("לא ניתן לשלם באתר");
    expect(he.received.noOnline).toContain("לא ניתן לשלם באתר");
    expect(he.book.noCharge).not.toContain("החיוב");
  });

  it("the guest's payment line follows only what the business recorded", () => {
    expect(he.my.paymentStates[paymentState(1000, 0)]).toContain("טרם שולם");
    expect(he.my.paymentStates[paymentState(1000, 300)]).toBe("שולמה מקדמה");
    expect(he.my.paymentStates[paymentState(1000, 1000)]).toBe("שולם");
  });
});

describe("request / approved / paid are separate", () => {
  it("payment state from the recorded amount only", () => {
    expect(paymentState(1000, 0)).toBe("unpaid");
    expect(paymentState(1000, -5)).toBe("unpaid");
    expect(paymentState(1000, 1)).toBe("deposit_paid");
    expect(paymentState(1000, 1000)).toBe("paid");
    expect(paymentState(1000, 1200)).toBe("paid");
  });

  it("an approved booking is not 'paid' until a payment is recorded", () => {
    expect(phoneFlow({ status: "pending_approval", payment_status: "unpaid" })).toEqual({
      requested: true,
      approved: false,
      paid: false,
      active: true,
    });
    expect(phoneFlow({ status: "confirmed", payment_status: "unpaid" })).toMatchObject({
      approved: true,
      paid: false,
    });
    expect(phoneFlow({ status: "confirmed", payment_status: "paid" })).toMatchObject({
      approved: true,
      paid: true,
    });
    expect(phoneFlow({ status: "declined", payment_status: "unpaid" }).active).toBe(false);
  });
});

describe("no card data in the system", () => {
  it("detects card numbers (13–19 digits, with or without spaces / dashes)", () => {
    expect(looksLikeCardNumber("4580 1234 5678 9010")).toBe(true);
    expect(looksLikeCardNumber("4580-1234-5678-9010")).toBe(true);
    expect(looksLikeCardNumber("כרטיס 4580123456789010 תוקף 12/28")).toBe(true);
    expect(looksLikeCardNumber("3782 822463 10005")).toBe(true); // 15 digits (Amex)
    // full-width digits are normalised first
    expect(looksLikeCardNumber("４５８０１２３４５６７８９０１０")).toBe(true);
  });

  it("leaves ordinary notes alone: references, the last 4 digits, phone numbers, dates", () => {
    for (const ok of [
      "אסמכתא 778899",
      "4 ספרות אחרונות 1234",
      "054-777-8888",
      "0547778888",
      "תשלום ב-12/11/2026",
      "",
      null,
    ])
      expect(looksLikeCardNumber(ok), String(ok)).toBe(false);
  });

  it("the booking form refuses a card number in the special requests", () => {
    const base = {
      unitId: "11111111-1111-4111-8111-111111111111",
      checkIn: "2027-01-10",
      checkOut: "2027-01-12",
      adults: 2,
      children: 0,
      fullName: "רוני לוי",
      email: "roni@example.com",
      phone: "0547778888",
      idempotencyKey: "abcdefghijklmnopqrstuvwxyz012345",
      policyHash: "a".repeat(64),
      policyAccepted: true,
    };
    expect(() =>
      parseRequestBooking({ ...base, specialRequests: "חיוב בכרטיס 4580 1234 5678 9010" }),
    ).toThrow(CARD_IN_GUEST_TEXT);
    expect(parseRequestBooking({ ...base, specialRequests: "נגיע ב-15:00" }).specialRequests).toBe(
      "נגיע ב-15:00",
    );
  });
});

describe("emails say the same", () => {
  const ctx = {
    business: {
      name: "צימרי הגליל",
      phone: "050-0000101",
      email: null,
      address: null,
      checkInTime: null,
      checkOutTime: null,
    },
    bookingUrl: null,
    escape: (s: string) => s,
  };
  it("the request email: a representative will call to complete the payment; no card details by email", () => {
    const e = renderBookingEmail(
      "request_received",
      "guest",
      { booking_number: 12, guest_name: "רוני" },
      ctx,
    )!;
    expect(e.html).toContain("נציג העסק יצור איתך קשר טלפונית להשלמת התשלום ואישור ההזמנה");
    expect(e.html).toContain("לא ניתן לשלם באתר");
    expect(e.html).toContain("לא נבקש ממך פרטי כרטיס אשראי באימייל");
  });

  it("the confirmation email does not claim a payment", () => {
    const e = renderBookingEmail(
      "booking_confirmed",
      "guest",
      { booking_number: 12, guest_name: "רוני" },
      ctx,
    )!;
    expect(e.html).toContain("אם התשלום עוד לא הושלם");
    expect(e.html).not.toContain("שולם");
  });
});
