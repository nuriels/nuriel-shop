import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { StoreOnlinePaymentsView, StoreTerminalView } from "@/platform/payments/tenant-views";

/**
 * MAX/Hyp DEMO — the platform admin sets up a STORE's MAX terminal (CustomerFile "MAX" tab; tenant scope).
 *  getStoreOnlinePayments — status (has_* flags, last 2 digits), the "sent to Hyp, never returned" list, and the
 *                           success URL to paste in Hyp's portal
 *  saveStoreTerminal      — terminal number, API key and password (write-only: sealed at once, never shown again), on / off
 *  testStoreTerminal      — a free connection check (SIGN only; nothing is charged)
 * Platform host only, platform admins only (checked here, then again in the DB with the verified actor); POST +
 * CSRF; rate-limited per admin. The API key and password travel only in the save request's body.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tenantIdOf(value: unknown): string {
  const id = String(value ?? "").trim();
  if (!UUID.test(id)) throw new Error("החנות לא נמצאה");
  return id.toLowerCase();
}

const optionalText = (value: unknown, max: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text.length > max) throw new Error("ערך ארוך מדי");
  return text === "" ? undefined : text;
};
const optionalFlag = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

/** the platform host and a platform admin, before anything else (P-6a (5): online-payments.server.ts) */
async function requirePlatformAdmin(userId: string, limit: number): Promise<void> {
  const { requirePlatformTerminalAdmin } = await import("@/lib/online-payments.server");
  await requirePlatformTerminalAdmin(userId, limit);
}

export const getStoreOnlinePayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId: string }) => ({ tenantId: tenantIdOf(input?.tenantId) }))
  .handler(async ({ data, context }): Promise<StoreOnlinePaymentsView> => {
    const helpers = await import("@/lib/online-payments.server");
    try {
      await requirePlatformAdmin(context.userId, 120);
      const [{ storeTerminalStatus }, { storeUnreturnedAttempts }] = await Promise.all([
        import("@/platform/payments/server/tenant/owner"),
        import("@/platform/payments/server/tenant/admin"),
      ]);
      const [status, unreturned, store] = await Promise.all([
        storeTerminalStatus(context.userId, data.tenantId),
        storeUnreturnedAttempts(context.userId, data.tenantId),
        helpers.storeReturnAddress(data.tenantId),
      ]);
      return {
        status,
        unreturned,
        successUrl: store.successUrl,
        defaultStore: store.defaultStore,
      };
    } catch (error) {
      throw helpers.paymentFnError(error);
    }
  });

export const saveStoreTerminal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      tenantId: string;
      terminalNumber?: string;
      apiKey?: string;
      apiPassword?: string;
      enabled?: boolean;
      clearCredentials?: boolean;
      force?: boolean;
    }) => ({
      tenantId: tenantIdOf(input?.tenantId),
      terminalNumber: optionalText(input?.terminalNumber, 20),
      apiKey: optionalText(input?.apiKey, 256),
      apiPassword: optionalText(input?.apiPassword, 256),
      enabled: optionalFlag(input?.enabled),
      clearCredentials: optionalFlag(input?.clearCredentials),
      force: optionalFlag(input?.force),
    }),
  )
  .handler(async ({ data, context }): Promise<StoreTerminalView> => {
    const helpers = await import("@/lib/online-payments.server");
    try {
      await requirePlatformAdmin(context.userId, 20);
      const { saveStoreTerminal: save } = await import("@/platform/payments/server/tenant/admin");
      const { tenantId, ...input } = data;
      return await save(context.userId, tenantId, input);
    } catch (error) {
      throw helpers.paymentFnError(error);
    }
  });

export const testStoreTerminal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId: string }) => ({ tenantId: tenantIdOf(input?.tenantId) }))
  .handler(async ({ data, context }): Promise<{ ok: boolean; code: string | null }> => {
    const helpers = await import("@/lib/online-payments.server");
    try {
      await requirePlatformAdmin(context.userId, 20);
      const { testStoreTerminal: test } = await import("@/platform/payments/server/tenant/admin");
      return await test(context.userId, data.tenantId);
    } catch (error) {
      throw helpers.paymentFnError(error);
    }
  });
