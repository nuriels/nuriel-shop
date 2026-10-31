// האתר של הבקשה הנוכחית, בתצוגה הנייטרלית של החוזה (SiteRef).
// מתאם (adapter) לזיהוי החנות הקיים — המנועים לא נוגעים בו ישירות.
import type { SiteRef } from "../engines/contract";
import { siteTypeOf } from "./site-type.server";

export async function currentSite(): Promise<SiteRef | null> {
  const { maybeCurrentTenant, isPlatformRequest } =
    await import("@/integrations/supabase/tenant.server");
  if (isPlatformRequest()) return null;
  const tenant = maybeCurrentTenant();
  if (!tenant) return null;
  return { id: tenant.id, siteType: await siteTypeOf(tenant.id), status: tenant.status };
}
