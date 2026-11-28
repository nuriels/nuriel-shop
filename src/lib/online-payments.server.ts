/**
 * Online payments (MAX/Hyp DEMO), tenant scope — the store-side effects that need the Ecommerce layer, and the
 * shared plumbing of the store's payment server functions. Server only (loaded with `await import()` inside
 * handlers and server routes).
 *
 * The orchestrators (src/platform/payments/server/tenant/*) cannot import product code (platform layer), so they
 * return outcomes and this module acts on them:
 *   • sendOnlinePaidEmails — the order e-mails, only for an order the settle just marked paid (never at order time,
 *     never from a browser, never twice: a replayed return is not verified again);
 *   • alertStoreStaffReview — the store admins' bell when a payment waits for a person (review, double charge).
 * Logging goes through the scope's redacting logger only (DM-SEC-7).
 */
import { supabaseAdminUnscoped } from "@/integrations/supabase/client.server";
import { GENERIC_FAILURE, TenantPaymentError } from "@/platform/payments/server/tenant/db";
import { shortId, tenantLog } from "@/platform/payments/server/tenant/log";
import type { PaidOrder, ReviewItem } from "@/platform/payments/server/tenant/return";
import { reviewReasonLabel } from "@/platform/payments/tenant-views";

const HEBREW = /[֐-׿]/;

/** what a store payment server function may throw to the browser: a fixed Hebrew text, never a DB or Hyp text */
export function paymentFnError(error: unknown): Error {
  if (error instanceof TenantPaymentError) return new Error(error.message);
  // our own fixed Hebrew refusals (input checks, "not found")
  if (error instanceof Error && HEBREW.test(error.message) && error.message.length <= 300)
    return error;
  tenantLog.error("server_fn_failed", { kind: error instanceof Error ? error.name : typeof error });
  return new Error(GENERIC_FAILURE);
}

/** the store of the request's host; null on the platform host or when no store was resolved */
export async function hostStoreId(): Promise<string | null> {
  const { isPlatformRequest, maybeCurrentTenant } =
    await import("@/integrations/supabase/tenant.server");
  if (isPlatformRequest()) return null;
  return maybeCurrentTenant()?.id ?? null;
}

/** the signed-in user of the request, or null (an invalid token is refused, never treated as a guest) */
export async function requestUserId(): Promise<string | null> {
  const { sessionFromRequest } = await import("@/platform/auth/session.server");
  try {
    return (await sessionFromRequest())?.userId ?? null;
  } catch {
    throw new Error("החיבור פג. יש להתחבר מחדש ולנסות שוב.");
  }
}

/**
 * The success URL of a store's terminal, to paste in Hyp's portal: the store's own platform subdomain (stable, also
 * when a custom domain is connected), no trailing slash (a trailing slash would cost a 308 hop, C7).
 */
export async function storeReturnAddress(
  tenantId: string,
): Promise<{ successUrl: string | null; defaultStore: boolean }> {
  try {
    const { loadTenantById, slugOriginForTenant } =
      await import("@/integrations/supabase/tenant.server");
    const tenant = await loadTenantById(tenantId);
    if (!tenant) return { successUrl: null, defaultStore: false };
    return {
      successUrl: `${slugOriginForTenant(tenant)}/payments/return/max`,
      defaultStore: tenant.is_default,
    };
  } catch {
    return { successUrl: null, defaultStore: false };
  }
}

/** the order e-mails of an order that was just settled as paid — in that store's context */
export async function sendOnlinePaidEmails(tenantId: string, orderId: string): Promise<void> {
  try {
    const { loadTenantById, maybeCurrentTenant, runWithTenant } =
      await import("@/integrations/supabase/tenant.server");
    const { sendOrderEmailsInternal } = await import("@/lib/order-emails.server");
    if (maybeCurrentTenant()?.id === tenantId) {
      await sendOrderEmailsInternal(orderId, null);
      return;
    }
    // the 5-minute job: no request, so the store's context is set here (the e-mail data is store-scoped)
    const tenant = await loadTenantById(tenantId);
    if (!tenant) return;
    await runWithTenant(tenant.domain ?? tenant.slug, tenant, () =>
      sendOrderEmailsInternal(orderId, null),
    );
  } catch {
    tenantLog.error("paid_emails_failed", { order: shortId(orderId) });
  }
}

/** the store admins' bell: a payment of this store waits for a person (fixed text, no amounts, no card data) */
export async function alertStoreStaffReview(item: ReviewItem): Promise<void> {
  try {
    const { data: admins } = await supabaseAdminUnscoped
      .from("user_roles")
      .select("user_id")
      .eq("tenant_id", item.tenantId)
      .eq("role", "admin")
      .eq("is_blocked", false);
    let label = "";
    if (item.orderId) {
      const { data: order } = await supabaseAdminUnscoped
        .from("orders")
        .select("order_number")
        .eq("id", item.orderId)
        .eq("tenant_id", item.tenantId)
        .maybeSingle();
      label = order?.order_number ? ` ${String(order.order_number)}` : "";
    }
    const rows = (admins ?? []).map((admin: { user_id: string }) => ({
      tenant_id: item.tenantId,
      user_id: admin.user_id,
      kind: "system",
      title: "תשלום מקוון לבדיקה",
      body: `התשלום המקוון של הזמנה${label} ממתין לבדיקה ידנית: ${reviewReasonLabel(item.reason)}. אין לשלוח את ההזמנה לפני הבדיקה.`,
      link: "/admin?tab=orders",
    }));
    if (rows.length > 0) await supabaseAdminUnscoped.from("staff_notifications").insert(rows);
  } catch {
    tenantLog.error("review_alert_failed", { order: shortId(item.orderId) });
  }
}

/** after a return or a job run: e-mails for paid orders, the bell for reviews */
export async function actOnTenantOutcomes(outcomes: {
  paid: readonly PaidOrder[];
  review: readonly ReviewItem[];
}): Promise<void> {
  for (const paid of outcomes.paid) await sendOnlinePaidEmails(paid.tenantId, paid.orderId);
  for (const item of outcomes.review) await alertStoreStaffReview(item);
}
