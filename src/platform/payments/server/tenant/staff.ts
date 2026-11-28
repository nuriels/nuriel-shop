/**
 * Online payments, tenant scope — the store's staff on one order (the order panel). Server only. The DB authorizes
 * every call with the explicit store and actor: the view for the store's admins / agents and platform admins (with
 * the attempt id and the review reason, lead decision Q5); cancelling the live attempt (so the order can be edited;
 * a payment being verified is never cancelled) and closing a review for the store's admins.
 */
import { paymentsRpc } from "@/platform/payments/server/db";
import { paymentsEnv } from "@/platform/payments/server/env";
import type { OnlinePaymentView } from "@/platform/payments/tenant-views";
import { orderPaymentView } from "./checkout";
import { int, unwrap } from "./db";
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
  return orderPaymentView(unwrap("max_order_payment_status", answer), paymentsEnv() === "demo");
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

export async function resolveOrderReview(
  actorId: string,
  tenantId: string,
  attemptId: string,
  note: string | null,
): Promise<boolean> {
  const resolved = unwrap(
    "max_review_resolve",
    await paymentsRpc("max_review_resolve", {
      _actor: actorId,
      _tenant: tenantId,
      _attempt: attemptId,
      _note: note,
    }),
  );
  tenantLog.info("review_resolved", { attempt: shortId(attemptId), resolved: resolved === true });
  return resolved === true;
}
