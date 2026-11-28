// Online payments, platform scope — the store owner's server functions ("המנוי שלי", on the store's own host).
// Thin: an input check, then the orchestrator in src/platform/payments/server/platform/pay.ts, reached only by a
// dynamic import inside the handler (U17-B11; Vite keeps server/ out of the browser bundle). The types below are
// the only shapes the browser sees: no credential, ciphertext, raw return, signature or full terminal number.
// Errors: the payment code's fixed Hebrew texts, or one generic text — never a stack or a DB detail.
import { createServerFn } from "@tanstack/react-start";

export interface PayCharge {
  id: string;
  no: number | null;
  amountMinor: number;
  description: string | null;
  occurredOn: string | null;
  /** online payment is open for this charge now (the DB: available, balance, test cap, not paid yet) */
  payable: boolean;
  paidOnline: boolean;
}

export interface PayOptions {
  /** NURIEL's terminal is on, this server is ready, and the caller is this store's owner (never a platform admin) */
  available: boolean;
  /** NURIEL's terminal is a test terminal (DEMO) */
  test: boolean;
  demo: boolean;
  testCapMinor: number | null;
  charges: PayCharge[];
}

export type MyCardPaymentState =
  "in_progress" | "paid" | "test_paid" | "needs_review" | "failed" | "expired" | "cancelled";

export interface MyCardPayment {
  id: string;
  targetId: string | null;
  targetLabel: string | null;
  amountMinor: number;
  state: MyCardPaymentState;
  test: boolean;
  cardBrand: string | null;
  cardLast4: string | null;
  approvalCode: string | null;
  createdAt: string | null;
  paidAt: string | null;
}

export interface PayStartResult {
  /** the signed Hyp payment-page URL — the browser opens it (the only Hyp data that leaves the server) */
  url: string;
  demo: boolean;
}

/**
 * What the section offers for one charge (review H2; pure, no server code). The Pay button only when the DB says the
 * charge is payable — the DB keeps it unpayable while a payment for it is in review or being verified. A charge that
 * is not payable and whose latest card payment (the list is newest first) is in review or still in progress gets the
 * fixed note "התשלום בבדיקה" instead; any other charge that is not payable is not listed (as before).
 */
export function payChargeOffer(
  charge: PayCharge,
  payments: readonly MyCardPayment[],
): "pay" | "checking" | null {
  if (charge.payable) return "pay";
  const latest = payments.find((payment) => payment.targetId === charge.id);
  return latest?.state === "needs_review" || latest?.state === "in_progress" ? "checking" : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const pay = () => import("@/platform/payments/server/platform/pay");

/** lets out only the payment code's own error (fixed Hebrew text, no stack) or a generic one */
async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const { toPlatformError } = await import("@/platform/payments/server/platform/db");
    throw toPlatformError(error);
  }
}

/** what the owner can pay online now (the button appears only when `available`) */
export const myBillingPayOptions = createServerFn({ method: "POST" }).handler(
  async (): Promise<PayOptions> => guarded(async () => (await pay()).platformPayOptions()),
);

/** the owner's card payments to NURIEL (also the result after the return from the payment page) */
export const myBillingPayments = createServerFn({ method: "POST" }).handler(
  async (): Promise<MyCardPayment[]> => guarded(async () => (await pay()).myPlatformPayments()),
);

/** opens a payment of one open charge: only its id travels (the amount comes from the DB, DM-PLAT-2) */
export const myBillingPayStart = createServerFn({ method: "POST" })
  .inputValidator((input: { chargeId: string }) => {
    const chargeId = String(input?.chargeId ?? "")
      .trim()
      .toLowerCase();
    if (!UUID.test(chargeId)) throw new Error("החיוב לא נמצא");
    return { chargeId };
  })
  .handler(async ({ data }): Promise<PayStartResult> =>
    guarded(async () => (await pay()).startPlatformPayment({ chargeId: data.chargeId })),
  );
