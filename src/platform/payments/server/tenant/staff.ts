/**
 * Online payments, tenant scope — the store's staff on one order (the order panel). Server only. The DB authorizes
 * every call with the explicit store and actor: the view for the store's admins / agents and platform admins (with
 * the attempt id and the review reason, lead decision Q5); cancelling the live attempt (so the order can be edited;
 * a payment being verified is never cancelled) and closing a review for the store's admins.
 */
import { paymentsRpc } from "@/platform/payments/server/db";
import { testPaymentsEnv } from "@/platform/payments/server/env";
import {
  REVIEW_OUTCOMES,
  type OnlinePaymentView,
  type ReviewOutcome,
} from "@/platform/payments/tenant-views";
import { orderPaymentView } from "./checkout";
import { TenantPaymentError, int, unwrap } from "./db";
import { shortId, tenantLog } from "./log";

export async function staffOrderPayment(
  actorId: string,
  tenantId: string,
  orderId: string,
): Promise<OnlinePaymentView | null> {
  const answer = await paymentsRpc("max_order_payment_status", {
    _tenant: tenantId,
    _order: orderId,
    _viewer: actorId,
    _guest_token_sha256: null,
  });
  return orderPaymentView(unwrap("max_order_payment_status", answer), testPaymentsEnv());
}

export async function cancelOrderAttempt(
  actorId: string,
  tenantId: string,
  orderId: string,
): Promise<number> {
  const cancelled = int(
    unwrap(
      "max_attempt_cancel",
      await paymentsRpc("max_attempt_cancel", {
        _actor: actorId,
        _tenant: tenantId,
        _order: orderId,
      }),
    ),
  );
  tenantLog.info("attempt_cancelled_by_staff", { order: shortId(orderId), count: cancelled ?? 0 });
  return cancelled ?? 0;
}

/**
 * A person's review decision (X-16). not_charged → the DB resolves it and releases the order (payable again, or it
 * expires normally); charged → resolved, the order stays held for good (the store cancels and refunds in Hyp's portal).
 */
export async function resolveOrderReview(
  actorId: string,
  tenantId: string,
  attemptId: string,
  note: string | null,
  outcome: ReviewOutcome,
): Promise<boolean> {
  if (!REVIEW_OUTCOMES.includes(outcome)) throw new TenantPaymentError("יש לבחור אם בוצע חיוב");
  const resolved = unwrap(
    "max_review_resolve",
    await paymentsRpc("max_review_resolve", {
      _actor: actorId,
      _tenant: tenantId,
      _attempt: attemptId,
      _note: note,
      _outcome: outcome,
    }),
  );
  tenantLog.info("review_resolved", {
    attempt: shortId(attemptId),
    outcome,
    resolved: resolved === true,
  });
  return resolved === true;
}
