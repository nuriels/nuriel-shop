// דגלי פיצ'רים (plan B5): public.platform_feature_enabled(key, tenant) — פעיל
// בפלטפורמה וגם לאתר. מטמון 15 שניות; כל תקלה → כבוי. הדגלים לא נשלחים לדפדפן.
import { serviceHeaders, supabaseUrl } from "../supabase/env.server";

const TTL_MS = 15_000;
const cache = new Map<string, { on: boolean; expires: number }>();

export async function featureEnabled(
  key: string,
  tenantId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const cacheKey = `${tenantId}:${key}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) return hit.on;
  let on = false;
  try {
    const res = await fetchImpl(`${supabaseUrl()}/rest/v1/rpc/platform_feature_enabled`, {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({ _key: key, _tenant_id: tenantId }),
    });
    on = res.ok && (await res.json()) === true;
  } catch {
    on = false;
  }
  cache.set(cacheKey, { on, expires: Date.now() + TTL_MS });
  return on;
}

/** לבדיקות בלבד */
export function clearFeatureFlagCache(): void {
  cache.clear();
}
