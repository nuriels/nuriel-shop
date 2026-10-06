import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TrackingEmailResult = { sent: boolean; skipped: boolean; reason: string | null };

/**
 * חלק 25: אחרי שמירת מספר מעקב — מייל "ההזמנה שלך בדרך!" ללקוח, פעם אחת לכל מספר.
 * הסימון נעשה במסד (order_claim_tracking_email, בהרשאות המשתמש: מנהל החנות או הסוכן
 * של ההזמנה); אם השליחה נכשלה — הסימון מוחזר, ושמירה הבאה תנסה שוב.
 */
export const sendTrackingEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => {
    const orderId = String(input?.orderId ?? "").trim();
    if (!UUID_FORMAT.test(orderId)) throw new Error("מזהה הזמנה לא תקין");
    return { orderId };
  })
  .handler(async ({ data, context }): Promise<TrackingEmailResult> => {
    const { data: claim, error } = await context.supabase.rpc("order_claim_tracking_email", {
      _order_id: data.orderId,
    });
    if (error) throw new Error(error.message);
    const result = claim as unknown as { claimed: boolean; previous?: string | null };
    if (!result.claimed) return { sent: false, skipped: true, reason: null };

    const release = async () => {
      await context.supabase.rpc("order_release_tracking_email", {
        _order_id: data.orderId,
        _previous: result.previous ?? null,
      });
    };
    try {
      const { sendShippedEmailInternal } = await import("@/lib/order-emails.server");
      const sent = await sendShippedEmailInternal(data.orderId, context.userId);
      if (sent.sent) return { sent: true, skipped: false, reason: null };
      await release();
      return { sent: false, skipped: false, reason: sent.reason ?? "השליחה נכשלה" };
    } catch (sendError) {
      await release();
      return {
        sent: false,
        skipped: false,
        reason: sendError instanceof Error ? sendError.message : "השליחה נכשלה",
      };
    }
  });
