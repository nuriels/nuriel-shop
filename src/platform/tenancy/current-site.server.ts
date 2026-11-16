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

/**
 * הבקשה הגיעה לכתובת פאנל הפלטפורמה (PLATFORM_ADMIN_HOST) — לפי הכתובת עצמה. "אין אתר" (currentSite
 * מחזיר null) אינו אותו דבר: גם בקשה בלי אתר מזוהה בכתובת של עסק מחזירה null.
 */
export async function isPlatformHost(): Promise<boolean> {
  const { isPlatformRequest } = await import("@/integrations/supabase/tenant.server");
  return isPlatformRequest();
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

/**
 * Billing & Agreements (מיגרציה 189): אחרי החלפת חבילה או חידוש תקופה — המטמון של האתר (המנוי שנטען
 * לבקשות) מתנקה, כדי שהנעילה / הפתיחה / המגבלות יחולו מיד ולא רק אחרי 15 שניות
 */
export async function invalidateSiteCache(siteId: string): Promise<void> {
  const { invalidateTenantCache } = await import("@/integrations/supabase/tenant.server");
  invalidateTenantCache(siteId);
}

/**
 * מיגרציה 197 (כתובת האתר): הכתובות של האתר של הבקשה — הכתובת שאליה הגיעה הבקשה, תת-הדומיין בפלטפורמה
 * (הניהול תמיד בו), הכתובת הקנונית (דומיין אישי פעיל עם SSL, אחרת תת-הדומיין) והדומיין האישי אם חובר.
 * מרשומת האתר במסד; הכתובת של הבקשה — רק כדי להשוות אליה.
 */
export async function currentSiteHosts(): Promise<{
  requestHost: string | null;
  slugHost: string | null;
  canonicalOrigin: string | null;
  customDomain: string | null;
} | null> {
  const { maybeCurrentTenant, originForTenant, tenantBaseDomain, currentRequestHost } =
    await import("@/integrations/supabase/tenant.server");
  const tenant = maybeCurrentTenant();
  if (!tenant) return null;
  const base = tenantBaseDomain();
  let canonicalOrigin: string | null = null;
  try {
    canonicalOrigin = originForTenant(tenant);
  } catch {
    canonicalOrigin = null;
  }
  return {
    requestHost: currentRequestHost(),
    slugHost: base ? `${tenant.slug}.${base}` : null,
    canonicalOrigin,
    customDomain: tenant.custom_domain,
  };
}

/** הכתובות של אתר מהשורה שלו (לפאנל הפלטפורמה): הכתובת הציבורית (קנונית) והכתובת בפלטפורמה */
export async function siteAddressesOf(site: {
  slug: string;
  custom_domain: string | null;
  custom_domain_status: string | null;
}): Promise<{ publicOrigin: string | null; slugOrigin: string | null; baseDomain: string | null }> {
  const { originForTenant, slugOriginForTenant, tenantBaseDomain } =
    await import("@/integrations/supabase/tenant.server");
  const safe = (fn: () => string) => {
    try {
      return fn();
    } catch {
      return null;
    }
  };
  const row = { ...site, domain: null, is_default: false };
  return {
    publicOrigin: safe(() => originForTenant(row)),
    slugOrigin: safe(() => slugOriginForTenant(row)),
    baseDomain: tenantBaseDomain(),
  };
}
