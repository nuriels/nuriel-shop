import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * חלק 33: עדכון סטטוס משלוח ע"י המחסנאי (או מנהל) — בלי גישה להזמנות עצמן.
 * הבדיקה וההעברה במסד (fulfillment_set_status: הרשאת orders.fulfill, מעברים
 * מותרים בלבד), עם החיבור של המשתמש. "נשלחה" → מייל "יצאה למשלוח" ללקוח
 * (כמו הסימון המרוכז בניהול). כישלון המייל לא מבטל את העדכון.
 */

const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TARGETS = ["shipped", "delivered", "awaiting_courier"] as const;
type Target = (typeof TARGETS)[number];

export type FulfillmentUpdateResult = {
  orderNumber: string;
  status: Target;
  email: { sent: boolean; reason: string | null } | null;
};

export const setFulfillmentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      orderId: string;
      status: string;
      trackingNumber?: string | null;
      shippingProvider?: string | null;
    }) => {
      const orderId = String(input?.orderId ?? "").trim();
      if (!UUID_FORMAT.test(orderId)) throw new Error("הזמנה לא תקינה");
      const status = input?.status as Target;
      if (!TARGETS.includes(status)) throw new Error("סטטוס לא תקין");
      const clean = (value: unknown, max: number): string | null => {
        if (value === undefined || value === null) return null;
        const text = String(value).trim();
        if (text.length > max) throw new Error("פרטי המשלוח ארוכים מדי");
        return text;
      };
      return {
        orderId,
        status,
        trackingNumber: clean(input?.trackingNumber, 100),
        shippingProvider: clean(input?.shippingProvider, 60),
      };
    },
  )
  .handler(async ({ data, context }): Promise<FulfillmentUpdateResult> => {
    const { requireStaffPermission } = await import("@/lib/caller.server");
    await requireStaffPermission(context.userId, "orders.fulfill");

    // לא נשלח = לא לגעת; מחרוזת ריקה = למחוק
    const { data: raw, error } = await context.supabase.rpc("fulfillment_set_status", {
      _order_id: data.orderId,
      _status: data.status,
      ...(data.trackingNumber !== null ? { _tracking_number: data.trackingNumber } : {}),
      ...(data.shippingProvider !== null ? { _shipping_provider: data.shippingProvider } : {}),
    });
    if (error) throw new Error(error.message);
    const result = (raw ?? {}) as { order_number?: string; notify?: boolean };

    let email: FulfillmentUpdateResult["email"] = null;
    if (result.notify) {
      try {
        const { resendApiKey } = await import("@/lib/email.server");
        if (!resendApiKey()) {
          email = { sent: false, reason: "מפתח המיילים לא הוגדר בשרת" };
        } else {
          const { sendShippedEmailInternal } = await import("@/lib/order-emails.server");
          const sent = await sendShippedEmailInternal(data.orderId, context.userId);
          email = { sent: sent.sent, reason: sent.sent ? null : (sent.reason ?? null) };
        }
      } catch (sendError) {
        email = {
          sent: false,
          reason: sendError instanceof Error ? sendError.message : "שליחת המייל נכשלה",
        };
      }
    }
    return { orderNumber: result.order_number ?? "", status: data.status, email };
  });
