// זיהוי החנות (tenant) של כל בקשה לשרת — לפי הדומיין שממנו היא הגיעה.
// server.ts מריץ כל בקשה בתוך runWithTenant, וכל קוד שרת (כולל
// supabaseAdmin) קורא ממנו את החנות הנוכחית בלי להעביר אותה כפרמטר.
import { AsyncLocalStorage } from "node:async_hooks";

export type Tenant = {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  is_default: boolean;
};

type TenantContext = { host: string; tenant: Tenant | null };

const storage = new AsyncLocalStorage<TenantContext>();
const cache = new Map<string, { tenant: Tenant | null; expires: number }>();
const CACHE_TTL_MS = 60_000;

function serviceEnv() {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) {
    throw new Error(
      "Missing Supabase environment variable(s): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return { url: url.replace(/\/$/, ""), key };
}

function serviceHeaders(key: string): Record<string, string> {
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  // מפתחות sb_secret_ החדשים אינם JWT ולא נשלחים כ-Bearer
  if (!key.startsWith("sb_secret_")) headers["Authorization"] = `Bearer ${key}`;
  return headers;
}

/** הדומיין של הבקשה בלי פורט, באותיות קטנות */
export function requestHost(request: Request): string {
  const raw =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    new URL(request.url).host;
  return (raw.split(",")[0] ?? "").trim().toLowerCase().replace(/:\d+$/, "");
}

/** דומיין ← חנות (public.tenant_for_host), עם מטמון קצר בזיכרון */
export async function resolveTenant(host: string): Promise<Tenant | null> {
  const hit = cache.get(host);
  if (hit && hit.expires > Date.now()) return hit.tenant;

  const { url, key } = serviceEnv();
  const headers = serviceHeaders(key);
  const idRes = await fetch(`${url}/rest/v1/rpc/tenant_for_host`, {
    method: "POST",
    headers,
    body: JSON.stringify({ _host: host }),
  });
  if (!idRes.ok) throw new Error(`tenant lookup failed (HTTP ${idRes.status})`);
  const id = (await idRes.json()) as string | null;

  let tenant: Tenant | null = null;
  if (id) {
    const rowRes = await fetch(
      `${url}/rest/v1/tenants?id=eq.${encodeURIComponent(id)}&select=id,slug,name,domain,is_default`,
      { headers },
    );
    if (!rowRes.ok) throw new Error(`tenant lookup failed (HTTP ${rowRes.status})`);
    tenant = ((await rowRes.json()) as Tenant[])[0] ?? null;
  }
  cache.set(host, { tenant, expires: Date.now() + CACHE_TTL_MS });
  return tenant;
}

export function runWithTenant<T>(host: string, tenant: Tenant | null, fn: () => T): T {
  return storage.run({ host, tenant }, fn);
}

/** החנות של הבקשה הנוכחית, או null מחוץ לבקשה / כשלא זוהתה */
export function maybeCurrentTenant(): Tenant | null {
  return storage.getStore()?.tenant ?? null;
}

/** מזהה החנות של הבקשה — זורק אם לא זוהתה (fail closed) */
export function currentTenantId(): string {
  const tenant = maybeCurrentTenant();
  if (!tenant) throw new Error("החנות לא זוהתה עבור הבקשה הזו");
  return tenant.id;
}

/**
 * כתובת הבסיס של החנות, לקישורים במיילים (איפוס סיסמה, הזמנות, הסכמים).
 * נבנית מרשומת החנות במסד — לא מכותרות הבקשה, שנשלטות ע"י הפונה.
 */
export function tenantSiteOrigin(): string {
  const tenant = maybeCurrentTenant();
  const configured = process.env["PUBLIC_SITE_URL"]?.trim().replace(/\/$/, "");
  const baseDomain = process.env["TENANT_BASE_DOMAIN"]?.trim().toLowerCase();
  if (tenant?.domain) return `https://${tenant.domain}`;
  if (tenant?.is_default && configured) return configured;
  if (tenant && baseDomain) return `https://${tenant.slug}.${baseDomain}`;
  // PUBLIC_SITE_URL שייך לחנות ברירת המחדל — לא שולחים לקוח של חנות אחרת לשם
  if (configured && !tenant) return configured;
  throw new Error("לא הוגדרה כתובת לחנות (tenants.domain / TENANT_BASE_DOMAIN / PUBLIC_SITE_URL)");
}
