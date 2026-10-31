// פונקציות שרת לבעלים / מנהל של אתר אירוח. ההרשאה נבדקת במסד בכל פונקציה
// (hospitality.can() + הדגל); כאן רק בדיקת הקלט והזהות. בלי ממשק בשלב הזה.
import { createServerFn } from "@tanstack/react-start";
import {
  parseBookingAction,
  parseCancellationDecision,
  parseGuestId,
  parseManualBooking,
  parseModifyBooking,
  parseStayStatus,
} from "../validation/input";
import type { Entitlements, JsonObject, StaffActionResult } from "../types/domain";

async function staffRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { requireSession } = await import("@/platform/auth/session.server");
  const { callRpc } = await import("./rpc.server");
  const session = await requireSession();
  return callRpc<T>(fn, args, { accessToken: session.accessToken });
}

export const hospitalityApproveBooking = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseBookingAction(input))
  .handler(({ data }) =>
    staffRpc<StaffActionResult>("approve_booking", {
      _booking_id: data.bookingId,
      _expected_revision: data.expectedRevision,
    }),
  );

export const hospitalityDeclineBooking = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseBookingAction(input))
  .handler(({ data }) =>
    staffRpc<StaffActionResult>("decline_booking", {
      _booking_id: data.bookingId,
      _reason: data.reason,
      _expected_revision: data.expectedRevision,
    }),
  );

export const hospitalityCreateManualBooking = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseManualBooking(input))
  .handler(({ data }) =>
    staffRpc<StaffActionResult>("create_manual_booking", {
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
    }),
  );

export const hospitalityModifyBooking = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseModifyBooking(input))
  .handler(({ data }) =>
    staffRpc<StaffActionResult>("modify_booking", {
      _booking_id: data.bookingId,
      _expected_revision: data.expectedRevision,
      _check_in: data.checkIn,
      _check_out: data.checkOut,
      _unit_id: data.unitId,
      _adults: data.adults,
      _children: data.children,
      _total_override: data.totalOverride,
      _note: data.note,
    }),
  );

export const hospitalityCancelBooking = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseCancellationDecision(input))
  .handler(({ data }) =>
    staffRpc<StaffActionResult>("cancel_booking", {
      _booking_id: data.bookingId,
      _reason: data.reason,
      _fee_override: data.feeOverride,
      _override_reason: data.overrideReason,
      _expected_revision: data.expectedRevision,
    }),
  );

export const hospitalityApproveCancellation = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseCancellationDecision(input))
  .handler(({ data }) =>
    staffRpc<StaffActionResult>("approve_cancellation", {
      _booking_id: data.bookingId,
      _fee_override: data.feeOverride,
      _override_reason: data.overrideReason,
      _expected_revision: data.expectedRevision,
    }),
  );

export const hospitalityDeclineCancellation = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseBookingAction(input))
  .handler(({ data }) =>
    staffRpc<StaffActionResult>("decline_cancellation", {
      _booking_id: data.bookingId,
      _reason: data.reason,
      _expected_revision: data.expectedRevision,
    }),
  );

export const hospitalitySetStayStatus = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseStayStatus(input))
  .handler(({ data }) =>
    staffRpc<StaffActionResult>("set_stay_status", {
      _booking_id: data.bookingId,
      _status: data.status,
      _expected_revision: data.expectedRevision,
    }),
  );

export const hospitalityExportGuest = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseGuestId(input))
  .handler(({ data }) => staffRpc<JsonObject>("export_guest", { _guest_id: data.guestId }));

export const hospitalityAnonymizeGuest = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseGuestId(input))
  .handler(({ data }) => staffRpc<boolean>("anonymize_guest", { _guest_id: data.guestId }));

export const hospitalityMyEntitlements = createServerFn({ method: "POST" }).handler(() =>
  staffRpc<Entitlements>("my_entitlements", {}),
);
