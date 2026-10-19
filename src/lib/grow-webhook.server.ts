/**
 * חלק 43: עיבוד ההתראה של Grow — צד שרת. נפרד מהנתיב כדי שאפשר יהיה לבדוק אותו.
 */

import { supabaseAdminUnscoped } from "@/integrations/supabase/client.server";
import {
  approveGrowTransaction,
  loadGrowCredentials,
  parseGrowWebhook,
  sha256Hex,
} from "@/lib/grow.server";
import { recordPlatformAudit } from "@/lib/platform-files.server";

export type GrowWebhookOutcome =
  "malformed" | "paid" | "already_paid" | "paid_late" | "rejected" | "ignored";

type MarkResult = { result?: string; order_id?: string; tenant_id?: string };

export async function processGrowWebhook(request: Request): Promise<GrowWebhookOutcome> {
  const hook = await parseGrowWebhook(request);
  if (!hook) return "malformed";

  // ההתראה לא אומרת אם זה סנדבוקס: מנסים ייצור, ואם התהליך / הטוקן לא תואמים — סנדבוקס
  const tokenHash = sha256Hex(hook.processToken);
  let mark: MarkResult = {};
  for (const sandbox of [false, true]) {
    const { data, error } = await supabaseAdminUnscoped.rpc("grow_mark_paid", {
      _process_id: hook.processId,
      _sandbox: sandbox,
      _token_hash: tokenHash,
      _sum: hook.sum,
      _status_code: hook.statusCode,
      _asmachta: hook.asmachta,
      _transaction_id: hook.transactionId,
      _card_brand: hook.cardBrand,
      _card_suffix: hook.cardSuffix,
      _installments: hook.paymentsNum,
    });
    if (error) {
      console.error("[grow-webhook] mark paid failed", error.message);
      return "ignored";
    }
    mark = (data ?? {}) as MarkResult;
    if (mark.result !== "unknown" && mark.result !== "bad_token") break;
  }

  const tenantId = mark.tenant_id ?? null;
  switch (mark.result) {
    case "paid": {
      if (tenantId) {
        const creds = await loadGrowCredentials(tenantId).catch(() => null);
        if (creds) await approveGrowTransaction(creds, hook);
        await recordPlatformAudit({
          tenantId,
          actor: null,
          action: "grow_payment_received",
          details: { orderId: mark.order_id ?? null, asmachta: hook.asmachta },
        });
      }
      await sendPaidEmails(tenantId, mark.order_id);
      return "paid";
    }
    case "already_paid":
      return "already_paid";
    case "paid_late":
      // שולם אחרי שההזמנה פגה — דורש טיפול ידני (החזר או הזמנה חדשה)
      await recordPlatformAudit({
        tenantId,
        actor: null,
        action: "grow_payment_after_cancel",
        details: { orderId: mark.order_id ?? null, asmachta: hook.asmachta },
      });
      return "paid_late";
    case "amount_mismatch":
    case "bad_token":
    case "not_paid":
      if (mark.result !== "not_paid") {
        await recordPlatformAudit({
          tenantId,
          actor: null,
          action: "grow_webhook_rejected",
          details: { reason: mark.result, processId: hook.processId },
        });
      }
      return "rejected";
    default:
      return "ignored";
  }
}

/** אישור ההזמנה + התראה לצוות — רצים בהקשר החנות של ההזמנה */
async function sendPaidEmails(tenantId: string | null, orderId: string | undefined): Promise<void> {
  if (!tenantId || !orderId) return;
  try {
    const { loadTenantById, runWithTenant } = await import("@/integrations/supabase/tenant.server");
    const tenant = await loadTenantById(tenantId);
    if (!tenant) return;
    const { sendOrderEmailsInternal } = await import("@/lib/order-emails.server");
    await runWithTenant(tenant.domain ?? tenant.slug, tenant, () =>
      sendOrderEmailsInternal(orderId, null),
    );
  } catch (error) {
    console.error("[grow-webhook] order emails failed", error);
  }
}
