// פונקציות שרת לאורחים (בלי חשבון) — האתר לפי x-tenant-id (request_tenant במסד).
// אורח מחובר נשלח עם הטוקן שלו; שיוך הזמנה לחשבון — claim_guest_bookings (אימייל מאומת).
// בלי ממשק (ה-API של Stage 1; האתר משתמש ב-api/website.functions.ts) — אבל נגישות בכתובת שלהן,
// ולכן עם אותן הגנות (D1): הגבלת קצב משותפת, ובקשת הזמנה רק עם אתגר CAPTCHA ודרך השרת.
import { createServerFn } from "@tanstack/react-start";
import {
  parseGuestBookingRef,
  parseQuote,
  parseRequestBooking,
  parseRequestCancellation,
} from "../validation/input";
import type { LimitAction } from "../security/limits";
import { TRAP_FIELD } from "../security/messages";
import { parsePowSolution } from "../security/pow";
import type {
  BookingRequestResult,
  CancellationQuote,
  GuestBookingView,
  Quote,
} from "../types/domain";

async function throttle(action: LimitAction): Promise<void> {
  const [{ guardPublic }, { hospitalitySiteId }] = await Promise.all([
    import("../security/guard.server"),
    import("./rpc.server"),
  ]);
  await guardPublic(action, await hospitalitySiteId());
}

async function optionalToken(): Promise<string | null> {
  const { sessionFromRequest } = await import("@/platform/auth/session.server");
  return (await sessionFromRequest())?.accessToken ?? null;
}

export const hospitalityQuote = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseQuote(input))
  .handler(async ({ data }) => {
    await throttle("quote");
    const { callRpc } = await import("./rpc.server");
    return callRpc<Quote>(
      "quote",
      {
        _unit_id: data.unitId,
        _check_in: data.checkIn,
        _check_out: data.checkOut,
        _adults: data.adults,
        _children: data.children,
        _promo_code: data.promoCode,
      },
      { accessToken: await optionalToken() },
    );
  });

export const hospitalityRequestBooking = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => {
    const trap = input?.[TRAP_FIELD];
    return {
      ...parseRequestBooking(input),
      captcha: parsePowSolution(input?.["captcha"]),
      trap: typeof trap === "string" ? trap.slice(0, 200) : "",
    };
  })
  .handler(async ({ data }) => {
    const [{ guardBookingRequest }, { callServerRpc, hospitalitySiteId }] = await Promise.all([
      import("../security/guard.server"),
      import("./rpc.server"),
    ]);
    const client = await guardBookingRequest(await hospitalitySiteId(), data);
    return callServerRpc<BookingRequestResult>(
      "request_booking",
      {
        _unit_id: data.unitId,
        _check_in: data.checkIn,
        _check_out: data.checkOut,
        _full_name: data.fullName,
        _email: data.email,
        _phone: data.phone,
        _idempotency_key: data.idempotencyKey,
        _policy_accepted: true,
        _policy_hash: data.policyHash,
        _adults: data.adults,
        _children: data.children,
        _special_requests: data.specialRequests,
        _promo_code: data.promoCode,
        _marketing_consent: data.marketingConsent,
        _language: data.language,
      },
      client,
    );
  });

export const hospitalityGetBooking = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseGuestBookingRef(input))
  .handler(async ({ data }) => {
    await throttle("booking");
    const { callRpc } = await import("./rpc.server");
    if (data.token)
      return callRpc<GuestBookingView>("get_booking_by_token", { _token: data.token });
    const { requireSession } = await import("@/platform/auth/session.server");
    const session = await requireSession();
    const mine = await callRpc<GuestBookingView[]>(
      "my_bookings",
      {},
      { accessToken: session.accessToken },
    );
    const booking = mine.find((b) => b.id === data.bookingId);
    if (!booking) throw new Error("ההזמנה לא נמצאה");
    return booking;
  });

export const hospitalityCancellationQuote = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseGuestBookingRef(input))
  .handler(async ({ data }) => {
    await throttle("cancelQuote");
    const { callRpc } = await import("./rpc.server");
    return callRpc<CancellationQuote>(
      "cancellation_quote",
      { _token: data.token, _booking_id: data.bookingId },
      { accessToken: await optionalToken() },
    );
  });

export const hospitalityRequestCancellation = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseRequestCancellation(input))
  .handler(async ({ data }) => {
    await throttle("cancel");
    const { callRpc } = await import("./rpc.server");
    return callRpc<GuestBookingView>(
      "request_cancellation",
      { _token: data.token, _booking_id: data.bookingId, _reason: data.reason },
      { accessToken: await optionalToken() },
    );
  });
