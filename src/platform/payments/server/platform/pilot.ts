/**
 * Online payments, platform scope — the ONE place that decides "platform payments are off because this server runs
 * the production pilot" (contract §7.2 P-5; server only).
 *
 * In the pilot (PAYMENTS_ENV=pilot: DEMO payments on the live site, one store only) NURIEL's own terminal stays off:
 * every platform entry point — paying a charge, the return route, the jobs' VERIFY, the terminal screen and its
 * server functions — asks platformPilotOff() FIRST, before any DB or Hyp call, and refuses with the fixed "soon"
 * text. The DB refuses the same things on its side (P-5). tests/architecture/platform-pilot-gate.test.ts pins that
 * every entry point goes through here.
 *
 * The environment comes from paymentsEnv() (server/env.ts, owned by the store-side agent). Until its type gains
 * "pilot" the comparison is on the plain string it returns, so this file needs no change when it does.
 */
import { paymentsEnv } from "@/platform/payments/server/env";

/** the marker value of the production pilot (P-7) */
export const PILOT_ENV = "pilot";

/** P-5: true ⇔ platform payments are off because this server runs the pilot (a reader may be injected by tests) */
export function platformPilotOff(readEnv: () => string | null = paymentsEnv): boolean {
  let env: string | null = null;
  try {
    env = readEnv();
  } catch {
    env = null; // unreadable environment: not the pilot (payments are then off for their own reason)
  }
  return env === PILOT_ENV;
}
