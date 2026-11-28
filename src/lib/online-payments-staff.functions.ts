import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { OnlinePaymentView } from "@/platform/payments/tenant-views";

/**
 * MAX/Hyp DEMO — an order's online payment in the store's order panel (tenant scope).
 *  getOrderOnlinePayment     — status, amount, approval code, card last 4, review reason (store admins / agents;
 *                              platform admins act as admins of every store)
 *  cancelOrderOnlinePayment  — cancels the live attempt so the order can be edited (a payment being verified is
 *                              never cancelled; the customer then opens a new attempt) — store admins
 *  resolveOrderOnlinePayment — marks a payment that waited for review as handled, with a note — store admins
 * requireSupabaseAuth (store membership, not blocked), POST + CSRF, rate-limited per user. The store is the
 * request's host; the DB authorizes the actor again.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOO_MANY = "יותר מדי ניסיונות. אפשר לנסות שוב בעוד כמה דקות.";
const NO_PERMISSION = "אין הרשאה לפעולה הזו";

function uuidOf(value: unknown, notFound: string): string {
  const id = String(value ?? "").trim();
  if (!UUID.test(id)) throw new Error(notFound);
  return id.toLowerCase();
}

/** the store of the host + the caller's role there (platform admins: "admin" in every store) */
async function staffContext(userId: string, limit: number) {
  const { allowAction } = await import("@/lib/rate-limit.server");
  if (!allowAction(`pay-staff:${userId}`, limit, 15 * 60 * 1000)) throw new Error(TOO_MANY);
  const { currentTenantId, isPlatformRequest } =
    await import("@/integrations/supabase/tenant.server");
  if (isPlatformRequest()) throw new Error(NO_PERMISSION);
  const { loadCaller } = await import("@/lib/caller.server");
  const caller = await loadCaller(userId);
  return { tenantId: currentTenantId(), role: caller.role };
}

export const getOrderOnlinePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => ({
    orderId: uuidOf(input?.orderId, "ההזמנה לא נמצאה"),
  }))
  .handler(async ({ data, context }): Promise<OnlinePaymentView | null> => {
    const helpers = await import("@/lib/online-payments.server");
    try {
      const { tenantId, role } = await staffContext(context.userId, 240);
      if (role !== "admin" && role !== "agent") throw new Error(NO_PERMISSION);
      const { staffOrderPayment } = await import("@/platform/payments/server/tenant/staff");
      return await staffOrderPayment(context.userId, tenantId, data.orderId);
    } catch (error) {
      throw helpers.paymentFnError(error);
    }
  });

export const cancelOrderOnlinePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => ({
    orderId: uuidOf(input?.orderId, "ההזמנה לא נמצאה"),
  }))
  .handler(async ({ data, context }): Promise<{ cancelled: number }> => {
    const helpers = await import("@/lib/online-payments.server");
    try {
      const { tenantId, role } = await staffContext(context.userId, 30);
      if (role !== "admin") throw new Error(NO_PERMISSION);
      const { cancelOrderAttempt } = await import("@/platform/payments/server/tenant/staff");
      return { cancelled: await cancelOrderAttempt(context.userId, tenantId, data.orderId) };
    } catch (error) {
      throw helpers.paymentFnError(error);
    }
  });

export const resolveOrderOnlinePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string; attemptId: string; note?: string | null }) => ({
    orderId: uuidOf(input?.orderId, "ההזמנה לא נמצאה"),
    attemptId: uuidOf(input?.attemptId, "התשלום לא נמצא"),
    note:
      String(input?.note ?? "")
        .trim()
        .slice(0, 500) || null,
  }))
  .handler(async ({ data, context }): Promise<{ resolved: boolean }> => {
    const helpers = await import("@/lib/online-payments.server");
    try {
      const { tenantId, role } = await staffContext(context.userId, 30);
      if (role !== "admin") throw new Error(NO_PERMISSION);
      const { resolveOrderReview } = await import("@/platform/payments/server/tenant/staff");
      return {
        resolved: await resolveOrderReview(context.userId, tenantId, data.attemptId, data.note),
      };
    } catch (error) {
      throw helpers.paymentFnError(error);
    }
  });
