import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * חלק 25: "שלח בקשת שדרוג" — הבקשה נוצרת במסד (request_extra_admin, בהרשאות מנהל
 * החנות), ואז מייל למנהלי הפלטפורמה (פעם אחת לכל בקשה). כישלון המייל לא מבטל את הבקשה.
 */
export const requestExtraAdminWithNotify = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // חלק 33: שדרוג החבילה (מקום למנהל נוסף) — בעל החנות בלבד (גם המסד אוכף)
    const { requireStaffPermission } = await import("@/lib/caller.server");
    await requireStaffPermission(
      context.userId,
      "billing.manage",
      "רק בעל החנות יכול לשנות את החבילה או לרכוש תוספים",
    );
    const { data, error } = await context.supabase.rpc("request_extra_admin");
    if (error) throw new Error(error.message);
    const request = data as unknown as { id: string; status: string };
    let notified = false;
    try {
      const { maybeCurrentTenant } = await import("@/integrations/supabase/tenant.server");
      const tenant = maybeCurrentTenant();
      if (tenant && request?.id) {
        const { notifyPlatformOfUpgradeRequest } = await import("@/lib/admin-seats.server");
        const { data: me } = await context.supabase.auth.getUser();
        notified = await notifyPlatformOfUpgradeRequest({
          requestId: request.id,
          tenantId: tenant.id,
          requestedBy: me?.user?.email ?? null,
        });
      }
    } catch (notifyError) {
      console.error("[upgrades] notify failed", notifyError);
    }
    return { requestId: request?.id ?? null, notified };
  });
