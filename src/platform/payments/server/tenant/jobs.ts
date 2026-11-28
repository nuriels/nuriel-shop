/**
 * Online payments, tenant scope — the periodic work (server only). No timer here: it runs inside the existing
 * 5-minute payment tick (src/server/services/payment-expiry.ts), AFTER and independent of expire_unpaid_orders
 * (X-19), and the tick sends the e-mails of orders it settles and the claimed review alerts.
 *
 *   1. VERIFY again the returns that arrived but could not be verified (Hyp unreachable, a timeout, a restart):
 *      max_attempts_pending_verify → the kept raw return → VERIFY → settle (reverifyTenantReturn) — only when
 *      paymentsReady('tenant') is ok;
 *   2. the sweep (max_attempts_expire: expiries, and parking what can no longer be verified) — DB only, always;
 *   3. purge the encrypted raw returns (platform_payment_returns_purge) — DB only, always;
 *   4. claim the review alerts not sent yet (max_review_alerts_claim, X-17) — always.
 * PAYMENTS_JOBS=off (an operational switch; E2E sets it and runs the steps itself) → nothing at all.
 * No call at server start: the first tick comes 5 minutes after boot.
 */
import { paymentsRpc } from "@/platform/payments/server/db";
import { paymentsReady } from "@/platform/payments/server/env";
import { claimTenantReviewAlerts, type ReviewItem } from "./alerts";
import { tenantLog } from "./log";
import { pendingVerifyItems, reverifyTenantReturn, type PaidOrder } from "./return";

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

/**
 * X-25: at server start — PAYMENTS_JOBS=off on a server whose store payments are configured (env set, tenant side
 * ready) means nothing parks or alerts: one ALERT line. The switch is for tests and emergencies only.
 */
export function alertIfJobsOff(): boolean {
  if (paymentJobsEnabled() || !paymentsReady("tenant").ok) return false;
  tenantLog.alert("jobs_off");
  return true;
}

export async function runTenantPaymentJobs(): Promise<TenantJobResult> {
  const result: TenantJobResult = { paid: [], review: [] };
  if (!paymentJobsEnabled() || running) return result;
  running = true;
  try {
    const ready = paymentsReady("tenant");
    if (ready.ok) {
      try {
        const pending = await paymentsRpc("max_attempts_pending_verify", { _limit: PENDING_BATCH });
        if (pending.error) tenantLog.warn("job_pending_failed", { code: pending.error.code });
        for (const item of pendingVerifyItems(pending.data)) {
          const outcome = await reverifyTenantReturn(item);
          if (outcome?.paid) result.paid.push(outcome.paid);
        }
      } catch {
        tenantLog.error("job_verify_failed");
      }
    } else {
      // X-19: no VERIFY without a usable key — the DB-only steps below still park, purge and alert
      tenantLog.warn("job_verify_skipped", { why: ready.reason });
    }
    try {
      const expired = await paymentsRpc("max_attempts_expire");
      if (expired.error) tenantLog.warn("job_expire_failed", { code: expired.error.code });
      else if (typeof expired.data === "number" && expired.data > 0)
        tenantLog.info("job_expired", { count: expired.data });
      const purged = await paymentsRpc("platform_payment_returns_purge");
      if (purged.error) tenantLog.warn("job_purge_failed", { code: purged.error.code });
    } catch {
      tenantLog.error("job_failed");
    }
    // last: what the sweep and the purge just parked is alerted in this same tick
    result.review = await claimTenantReviewAlerts();
  } finally {
    running = false;
  }
  return result;
}
