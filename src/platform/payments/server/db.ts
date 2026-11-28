/**
 * Online payments (MAX/Hyp DEMO) — the one service-role adapter of the payments code (server only).
 *
 * A platform adapter (tests/architecture/boundaries.test.ts, PLATFORM_ADAPTERS) around the existing unscoped
 * service-role client of src/integrations/supabase/client.server — never the store-scoped `supabaseAdmin`:
 * no request tenant and no x-tenant-id reach the DB (U17-B5). Every migration-208 function takes the store, the
 * actor or the attempt explicitly (contract §5), and checks them itself.
 *
 * • paymentsRpc(fn, args): only migration 208's public functions (a type and a runtime allow-list), typed by
 *   src/integrations/supabase/types.ts. Answers { data, error } and never throws; error = { message, code }
 *   (the DB's RAISE text and SQLSTATE) for the scope modules to map to fixed Hebrew and to log redacted.
 * • stepupRpc: the injected DB caller of createStepupService (contract §4: "wired to supabaseAdminUnscoped.rpc").
 * • accountEmail(userId): the sign-in e-mail of one account (the platform terminal's step-up code goes there).
 * Nothing here logs, caches or keeps state (U17-B8).
 */
import { supabaseAdminUnscoped } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import type { StepupRpc } from "./stepup";

type Functions = Database["public"]["Functions"];

/** the payments API of migration 208 (contract §5) — no other public function is reachable through here */
export type PaymentsFn = Extract<
  keyof Functions,
  | `max_${string}`
  | `platform_attempt${string}`
  | `platform_card_${string}`
  | `platform_terminal_${string}`
  | `platform_stepup_${string}`
  | `platform_return_${string}`
  | `platform_store_terminal_${string}`
  | "platform_unreturned_attempts"
  | "platform_payment_unknown_return"
  | "platform_payment_returns_purge"
>;

const PAYMENTS_FN =
  /^(?:max_[a-z][a-z0-9_]*|platform_(?:attempts?_[a-z0-9_]+|card_[a-z0-9_]+|terminal_[a-z0-9_]+|stepup_[a-z0-9_]+|return_[a-z0-9_]+|store_terminal_[a-z0-9_]+|unreturned_attempts|payment_unknown_return|payment_returns_purge))$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PaymentsDbError = { message: string; code: string | null };
export type PaymentsRpcResult<T> = { data: T | null; error: PaymentsDbError | null };

type ArgsOf<F extends PaymentsFn> = Functions[F]["Args"];
type ReturnsOf<F extends PaymentsFn> = Functions[F]["Returns"];

/** the client's rpc without its generic overloads: the typing is this module's signature */
type LooseRpc = {
  rpc(
    fn: string,
    args?: object,
  ): PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
};

async function call(fn: string, args: object | undefined): Promise<PaymentsRpcResult<unknown>> {
  if (!PAYMENTS_FN.test(fn)) {
    return { data: null, error: { message: "payments: function not allowed", code: null } };
  }
  try {
    // a method call on the proxy (keeps `this`); the unscoped client sends no store header
    const { data, error } = await (supabaseAdminUnscoped as unknown as LooseRpc).rpc(fn, args);
    if (error) {
      return {
        data: null,
        error: {
          message: String(error.message ?? "").slice(0, 300),
          code: typeof error.code === "string" ? error.code : null,
        },
      };
    }
    return { data: data ?? null, error: null };
  } catch {
    return { data: null, error: { message: "payments: database unavailable", code: null } };
  }
}

/** One migration-208 function through the service role. Functions without arguments take none. */
export async function paymentsRpc<F extends PaymentsFn>(
  fn: F,
  ...args: [ArgsOf<F>] extends [never] ? [] : [ArgsOf<F>]
): Promise<PaymentsRpcResult<ReturnsOf<F>>> {
  return (await call(fn, args[0] as object | undefined)) as PaymentsRpcResult<ReturnsOf<F>>;
}

/** createStepupService's DB caller (the function names stay in stepup.ts: U17-B4) */
export const stepupRpc: StepupRpc = (fn, args) => call(fn, args);

/** The account's sign-in e-mail (lower case), or null when there is none or it cannot be read. */
export async function accountEmail(userId: string): Promise<string | null> {
  if (typeof userId !== "string" || !UUID.test(userId)) return null;
  try {
    const { data, error } = await supabaseAdminUnscoped.auth.admin.getUserById(userId);
    const email = error ? null : data.user?.email;
    return typeof email === "string" && email.includes("@") ? email.trim().toLowerCase() : null;
  } catch {
    return null;
  }
}
