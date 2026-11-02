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

/** הכתובת הציבורית של אתר (דומיין משלו, או <slug>.<הדומיין של הפלטפורמה>); null — לא הוגדר */
export async function siteOrigin(site: {
  slug: string;
  domain: string | null;
}): Promise<string | null> {
  const { originForTenant } = await import("@/integrations/supabase/tenant.server");
  try {
    return originForTenant({ slug: site.slug, domain: site.domain, is_default: false });
  } catch {
    return null;
  }
}

/** הדומיין של אתרי הפלטפורמה (TENANT_BASE_DOMAIN) — לתצוגת הכתובת בטופס פתיחת אתר */
export async function sitesBaseDomain(): Promise<string | null> {
  const { tenantBaseDomain } = await import("@/integrations/supabase/tenant.server");
  return tenantBaseDomain();
}

/**
 * הכתובות של האתר של הבקשה הנוכחית (לכתובת קנונית ולמפת אתר): הראשית — הדומיין של האתר אם
 * יש (כמו בקישורים במיילים), ותת-הדומיין בפלטפורמה. מרשומת האתר במסד, לא מכותרות הבקשה.
 */
export async function currentSiteAddresses(): Promise<{
  primary: string | null;
  subdomain: string | null;
}> {
  const { maybeCurrentTenant, originForTenant, tenantBaseDomain } =
    await import("@/integrations/supabase/tenant.server");
  const tenant = maybeCurrentTenant();
  if (!tenant) return { primary: null, subdomain: null };
  let primary: string | null = null;
  try {
    primary = originForTenant(tenant);
  } catch {
    primary = null;
  }
  const base = tenantBaseDomain();
  return { primary, subdomain: base ? `https://${tenant.slug}.${base}` : null };
}
