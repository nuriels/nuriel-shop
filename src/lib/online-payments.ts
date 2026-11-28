/**
 * Online payments (MAX/Hyp DEMO), tenant scope — browser helpers of the checkout. Browser-safe: no protocol names,
 * no server code (contract §7 X-7).
 *
 * A guest's payment token (decision 11) is kept for this tab only (sessionStorage, per store origin): it lets this
 * browser start the payment and see its result after Hyp sends it back, and nobody with the order id alone. It is
 * not a card or terminal secret; it expires with the order.
 */

export const ORDER_ID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 32 random bytes, base64url */
export const GUEST_PAYMENT_TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

const KEY_PREFIX = "nuriel.online-payment.";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function rememberGuestPaymentToken(orderId: string, token: string): void {
  if (!ORDER_ID_FORMAT.test(orderId) || !GUEST_PAYMENT_TOKEN_FORMAT.test(token)) return;
  try {
    storage()?.setItem(`${KEY_PREFIX}${orderId.toLowerCase()}`, token);
  } catch {
    // storage full / blocked: the guest still pays now; only the result page after the return needs the token
  }
}

export function guestPaymentToken(orderId: string): string | null {
  try {
    const value = storage()?.getItem(`${KEY_PREFIX}${orderId.toLowerCase()}`) ?? null;
    return value !== null && GUEST_PAYMENT_TOKEN_FORMAT.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function forgetGuestPaymentToken(orderId: string): void {
  try {
    storage()?.removeItem(`${KEY_PREFIX}${orderId.toLowerCase()}`);
  } catch {
    // nothing to do
  }
}
