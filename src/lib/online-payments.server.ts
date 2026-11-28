/**
 * Online payments (MAX/Hyp DEMO), tenant scope — the store-side effects that need the Ecommerce layer, and the
 * shared plumbing of the store's payment server functions. Server only (loaded with `await import()` inside
 * handlers and server routes).
 *
 * The orchestrators (src/platform/payments/server/tenant/*) cannot import product code (platform layer), so they
 * return outcomes and this module acts on them:
 *   • sendOnlinePaidEmails — the order e-mails, only for an order the settle just marked paid (never at order time,
 *     never from a browser, never twice: a replayed return is not verified again);
 *   • actOnTenantOutcomes — paid e-mails, and the bell + e-mail for each review claimed by max_review_alerts_claim (X-17).
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

/**
 * P-6a (1)(5): every access to a store terminal (status, save, connection check, the unreturned list) — the platform
 * host AND a platform admin, checked before any payments call; the DB checks the same actor again. The store is
 * the one named in the request; the DB and the encryption context (tenant id in the AAD) bind the account to it.
 */
export async function requirePlatformTerminalAdmin(userId: string, limit: number): Promise<void> {
  const { isPlatformRequest } = await import("@/integrations/supabase/tenant.server");
  if (!isPlatformRequest()) throw new Error("רק מפאנל הפלטפורמה");
  const { isPlatformAdminUser } = await import("@/integrations/supabase/client.server");
  if (!(await isPlatformAdminUser(userId))) throw new Error("אין הרשאה לפעולה הזו");
  const { allowAction } = await import("@/lib/rate-limit.server");
  if (!allowAction(`pay-admin:${userId}`, limit, 15 * 60 * 1000))
    throw new Error("יותר מדי ניסיונות. אפשר לנסות שוב בעוד כמה דקות.");
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

/** runs `work` in the store's context (the 5-minute tick has no request; e-mail logs are store-scoped) */
async function inStoreContext(tenantId: string, work: () => Promise<void>): Promise<void> {
  const { loadTenantById, maybeCurrentTenant, runWithTenant } =
    await import("@/integrations/supabase/tenant.server");
  if (maybeCurrentTenant()?.id === tenantId) return work();
  const tenant = await loadTenantById(tenantId);
  if (!tenant) throw new Error("store not found");
  await runWithTenant(tenant.domain ?? tenant.slug, tenant, work);
}

/**
 * One claimed review (X-17): the store admins' bell and an e-mail to them (fixed text, no amounts, no card data).
 * Only actOnTenantOutcomes calls it, only with rows max_review_alerts_claim returned (U17-B13). Throws when the
 * bell could not be written; a failed e-mail is logged by the e-mail service.
 */
async function sendStoreReviewAlert(item: ReviewItem): Promise<void> {
  const { data: admins, error } = await supabaseAdminUnscoped
    .from("user_roles")
    .select("user_id, email")
    .eq("tenant_id", item.tenantId)
    .eq("role", "admin")
    .eq("is_blocked", false);
  if (error) throw new Error("admins not loaded");
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
  const title = "תשלום מקוון לבדיקה";
  const body = `התשלום המקוון של הזמנה${label} ממתין לבדיקה ידנית: ${reviewReasonLabel(item.reason)}. אין לשלוח את ההזמנה לפני הבדיקה.`;
  const list = (admins ?? []) as { user_id: string; email: string | null }[];
  const rows = list.map((admin) => ({
    tenant_id: item.tenantId,
    user_id: admin.user_id,
    kind: "system",
    title,
    body,
    link: "/admin?tab=orders",
  }));
  if (rows.length > 0) {
    const inserted = await supabaseAdminUnscoped.from("staff_notifications").insert(rows);
    if (inserted.error) throw new Error("bell not written");
  }
  const to = [...new Set(list.map((admin) => admin.email?.trim() ?? "").filter((e) => e !== ""))];
  if (to.length === 0) return;
  await inStoreContext(item.tenantId, async () => {
    const [{ sendNotificationEmail }, { renderEmailHtml, escapeHtml }] = await Promise.all([
      import("@/server/services/notifications"),
      import("@/lib/email.server"),
    ]);
    await sendNotificationEmail({
      template: "order_staff",
      orderId: item.orderId,
      to,
      subject: `${title}${label ? ` —${label}` : ""}`,
      html: await renderEmailHtml(title, `<p>${escapeHtml(body)}</p>`),
      useStoreKey: false,
    });
  });
}

/**
 * After a return or a tick: e-mails for paid orders; for each CLAIMED review (X-17) the bell + the e-mail. The claim
 * stamped the row before this runs, so a failure is never retried: it is logged as an ALERT with the attempt id.
 */
export async function actOnTenantOutcomes(outcomes: {
  paid: readonly PaidOrder[];
  review: readonly ReviewItem[];
}): Promise<void> {
  for (const paid of outcomes.paid) await sendOnlinePaidEmails(paid.tenantId, paid.orderId);
  for (const item of outcomes.review) {
    try {
      await sendStoreReviewAlert(item);
    } catch {
      tenantLog.alert("review_alert_failed", { attempt: shortId(item.attemptId) });
    }
  }
}
