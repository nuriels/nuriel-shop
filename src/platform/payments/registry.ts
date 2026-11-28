/**
 * Online payments — the provider registry (pure: no I/O, no secrets). DEMO has exactly one provider,
 * `max` (Hyp Pay hosted payment page), with every optional capability off.
 */
import type { Capabilities, ProviderId } from "@/platform/payments/provider";

const MAX_CAPABILITIES: Capabilities = Object.freeze({
  hostedPage: true,
  threeDS: false,
  refunds: false,
  tokens: false,
});

export const PROVIDERS: Readonly<Record<ProviderId, Capabilities>> = Object.freeze({
  max: MAX_CAPABILITIES,
});

/** For route parameters such as `/payments/return/$provider`: only a registered id passes. */
export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PROVIDERS, value);
}
