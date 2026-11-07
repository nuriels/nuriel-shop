// שלב א' 2 — "ההזמנות שלי": הקלט של פונקציות השרת, המייל עם הקוד (בשם העסק, escape, בלי קישורים),
// ושורת מצב התשלום ברשימה ובפרטי ההזמנה.
import { describe, expect, it } from "vitest";
import { guestCodeEmail } from "@/engines/hospitality/outbox/guest-code";
import { LIMITS } from "@/engines/hospitality/security/limits";
import type { GuestAreaBooking } from "@/engines/hospitality/types/guest-area";
import type { GuestTransferState } from "@/engines/hospitality/types/payment-instructions";
import { InputError } from "@/engines/hospitality/validation/input";
import {
  guestAreaEmail,
  maskGuestEmail,
  parseGuestAreaBooking,
  parseGuestAreaCode,
  parseGuestAreaMethod,
  parseGuestAreaUpload,
} from "@/engines/hospitality/validation/guest-area";
import { he } from "@/engines/hospitality/website/copy/he";
import { areaPaymentText, paymentRowText } from "@/engines/hospitality/website/lib/transfer";

const ID = "0f0e0d0c-0b0a-4908-8706-050403020100";
const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

describe("guest area: input", () => {
  it("the address is trimmed and lower-cased; a malformed one is refused", () => {
    expect(guestAreaEmail("  Dana@Example.COM ")).toBe("dana@example.com");
    expect(() => guestAreaEmail("dana")).toThrow(InputError);
    expect(() => guestAreaEmail(`${"a".repeat(250)}@b.co`)).toThrow(InputError);
    expect(() => guestAreaEmail('a"<b>@x.com')).toThrow(InputError);
  });

  it("the code is 6 digits (spaces and dashes from copy-paste are dropped)", () => {
    expect(parseGuestAreaCode({ email: "a@b.co", code: "123 456" }).code).toBe("123456");
    expect(parseGuestAreaCode({ email: "a@b.co", code: "12-34-56" }).code).toBe("123456");
    expect(() => parseGuestAreaCode({ email: "a@b.co", code: "12345" })).toThrow(/6 ספרות/);
    expect(() => parseGuestAreaCode({ email: "x", code: "123456" })).toThrow(InputError);
  });

  it("a booking id, a payment method, an upload form", () => {
    expect(parseGuestAreaBooking({ bookingId: ID }).bookingId).toBe(ID);
    expect(() => parseGuestAreaBooking({ bookingId: "1" })).toThrow();
    expect(parseGuestAreaMethod({ bookingId: ID, method: "bank" }).method).toBe("bank");
    expect(() => parseGuestAreaMethod({ bookingId: ID, method: "cash" })).toThrow(InputError);
    const form = new FormData();
    form.set("bookingId", ID);
    form.set("file", new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" }));
    expect(parseGuestAreaUpload(form).bookingId).toBe(ID);
    const empty = new FormData();
    empty.set("bookingId", ID);
    expect(() => parseGuestAreaUpload(empty)).toThrow(/בחרו קובץ/);
    expect(() => parseGuestAreaUpload({ bookingId: ID })).toThrow(InputError);
  });

  it("the masked address shown after asking for a code", () => {
    expect(maskGuestEmail("dana@example.com")).toBe("da**@example.com");
    expect(maskGuestEmail("a@b.co")).toBe("a***@b.co");
  });

  it("asking for codes has its own limits (per address in the database, per IP and business here)", () => {
    expect(LIMITS.guestCode.map((r) => r.per)).toEqual(["ip", "ip", "tenant"]);
    expect(LIMITS.guestVerify[0]!.per).toBe("ip");
  });
});

describe("guest area: the code email", () => {
  it("in the business's name, the code once in the subject and once in the body, no links", () => {
    const { subject, html } = guestCodeEmail("042917", "נופי דורית", escape);
    expect(subject).toContain("042917");
    expect(html).toContain("נופי דורית");
    expect(html).toContain(">042917<");
    expect(html).not.toMatch(/<a\s/i);
    expect(html).toContain("10 דקות");
  });

  it("the business name is escaped", () => {
    const { html } = guestCodeEmail("111111", '<img src=x onerror="1">', escape);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("guest area: the payment line", () => {
  const transfer = (over: Partial<GuestTransferState> = {}): GuestTransferState => ({
    allowed: true,
    min_days: 7,
    chosen: false,
    proofs: [],
    waiting_review: false,
    can_upload: true,
    ...over,
  });
  const booking = (over: Partial<GuestAreaBooking>): GuestAreaBooking =>
    ({
      id: ID,
      number: 1001,
      status: "confirmed",
      payment_status: "unpaid",
      payment_method: null,
      total: 1600,
      amount_paid: 0,
      transfer: transfer(),
      ...over,
    }) as GuestAreaBooking;

  it("the list: transfer received / waiting for the transfer / the status from the ledger", () => {
    expect(areaPaymentText(booking({ transfer: transfer({ waiting_review: true }) }), he)).toBe(
      he.my.transfer.received,
    );
    expect(areaPaymentText(booking({ transfer: transfer({ chosen: true }) }), he)).toBe(
      he.my.transfer.waiting,
    );
    expect(areaPaymentText(booking({}), he)).toBe("טרם שולם");
    expect(areaPaymentText(booking({ payment_status: "deposit_paid" }), he)).toBe("שולמה מקדמה");
    expect(
      areaPaymentText(
        booking({ payment_status: "paid", transfer: transfer({ chosen: true }) }),
        he,
      ),
    ).toBe("שולם");
    expect(
      areaPaymentText(booking({ status: "cancelled", transfer: transfer({ chosen: true }) }), he),
    ).toBe("טרם שולם");
  });

  it("the booking page: transfer first, then the business's instructions, then phone payment", () => {
    const b = { total: 1600, amount_paid: 0 };
    expect(
      paymentRowText(
        b,
        { available: true, methods: ["bank", "phone"], transfer: transfer({ chosen: true }) },
        he,
      ),
    ).toBe(he.my.transfer.waiting);
    expect(
      paymentRowText(b, { available: true, methods: ["bank", "phone"], transfer: transfer() }, he),
    ).toBe(he.my.unpaidInstructions);
    expect(
      paymentRowText(
        b,
        { available: false, reason: "not_confirmed", methods: ["bank"], transfer: transfer() },
        he,
      ),
    ).toBe(he.my.unpaidLater);
    expect(paymentRowText(b, { available: true, methods: ["phone"] }, he)).toBe(
      he.my.paymentStates.unpaid,
    );
    expect(paymentRowText({ total: 1600, amount_paid: 1600 }, null, he)).toBe("שולם");
  });
});
