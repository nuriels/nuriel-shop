// הזמנות לצוות (Stage 2h): רשימה, כרטיס, אישור / דחייה, הגעה / עזיבה / לא הגיעו.
// הכללים (מי, מתי, revision, נעילה, יומן אירועים, מיילים בתור) — במסד (Stage 1f + מיגרציה 16).
import { createServerFn } from "@tanstack/react-start";
import type { BookingChange, BookingDetail, BookingList } from "../types/bookings";
import {
  parseBookingId,
  parseBookingsQuery,
  parseCancel,
  parseCreateBooking,
  parseDecision,
  parseModify,
  parseStay,
} from "../validation/bookings";

type Changed = { booking_id: string; status: string; revision?: number };

export const hospitalityBookings = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseBookingsQuery(input))
  .handler(async ({ data }): Promise<BookingList> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<BookingList>("staff_bookings", {
      _tab: data.tab,
      _q: data.q,
      _limit: data.limit,
      _offset: data.offset,
    });
  });

export const hospitalityBookingDetail = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseBookingId(input))
  .handler(async ({ data }): Promise<BookingDetail> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<BookingDetail>("staff_booking_detail", { _id: data.id });
  });

export const hospitalityApproveBooking = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseDecision(input))
  .handler(async ({ data }): Promise<Changed> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<Changed>("approve_booking", {
      _booking_id: data.id,
      _expected_revision: data.revision,
    });
  });

export const hospitalityDeclineBooking = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseDecision(input))
  .handler(async ({ data }): Promise<Changed> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<Changed>("decline_booking", {
      _booking_id: data.id,
      _reason: data.reason,
      _expected_revision: data.revision,
    });
  });

export const hospitalitySetStayStatus = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseStay(input))
  .handler(async ({ data }): Promise<Changed> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<Changed>("set_stay_status", {
      _booking_id: data.id,
      _status: data.status,
      _expected_revision: data.revision,
    });
  });

// ---------- 2i: הזמנה ידנית, שינוי, ביטול, בקשות ביטול ----------
// (Stage 1f: create_manual_booking, modify_booking, cancel_booking, cancellation_quote,
// approve_cancellation, decline_cancellation — כולל מחיר מחושב בשרת, מניעת הזמנה כפולה,
// מדיניות שנשמרת עם ההזמנה ומיילים בתור)

export interface CancellationQuote {
  fee: number;
  refund_due: number;
  charge_due: number;
  result: "cancelled" | "cancel_requested";
  kind?: string;
  currency?: string;
  total?: number;
  amount_paid?: number;
}

export const hospitalityCreateBooking = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseCreateBooking(input))
  .handler(async ({ data }): Promise<{ booking_id: string; number: number; status: string }> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc("create_manual_booking", {
      _unit_id: data.unitId,
      _check_in: data.checkIn,
      _check_out: data.checkOut,
      _full_name: data.fullName,
      _phone: data.phone,
      _terms_explained: data.termsExplained,
      _email: data.email,
      _adults: data.adults,
      _children: data.children,
      _total_override: data.totalOverride,
      _policy_id: data.policyId,
      _status: data.status,
      _source: data.source,
      _channel: data.channel,
      _notes: data.notes,
      _send_guest_email: data.sendGuestEmail,
    });
  });

export const hospitalityModifyBooking = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseModify(input))
  .handler(async ({ data }): Promise<BookingChange> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc("modify_booking", {
      _booking_id: data.id,
      _expected_revision: data.revision,
      _check_in: data.checkIn,
      _check_out: data.checkOut,
      _unit_id: data.unitId,
      _adults: data.adults,
      _children: data.children,
      _total_override: data.totalOverride,
      _note: data.note,
    });
  });

export const hospitalityCancellationQuote = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseBookingId(input))
  .handler(async ({ data }): Promise<CancellationQuote> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<CancellationQuote>("cancellation_quote", {
      _token: null,
      _booking_id: data.id,
    });
  });

export const hospitalityCancelBooking = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseCancel(input))
  .handler(async ({ data }): Promise<BookingChange> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc("cancel_booking", {
      _booking_id: data.id,
      _reason: data.reason,
      _fee_override: data.feeOverride,
      _override_reason: data.overrideReason,
      _expected_revision: data.revision,
    });
  });

export const hospitalityApproveCancellation = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseCancel(input))
  .handler(async ({ data }): Promise<BookingChange> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc("approve_cancellation", {
      _booking_id: data.id,
      _fee_override: data.feeOverride,
      _override_reason: data.overrideReason,
      _expected_revision: data.revision,
    });
  });

export const hospitalityDeclineCancellation = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseDecision(input))
  .handler(async ({ data }): Promise<BookingChange> => {
    const { manageRpc } = await import("../server/manage.server");
    if (!data.reason) throw new Error("יש לכתוב לאורח למה הבקשה לא אושרה");
    return manageRpc("decline_cancellation", {
      _booking_id: data.id,
      _reason: data.reason,
      _expected_revision: data.revision,
    });
  });
