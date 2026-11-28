import { createServerFn } from "@tanstack/react-start";
import { requireStoreOpen } from "@/lib/rest-window.middleware";
import type { OnlinePaymentOptions, OnlinePaymentView } from "@/platform/payments/tenant-views";

/**
 * MAX/Hyp DEMO — online card payment in the store's checkout (tenant scope), for a signed-in customer or a guest.
 *
 *  getOnlinePaymentOptions — may the checkout offer the payment (an active store terminal, the switch on, payments
 *                            ready in this environment) and is this the DEMO environment.
 *  startOnlinePayment      — the order already awaits payment: opens (or reuses) its attempt and returns the signed
 *                            Hyp page the browser opens. Amount, reference and terminal come from the DB.
 *  getOnlinePaymentStatus  — the pay / result page: the order's payment status (no secrets, no card data beyond the
 *                            last 4 digits). "Paid" is decided only by the server's VERIFY after Hyp's return.
 * POST (CSRF middleware), store hosts only, rate-limited by IP and order. The store is the request's host; a guest
 * proves the order with the one-time token issued when the order was placed. Server code is loaded inside the
 * handlers only (U17-B11).
 */

const TOO_MANY = "יותר מדי ניסיונות. אפשר לנסות שוב בעוד כמה דקות.";
const NOT_FOUND = "ההזמנה לא נמצאה";
const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GUEST_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const WINDOW_MS = 15 * 60 * 1000;

function orderIdOf(value: unknown): string {
  const id = String(value ?? "").trim();
  if (!ORDER_ID.test(id)) throw new Error(NOT_FOUND);
  return id.toLowerCase();
}

function guestTokenOf(value: unknown): string | null {
  return typeof value === "string" && GUEST_TOKEN.test(value) ? value : null;
}

async function allow(key: string, limit: number): Promise<boolean> {
  const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
  return allowAction(`${key}:${await requestIp()}`, limit, WINDOW_MS);
}

export const getOnlinePaymentOptions = createServerFn({ method: "POST" }).handler(
  async (): Promise<OnlinePaymentOptions> => {
    const off: OnlinePaymentOptions = { available: false, demo: false };
    if (!(await allow("pay-options", 120))) return off;
    const helpers = await import("@/lib/online-payments.server");
    try {
      const tenantId = await helpers.hostStoreId();
      if (!tenantId) return off;
      const userId = await helpers.requestUserId().catch(() => null);
      const { tenantPaymentOptions } = await import("@/platform/payments/server/tenant/checkout");
      return await tenantPaymentOptions(tenantId, userId);
    } catch {
      return off;
    }
  },
);

export const startOnlinePayment = createServerFn({ method: "POST" })
  // חלק 35: שבת / חג — עוצרים כבר כאן (כמו בהזמנה עצמה)
  .middleware([requireStoreOpen])
  .inputValidator((input: { orderId: string; guestToken?: string | null }) => ({
    orderId: orderIdOf(input?.orderId),
    guestToken: guestTokenOf(input?.guestToken),
  }))
  .handler(async ({ data }): Promise<{ url: string; demo: boolean }> => {
    if (!(await allow("pay-start", 20))) throw new Error(TOO_MANY);
    if (!(await allow(`pay-start-order:${data.orderId}`, 10))) throw new Error(TOO_MANY);
    const helpers = await import("@/lib/online-payments.server");
    try {
      const tenantId = await helpers.hostStoreId();
      if (!tenantId) throw new Error(NOT_FOUND);
      const customerId = await helpers.requestUserId();
      const { startTenantPayment } = await import("@/platform/payments/server/tenant/checkout");
      return await startTenantPayment({
        tenantId,
        orderId: data.orderId,
        customerId,
        guestToken: data.guestToken,
        loadClient: async () => {
          // Hyp's page prefill: the order's own contact details (DEMO: synthetic customers), nothing else
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: order } = await supabaseAdmin
            .from("orders")
            .select("customer_name, customer_email, customer_phone")
            .eq("id", data.orderId)
            .maybeSingle();
          if (!order) return undefined;
          const name = (order.customer_name ?? "").trim();
          const space = name.indexOf(" ");
          const client: { firstName?: string; lastName?: string; email?: string; cell?: string } =
            {};
          const first = space > 0 ? name.slice(0, space) : name;
          const last = space > 0 ? name.slice(space + 1).trim() : "";
          if (first) client.firstName = first;
          if (last) client.lastName = last;
          if (order.customer_email) client.email = order.customer_email;
          if (order.customer_phone) client.cell = order.customer_phone;
          return client;
        },
      });
    } catch (error) {
      throw helpers.paymentFnError(error);
    }
  });

export const getOnlinePaymentStatus = createServerFn({ method: "POST" })
  .inputValidator((input: { orderId: string; guestToken?: string | null }) => ({
    orderId: orderIdOf(input?.orderId),
    guestToken: guestTokenOf(input?.guestToken),
  }))
  .handler(async ({ data }): Promise<OnlinePaymentView | null> => {
    if (!(await allow("pay-status", 240))) throw new Error(TOO_MANY);
    const helpers = await import("@/lib/online-payments.server");
    try {
      const tenantId = await helpers.hostStoreId();
      if (!tenantId) return null;
      const customerId = await helpers.requestUserId();
      const { customerOrderPayment } = await import("@/platform/payments/server/tenant/checkout");
      return await customerOrderPayment({
        tenantId,
        orderId: data.orderId,
        customerId,
        guestToken: data.guestToken,
      });
    } catch (error) {
      throw helpers.paymentFnError(error);
    }
  });
