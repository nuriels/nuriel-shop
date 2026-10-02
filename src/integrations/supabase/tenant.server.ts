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
  /** active / suspended — חנות מוקפאת נעולה ללקוחות (src/server.ts) */
  status: "active" | "suspended";
};

type TenantContext = { host: string; tenant: Tenant | null };

const storage = new AsyncLocalStorage<TenantContext>();
const cache = new Map<string, { tenant: Tenant | null; expires: number }>();
// קצר: הקפאה / שחרור חנות בפאנל הפלטפורמה נכנסים לתוקף תוך כ-15 שניות
const CACHE_TTL_MS = 15_000;

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
      `${url}/rest/v1/tenants?id=eq.${encodeURIComponent(id)}&select=id,slug,name,domain,is_default,status`,
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

/** הגדרות הפלטפורמה מהסביבה */
function platformEnv() {
  return {
    siteUrl: process.env["PUBLIC_SITE_URL"]?.trim().replace(/\/$/, "") || null,
    baseDomain: process.env["TENANT_BASE_DOMAIN"]?.trim().toLowerCase() || null,
    adminHost: process.env["PLATFORM_ADMIN_HOST"]?.trim().toLowerCase() || null,
  };
}

/** הבקשה הגיעה מדומיין פאנל ניהול הפלטפורמה (PLATFORM_ADMIN_HOST)? */
export function isPlatformRequest(): boolean {
  const { adminHost } = platformEnv();
  return adminHost !== null && storage.getStore()?.host === adminHost;
}

/** בסיס הדומיין של חנויות בתת-דומיין (<slug>.<base>), לתצוגה בפאנל הפלטפורמה */
export function tenantBaseDomain(): string | null {
  return platformEnv().baseDomain;
}

/**
 * תת-דומיין של הפלטפורמה שלא שייך לאף חנות. tenant_for_host נופל לחנות
 * ברירת המחדל כשאין התאמה, ולכן כאן בודקים שההתאמה הייתה אמיתית — אחרת
 * shop-that-doesnt-exist.<base> היה מציג את החנות הראשית.
 */
export function isUnknownStoreHost(host: string, tenant: Tenant): boolean {
  const { baseDomain, adminHost } = platformEnv();
  if (!baseDomain || !host.endsWith(`.${baseDomain}`) || host === adminHost) return false;
  const label = host.slice(0, -(baseDomain.length + 1));
  return tenant.is_default && tenant.domain !== host && label !== tenant.slug;
}

/** חנות הבקשה מוקפאת (ולא דומיין הפלטפורמה)? */
export function isSuspendedStoreRequest(): boolean {
  return !isPlatformRequest() && maybeCurrentTenant()?.status === "suspended";
}

/** כתובת הבסיס של חנות מסוימת — מרשומת החנות במסד */
export function originForTenant(
  tenant: Pick<Tenant, "slug" | "domain" | "is_default"> | null,
): string {
  const { siteUrl, baseDomain } = platformEnv();
  if (tenant?.domain) return `https://${tenant.domain}`;
  if (tenant?.is_default && siteUrl) return siteUrl;
  if (tenant && baseDomain) return `https://${tenant.slug}.${baseDomain}`;
  // PUBLIC_SITE_URL שייך לחנות ברירת המחדל — לא שולחים לקוח של חנות אחרת לשם
  if (siteUrl && !tenant) return siteUrl;
  throw new Error("לא הוגדרה כתובת לחנות (tenants.domain / TENANT_BASE_DOMAIN / PUBLIC_SITE_URL)");
}

/**
 * כתובת הבסיס של החנות הנוכחית, לקישורים במיילים (איפוס סיסמה, הזמנות, הסכמים).
 * נבנית מרשומת החנות במסד — לא מכותרות הבקשה, שנשלטות ע"י הפונה.
 */
export function tenantSiteOrigin(): string {
  return originForTenant(maybeCurrentTenant());
}
