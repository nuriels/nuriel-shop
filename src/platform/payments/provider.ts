/**
 * Online payments (MAX/Hyp DEMO) — shared, provider-neutral types. Pure: types only, no runtime code,
 * no I/O, no secrets. Contract: docs/payment-gateways/DEMO-IMPLEMENTATION-CONTRACT.md §4.
 */

/** Who receives the money: NURIEL itself (`platform`) or a store (`tenant`). Never mixed, no fallback. */
export type PaymentScope = "platform" | "tenant";

/** Terminal mode. DEMO: `test` only (terminal `00100…`); production: `live` only. Decided by our account record, never by a Hyp response. */
export type PaymentMode = "test" | "live";

export type ProviderId = "max";

/** Integer agorot (ILS minor units), > 0. Never a float. */
export type MinorAmount = number;

/**
 * One account's terminal credentials. Decrypted in memory for a single call; never logged, never kept in
 * module state, never sent to the browser.
 */
export interface MaxCredentials {
  masof: string;
  key: string;
  passp: string;
}

export interface SignInput {
  /** Integer agorot, > 0. */
  amountMinor: MinorAmount;
  /** The attempt reference sent as `Order` (32 lowercase hex). */
  order: string;
  /** DEMO: true (owner decision 8 — needed to check `Coin` and `Payments` on the return). */
  moreData: boolean;
  /** Optional prefill on Hyp's page. DEMO: synthetic data only. */
  client?: { firstName?: string; lastName?: string; email?: string; cell?: string };
}

/**
 * Return markers that block "paid" and send the attempt to review:
 * - `document`: `Hesh`/`HeshASM` non-empty and not `0` (Hyp may have issued a tax document; decision ה-6);
 * - `hk`: `HKId` present (a recurring agreement was created);
 * - `multi`: `MULTI` present (gift cards: several transactions behind one return).
 */
export type ReturnFlag = "document" | "hk" | "multi";

/**
 * What a provider integration can do. DEMO is the one-time hosted-page payment only.
 * Each `false` is a deliberate extension point: turning one on means changing this type, so it cannot
 * happen by configuration alone.
 * - `threeDS`: 3-D Secure. Not implemented and not configured (Hyp: "3DS is only available on production
 *   terminals"); no SMS/OTP mechanism exists here.
 * - `refunds`: refunds and cancellations (designed in evidence 01 §2, not built).
 * - `tokens`: saved cards, tokens and recurring charges (not built).
 */
export interface Capabilities {
  hostedPage: true;
  threeDS: false;
  refunds: false;
  tokens: false;
}
