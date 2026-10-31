// סוג האתר (tenants.site_type) — עם מטמון קצר. כל תקלה (למשל שרת שעודכן לפני
// שהמיגרציה רצה ואין עדיין עמודה) → 'ecommerce': ההתנהגות הקיימת לא משתנה.
import { isSiteType, type SiteType } from "../engines/contract";
import { serviceHeaders, supabaseUrl } from "../supabase/env.server";

const TTL_MS = 15_000;
const FAILURE_TTL_MS = 5_000;
const cache = new Map<string, { type: SiteType; expires: number }>();

export async function siteTypeOf(
  tenantId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SiteType> {
  const hit = cache.get(tenantId);
  if (hit && hit.expires > Date.now()) return hit.type;
  let type: SiteType = "ecommerce";
  let ttl = TTL_MS;
  try {
    const res = await fetchImpl(
      `${supabaseUrl()}/rest/v1/tenants?id=eq.${encodeURIComponent(tenantId)}&select=site_type`,
      { headers: serviceHeaders() },
    );
    if (res.ok) {
      const rows = (await res.json()) as { site_type?: unknown }[];
      if (isSiteType(rows[0]?.site_type)) type = rows[0].site_type;
    } else {
      ttl = FAILURE_TTL_MS;
    }
  } catch {
    ttl = FAILURE_TTL_MS;
  }
  cache.set(tenantId, { type, expires: Date.now() + ttl });
  return type;
}

/** לבדיקות בלבד */
export function clearSiteTypeCache(): void {
  cache.clear();
}
