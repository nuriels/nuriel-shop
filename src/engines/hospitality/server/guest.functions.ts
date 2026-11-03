// פונקציות שרת לאורח מחובר (Google / קוד במייל — מערכת ההתחברות הקיימת, D17).
// אין כללי שיוך של חנויות: אורח יכול להיות איש צוות באתר אחר. ההרשאה במסד:
// request_tenant() + auth.uid(). קישור הזמנה לחשבון — רק עם אסימון הניהול מהמייל (SEC-C1),
// לא לפי התאמת כתובת אימייל (שאוטו-אישור של GoTrue הפך לחסרת-משמעות).
import { createServerFn } from "@tanstack/react-start";
import { parseClaimToken } from "../validation/input";
import type { GuestBookingView } from "../types/domain";

export const hospitalityMyBookings = createServerFn({ method: "POST" }).handler(async () => {
  const { requireSession } = await import("@/platform/auth/session.server");
  const { callRpc } = await import("./rpc.server");
  const session = await requireSession();
  return callRpc<GuestBookingView[]>("my_bookings", {}, { accessToken: session.accessToken });
});

export const hospitalityClaimBookings = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseClaimToken(input))
  .handler(async ({ data }) => {
    const { requireSession } = await import("@/platform/auth/session.server");
    const { callRpc } = await import("./rpc.server");
    const session = await requireSession();
    const linked = await callRpc<number>(
      "claim_guest_bookings",
      { _token: data.token },
      { accessToken: session.accessToken },
    );
    return { linked };
  });
