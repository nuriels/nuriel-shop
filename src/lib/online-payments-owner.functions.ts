import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { StoreTerminalView } from "@/platform/payments/tenant-views";

/**
 * MAX/Hyp DEMO — the store owner's status card for online card payments (tenant scope): connected or not, mode,
 * the last 2 digits of the terminal, last check. No secrets, and nothing to change in DEMO (one payment only; the
 * terminal itself is set up by NURIEL's platform admins). The DB answers only the store's owner or a platform admin.
 */
export const getOnlinePaymentSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StoreTerminalView> => {
    const helpers = await import("@/lib/online-payments.server");
    try {
      const { allowAction } = await import("@/lib/rate-limit.server");
      if (!allowAction(`pay-owner:${context.userId}`, 60, 15 * 60 * 1000))
        throw new Error("יותר מדי ניסיונות. אפשר לנסות שוב בעוד כמה דקות.");
      const tenantId = await helpers.hostStoreId();
      if (!tenantId) throw new Error("החנות לא זוהתה");
      const { storeTerminalStatus } = await import("@/platform/payments/server/tenant/owner");
      return await storeTerminalStatus(context.userId, tenantId);
    } catch (error) {
      throw helpers.paymentFnError(error);
    }
  });
