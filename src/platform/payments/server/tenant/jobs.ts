/**
 * Online payments, tenant scope — the periodic work (server only). No timer here: it runs inside the existing
 * 5-minute payment tick (src/server/services/payment-expiry.ts), which also sends the e-mails of orders it settles.
 *
 *   1. VERIFY again the returns that arrived but could not be verified (Hyp unreachable, a timeout, a restart):
 *      max_attempts_pending_verify → the kept raw return → VERIFY → settle (reverifyTenantReturn);
 *   2. expire attempts (max_attempts_expire; a settling attempt is never touched);
 *   3. purge the encrypted raw returns (platform_payment_returns_purge: at most 2 hours, or once VERIFY concluded).
 * PAYMENTS_JOBS=off (an operational switch; E2E sets it and runs the steps itself) or payments off → nothing.
 * No call at server start: the first tick comes 5 minutes after boot.
 */
import { paymentsRpc } from "@/platform/payments/server/db";
import { paymentsReady } from "@/platform/payments/server/env";
import { tenantLog } from "./log";
import {
  pendingVerifyItems,
  reverifyTenantReturn,
  type PaidOrder,
  type ReviewItem,
} from "./return";

export interface TenantJobResult {
  paid: PaidOrder[];
  review: ReviewItem[];
}

const PENDING_BATCH = 20;

/** one run at a time (a slow VERIFY must not overlap the next tick) */
let running = false;

export function paymentJobsEnabled(): boolean {
  return process.env["PAYMENTS_JOBS"]?.trim().toLowerCase() !== "off";
}

export async function runTenantPaymentJobs(): Promise<TenantJobResult> {
  const result: TenantJobResult = { paid: [], review: [] };
  if (!paymentJobsEnabled() || !paymentsReady("tenant").ok || running) return result;
  running = true;
  try {
    const pending = await paymentsRpc("max_attempts_pending_verify", { _limit: PENDING_BATCH });
    if (pending.error) tenantLog.warn("job_pending_failed", { code: pending.error.code });
    for (const item of pendingVerifyItems(pending.data)) {
      const outcome = await reverifyTenantReturn(item);
      if (outcome?.paid) result.paid.push(outcome.paid);
      if (outcome?.review) result.review.push(outcome.review);
    }
    const expired = await paymentsRpc("max_attempts_expire");
    if (expired.error) tenantLog.warn("job_expire_failed", { code: expired.error.code });
    else if (typeof expired.data === "number" && expired.data > 0)
      tenantLog.info("job_expired", { count: expired.data });
    const purged = await paymentsRpc("platform_payment_returns_purge");
    if (purged.error) tenantLog.warn("job_purge_failed", { code: purged.error.code });
  } catch {
    tenantLog.error("job_failed");
  } finally {
    running = false;
  }
  return result;
}
