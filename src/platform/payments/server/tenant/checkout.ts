/**
 * Online payments, tenant scope — the store checkout: availability, the guest's one-time capability token, the start
 * of a payment (open → secrets → SIGN → signed) and the order's payment status. Server only.
 *
 * The store is always passed in (the caller takes it from the request's host, never from input) and goes to the DB
 * explicitly. The amount, the reference and the terminal come from the DB (max_attempt_open), never from a browser.
 * SIGN goes to hypEndpoint() (the fixed Hyp address unless the guarded local mock applies, DM-ENV-7) through the one
 * HTTP client; the credentials exist only inside startTenantPayment for that request.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  buildSignParams,
  encodeParams,
  validateSignResponse,
  type SignResult,
} from "@/platform/payments/max/protocol";
import { PAYMENT_MESSAGES } from "@/platform/payments/max/messages";
import { paymentsRpc } from "@/platform/payments/server/db";
import {
  hypEndpoint,
  isTestEnv,
  modeAllowed,
  paymentsReady,
  terminalAllowed,
  testPaymentsEnv,
} from "@/platform/payments/server/env";
import { hypRequest } from "@/platform/payments/server/http";
import {
  DEMO_MAX_AMOUNT_MINOR,
  attemptStateOf,
  type OnlinePaymentOptions,
  type OnlinePaymentView,
} from "@/platform/payments/tenant-views";
import { signCredentials } from "./credentials";
import {
  TenantPaymentError,
  UNAVAILABLE,
  asRecord,
  bool,
  int,
  reference,
  str,
  unwrap,
  uuid,
} from "./db";
import { shortId, tenantLog } from "./log";

export const SIGN_FAILED = "לא ניתן לפתוח את דף התשלום כרגע. אפשר לנסות שוב בעוד כמה דקות.";
export const ORDER_NOT_FOUND = "ההזמנה לא נמצאה";

export const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** a guest's capability token: 32 random bytes, base64url (43 characters); the DB keeps its SHA-256 only */
export const GUEST_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export async function tenantPaymentOptions(
  tenantId: string,
  actorId: string | null,
): Promise<OnlinePaymentOptions> {
  const ready = paymentsReady("tenant");
  if (!ready.ok) return { available: false, demo: false, maxAmountMinor: null };
  const answer = await paymentsRpc("max_payments_active", { _tenant: tenantId, _actor: actorId });
  const available = answer.error === null && answer.data === true;
  // P-4: a viewer who is not offered the payment gets no hint of a test environment either
  if (!available) return { available: false, demo: false, maxAmountMinor: null };
  const demo = isTestEnv(ready.env);
  return {
    available,
    demo,
    // DEMO and the pilot = test mode only, and the DB refuses a test payment above ₪50 (L9: never offered above it)
    maxAmountMinor: demo ? DEMO_MAX_AMOUNT_MINOR : null,
  };
}

/**
 * After place_guest_order created an online order: the token that lets this browser (and nobody with the order id
 * alone) start the payment and see its status (decision 11). null when it could not be stored.
 */
export async function issueGuestPaymentToken(
  tenantId: string,
  orderId: string,
): Promise<string | null> {
  const token = randomBytes(32).toString("base64url");
  const answer = await paymentsRpc("max_order_access_issue", {
    _tenant: tenantId,
    _order: orderId,
    _token_sha256: sha256Hex(token),
  });
  if (answer.error || answer.data !== true) {
    tenantLog.warn("guest_token_not_issued", { code: answer.error?.code ?? "exists" });
    return null;
  }
  return token;
}

export interface StartTenantPaymentInput {
  tenantId: string;
  orderId: string;
  /** the signed-in customer, or null for a guest */
  customerId: string | null;
  /** the guest's token, when this browser holds one */
  guestToken: string | null;
  /**
   * optional prefill of Hyp's page (DEMO: synthetic customers only), loaded only after the DB opened the attempt
   * (= authorized this viewer for this order)
   */
  loadClient?: () => Promise<SignClient | undefined>;
}

export type SignClient = { firstName?: string; lastName?: string; email?: string; cell?: string };

/** Opens (or reuses) the order's attempt and signs Hyp's page. → the URL the browser opens. */
export async function startTenantPayment(
  input: StartTenantPaymentInput,
): Promise<{ url: string; demo: boolean }> {
  const ready = paymentsReady("tenant");
  if (!ready.ok) {
    tenantLog.warn("start_refused", { why: ready.reason });
    throw new TenantPaymentError(UNAVAILABLE, "unavailable");
  }
  const env = ready.env;
  // a guest order is proven by its token (also when the guest signed in meanwhile); the DB decides by the order
  const guestSha =
    input.guestToken && GUEST_TOKEN.test(input.guestToken) ? sha256Hex(input.guestToken) : null;
  if (input.customerId === null && guestSha === null) throw new TenantPaymentError(ORDER_NOT_FOUND);

  const openAnswer = await paymentsRpc("max_attempt_open", {
    _tenant: input.tenantId,
    _order: input.orderId,
    _customer: input.customerId,
    _guest_token_sha256: guestSha,
    _app_environment: env,
  });
  // X-15: the order is busy — a return of it is being verified or is in review. The payer sees the fixed "pending"
  // / "in review" text (the pay page shows no Pay button for these), never a retry
  if (openAnswer.error && /is being reviewed/i.test(openAnswer.error.message))
    throw new TenantPaymentError(PAYMENT_MESSAGES.needs_review);
  if (openAnswer.error && /is being verified/i.test(openAnswer.error.message))
    throw new TenantPaymentError(PAYMENT_MESSAGES.verification_pending);
  const opened = asRecord(unwrap("max_attempt_open", openAnswer));
  const attemptId = uuid(opened?.["attempt_id"]);
  const order = reference(opened?.["reference"]);
  const amountMinor = int(opened?.["amount_minor"]);
  if (!attemptId || !order || amountMinor === null || amountMinor <= 0) {
    tenantLog.error("open_unreadable");
    throw new TenantPaymentError(UNAVAILABLE, "unavailable");
  }

  let creds;
  let mode;
  try {
    ({ creds, mode } = await signCredentials(env, input.tenantId, attemptId));
  } catch (error) {
    // a payer never sees a terminal-credentials problem (payerMessageKey): it reads "unavailable"
    if (error instanceof TenantPaymentError && error.kind === "credentials")
      throw new TenantPaymentError(UNAVAILABLE, "unavailable");
    throw error;
  }
  // tripwires (never proof; the DB enforces): the attempt's own terminal, the environment's prefix and mode
  // (DM-ENV-3) — as on the platform side (L8)
  if (
    creds.masof !== str(opened?.["terminal_number"]) ||
    !terminalAllowed(env, creds.masof) ||
    !modeAllowed(env, mode)
  ) {
    await paymentsRpc("max_attempt_signed", {
      _tenant: input.tenantId,
      _attempt: attemptId,
      _ok: false,
      _code: null,
    });
    tenantLog.alert("terminal_not_allowed", { attempt: shortId(attemptId), mode });
    throw new TenantPaymentError(UNAVAILABLE, "unavailable");
  }
  const endpoint = hypEndpoint();
  let sign: SignResult | { ok: false; code: string; ccode?: string };
  try {
    const client = input.loadClient ? await input.loadClient().catch(() => undefined) : undefined;
    const pairs = buildSignParams(creds, {
      amountMinor,
      order,
      moreData: true,
      ...(client ? { client } : {}),
    });
    const http = await hypRequest(endpoint, encodeParams(pairs), { method: "GET" });
    sign = http.ok
      ? validateSignResponse(
          http.body,
          { masof: creds.masof, amountMinor, order, moreData: true },
          endpoint,
        )
      : { ok: false, code: http.error };
  } catch {
    // a builder refused its input (MaxProtocolInputError: a configuration problem, never a value in the text)
    sign = { ok: false, code: "input" };
  }

  const ccode = !sign.ok && "ccode" in sign && typeof sign.ccode === "string" ? sign.ccode : null;
  await paymentsRpc("max_attempt_signed", {
    _tenant: input.tenantId,
    _attempt: attemptId,
    _ok: sign.ok,
    _code: ccode,
  });
  tenantLog.info("sign", {
    attempt: shortId(attemptId),
    ok: sign.ok,
    code: sign.ok ? null : sign.code,
    ccode,
    reused: bool(opened?.["reused"]),
  });
  if (!sign.ok) {
    if (ccode === "901" || ccode === "902")
      tenantLog.alert("terminal_credentials_refused", { ccode });
    throw new TenantPaymentError(SIGN_FAILED, "unavailable");
  }
  return { url: sign.payUrl, demo: isTestEnv(env) };
}

/** max_order_payment_status → the view (null when this viewer may not see the order) */
export function orderPaymentView(data: unknown, demo: boolean): OnlinePaymentView | null {
  const r = asRecord(data);
  if (!r) return null;
  const a = asRecord(r["attempt"]);
  const paymentStatus = str(r["payment_status"]);
  const paymentDueAt = str(r["payment_due_at"]);
  // X-25: staff get the decision and its time (on the attempt, or next to it); X-22 clears both on a reopen
  const outcome = str(a?.["review_outcome"]) ?? str(r["review_outcome"]);
  const resolvedAt = str(a?.["review_resolved_at"]) ?? str(r["review_resolved_at"]);
  return {
    demo,
    orderNumber: str(r["order_number"]),
    orderStatus: str(r["status"]),
    paymentMethod: str(r["payment_method"]),
    paymentStatus,
    paymentDueAt,
    // the DB's own word when it gives one (payable / busy / held); otherwise an awaiting online order with an
    // attempt and no due time is held (X-14: payment_due_at := NULL at the first recorded return)
    held:
      r["payment_held"] === true ||
      r["payable"] === false ||
      r["busy"] === true ||
      r["held"] === true ||
      (r["payable"] !== true &&
        paymentStatus === "awaiting" &&
        paymentDueAt === null &&
        a !== null &&
        str(r["status"]) !== "cancelled"),
    attempt: a
      ? {
          id: uuid(a["attempt_id"] ?? a["id"]),
          state: attemptStateOf(a["state"]),
          test: a["mode"] === "test",
          amountMinor: int(a["amount_minor"]),
          paidAt: str(a["paid_at"]),
          installments: int(a["installments"]),
          cardBrand: str(a["card_brand"]),
          cardLast4:
            typeof a["card_last4"] === "string" && /^[0-9]{4}$/.test(a["card_last4"])
              ? a["card_last4"]
              : null,
          approvalCode: str(a["approval_code"]),
          reviewReason: str(a["review_reason"]),
          reviewOutcome: outcome === "not_charged" || outcome === "charged" ? outcome : null,
          reviewResolvedAt: resolvedAt,
          // X-22: the DB's reopen marker, or the reason it sets for a charge after a decision
          reviewReopened:
            a["review_reopened"] === true ||
            str(a["review_reopened_at"]) !== null ||
            str(a["review_reason"]) === "charge_after_resolution",
        }
      : null,
  };
}

/**
 * The customer's view of one order's payment: the signed-in customer, or the holder of the guest token. The DB
 * authorizes the viewer and answers NULL to anyone else; the attempt id and review reason are never sent to a customer.
 */
export async function customerOrderPayment(input: {
  tenantId: string;
  orderId: string;
  customerId: string | null;
  guestToken: string | null;
}): Promise<OnlinePaymentView | null> {
  // a guest order is proven by its token (also when the guest signed in meanwhile); the DB decides by the order
  const guestSha =
    input.guestToken && GUEST_TOKEN.test(input.guestToken) ? sha256Hex(input.guestToken) : null;
  if (input.customerId === null && guestSha === null) return null;
  const answer = await paymentsRpc("max_order_payment_status", {
    _tenant: input.tenantId,
    _order: input.orderId,
    _viewer: input.customerId,
    _guest_token_sha256: guestSha,
  });
  if (answer.error) {
    tenantLog.warn("status_failed", { code: answer.error.code });
    return null;
  }
  const view = orderPaymentView(answer.data, testPaymentsEnv());
  if (view?.attempt)
    view.attempt = {
      ...view.attempt,
      id: null,
      reviewReason: null,
      reviewOutcome: null,
      reviewResolvedAt: null,
      reviewReopened: false,
    };
  return view;
}
