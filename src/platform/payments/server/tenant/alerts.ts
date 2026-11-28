/**
 * Online payments, tenant scope — the ONE source of store review alerts (contract §7.1 X-17). Server only.
 *
 * Every attempt that gets a review reason — by a settle result, by the sweep, by the purge, by a credentials change —
 * is alerted exactly once: max_review_alerts_claim returns the rows not alerted yet and stamps them (FOR UPDATE SKIP
 * LOCKED) before anything is sent. The caller (src/lib/online-payments.server.ts) sends the store bell, the e-mail to
 * the store and one ALERT line per claimed row, and logs an ALERT with the attempt's short id when sending fails (the
 * row is already stamped, so it is never dropped silently). Called after every handled return and in every tick, also
 * when payments are not ready. No other code path rings for a review (U17-B13).
 */
import { paymentsRpc } from "@/platform/payments/server/db";
import { asArray, asRecord, str, uuid } from "./db";
import { shortId, tenantLog } from "./log";

/** one claimed review: what the bell and the e-mail need (no amounts, no card data) */
export type ReviewItem = {
  tenantId: string;
  attemptId: string;
  orderId: string | null;
  reason: string;
};

/** rows per claim (the next call or tick takes the rest) */
export const REVIEW_CLAIM_LIMIT = 50;

export function reviewAlertItems(data: unknown): ReviewItem[] {
  return asArray(data).flatMap((row) => {
    const r = asRecord(row);
    const tenantId = uuid(r?.["tenant_id"]);
    const attemptId = uuid(r?.["attempt_id"]);
    if (!tenantId || !attemptId) return [];
    const reason = str(r?.["review_reason"]) ?? str(r?.["reason"]) ?? "needs_review";
    return [{ tenantId, attemptId, orderId: uuid(r?.["order_id"]), reason }];
  });
}

/** claims the store reviews not alerted yet (stamped by the DB); [] when the call fails (the next call retries) */
export async function claimTenantReviewAlerts(
  limit: number = REVIEW_CLAIM_LIMIT,
): Promise<ReviewItem[]> {
  const answer = await paymentsRpc("max_review_alerts_claim", { _limit: limit });
  if (answer.error) {
    tenantLog.error("review_claim_failed", { code: answer.error.code });
    return [];
  }
  const items = reviewAlertItems(answer.data);
  for (const item of items)
    tenantLog.alert("needs_review", { attempt: shortId(item.attemptId), reason: item.reason });
  return items;
}
