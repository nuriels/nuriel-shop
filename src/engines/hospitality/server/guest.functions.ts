// פונקציות שרת לאורח מחובר (Google / קוד במייל — מערכת ההתחברות הקיימת, D17).
// אין כללי שיוך של חנויות: אורח יכול להיות איש צוות באתר אחר. ההרשאה במסד:
// request_tenant() + auth.uid(), וקישור הזמנות רק לפי אימייל מאומת.
import { createServerFn } from "@tanstack/react-start";
import type { GuestBookingView } from "../types/domain";

export const hospitalityMyBookings = createServerFn({ method: "POST" }).handler(async () => {
  const { requireSession } = await import("@/platform/auth/session.server");
  const { callRpc } = await import("./rpc.server");
  const session = await requireSession();
  return callRpc<GuestBookingView[]>("my_bookings", {}, { accessToken: session.accessToken });
});

export const hospitalityClaimBookings = createServerFn({ method: "POST" }).handler(async () => {
  const { requireSession } = await import("@/platform/auth/session.server");
  const { callRpc } = await import("./rpc.server");
  const session = await requireSession();
  const linked = await callRpc<number>(
    "claim_guest_bookings",
    {},
    { accessToken: session.accessToken },
  );
  return { linked };
});
