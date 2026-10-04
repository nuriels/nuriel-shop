// זיהוי החנות (tenant) של כל בקשה לשרת — לפי הדומיין שממנו היא הגיעה.
// server.ts מריץ כל בקשה בתוך runWithTenant, וכל קוד שרת (כולל
// supabaseAdmin) קורא ממנו את החנות הנוכחית בלי להעביר אותה כפרמטר.
import { AsyncLocalStorage } from "node:async_hooks";
import {
  subscriptionStateFrom,
  type SubscriptionRow,
  type SubscriptionState,
} from "@/lib/subscription";

export type Tenant = {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  is_default: boolean;
  /** active / suspended — חנות מוקפאת נעולה ללקוחות (src/server.ts) */
  status: "active" | "suspended";
  /** דומיין מותאם שמנהל החנות חיבר (www.his-shop.co.il) — null = אין */
  custom_domain: string | null;
  /** pending / verified / active / error */
  custom_domain_status: string | null;
  /** ה-DNS אומת — הדומיין המותאם מנותב לחנות */
  custom_domain_verified: boolean;
  /** המנוי (חלק 13): חבילה, תפוגה ופיצ'רים — מחושב בזמן הזיהוי */
  subscription: SubscriptionState;
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
      `${url}/rest/v1/tenants?id=eq.${encodeURIComponent(id)}&select=id,slug,name,domain,is_default,status,custom_domain,custom_domain_status,custom_domain_verified_at,tenant_subscriptions(plan_type,status,trial_ends_at,current_period_end)`,
      { headers },
    );
    if (!rowRes.ok) throw new Error(`tenant lookup failed (HTTP ${rowRes.status})`);
    const row = (
      (await rowRes.json()) as (Omit<Tenant, "custom_domain_verified" | "subscription"> & {
        custom_domain_verified_at?: string | null;
        // יחס אחד-לאחד: אובייקט (או מערך בגרסאות ישנות של PostgREST)
        tenant_subscriptions?: SubscriptionRow | SubscriptionRow[] | null;
      })[]
    )[0];
    const subscriptionRow = Array.isArray(row?.tenant_subscriptions)
      ? (row.tenant_subscriptions[0] ?? null)
      : (row?.tenant_subscriptions ?? null);
    tenant = row
      ? {
          id: row.id,
          slug: row.slug,
          name: row.name,
          domain: row.domain,
          is_default: row.is_default,
          status: row.status,
          custom_domain: row.custom_domain ?? null,
          custom_domain_status: row.custom_domain_status ?? null,
          custom_domain_verified: Boolean(row.custom_domain_verified_at),
          subscription: subscriptionStateFrom(subscriptionRow, row.is_default),
        }
      : null;
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

/** "https://shop.example.com/x" → "shop.example.com" */
function hostOfUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * כתובת שלא שייכת לאף חנות. tenant_for_host נופל לחנות ברירת המחדל כשאין
 * התאמה, ולכן כאן בודקים שההתאמה הייתה אמיתית:
 *  - תת-דומיין של הפלטפורמה: shop-that-doesnt-exist.<base> לא מציג את החנות הראשית.
 *  - דומיין חיצוני: רק הדומיין המלא של החנות (tenants.domain), דומיין מותאם
 *    שה-DNS שלו אומת, או כתובת האתר הראשית. דומיין מותאם שעוד לא אומת (או
 *    שהוסר) לא מציג שום חנות.
 * localhost / כתובת IP — כמו קודם (חנות ברירת המחדל).
 */
export function isUnknownStoreHost(host: string, tenant: Tenant): boolean {
  const { baseDomain, adminHost, siteUrl } = platformEnv();
  if (!baseDomain || host === adminHost || host === baseDomain) return false;
  if (host.endsWith(`.${baseDomain}`)) {
    const label = host.slice(0, -(baseDomain.length + 1));
    return tenant.is_default && tenant.domain !== host && label !== tenant.slug;
  }
  if (tenant.domain === host) return false;
  if (tenant.custom_domain === host && tenant.custom_domain_verified) return false;
  if (hostOfUrl(siteUrl) === host) return false;
  if (host === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[")) {
    return false;
  }
  return true;
}

export type StoreLockReason = "suspended" | "expired";

/**
 * למה האתר של החנות נעול ללקוחות (ולא דומיין הפלטפורמה):
 *  - suspended: הוקפאה ע"י מנהל הפלטפורמה
 *  - expired: תקופת הניסיון / המנוי הסתיימה (חלק 13)
 * null = פתוחה. המנוי נבדק מחדש בכל זיהוי (מטמון של 15 שניות).
 */
export function storeLockReason(): StoreLockReason | null {
  if (isPlatformRequest()) return null;
  const tenant = maybeCurrentTenant();
  if (!tenant) return null;
  if (tenant.status === "suspended") return "suspended";
  if (tenant.subscription.active === false) {
    // התפוגה עצמה יכולה לקרות בתוך חלון המטמון — בודקים שוב מול השעון
    return "expired";
  }
  const endsAt = tenant.subscription.endsAt;
  if (!tenant.is_default && endsAt && Date.parse(endsAt) <= Date.now()) return "expired";
  return null;
}

/** האתר של החנות נעול ללקוחות (מוקפאת או שהמנוי פג)? */
export function isSuspendedStoreRequest(): boolean {
  return storeLockReason() !== null;
}

/**
 * כתובת הבסיס של חנות מסוימת — מרשומת החנות במסד: דומיין מלא, דומיין מותאם
 * פעיל (עם תעודת SSL), תת-דומיין, או כתובת האתר הראשית.
 */
export function originForTenant(
  tenant:
    | (Pick<Tenant, "slug" | "domain" | "is_default"> &
        Partial<Pick<Tenant, "custom_domain" | "custom_domain_status">>)
    | null,
): string {
  const { siteUrl, baseDomain } = platformEnv();
  if (tenant?.domain) return `https://${tenant.domain}`;
  if (tenant?.custom_domain && tenant.custom_domain_status === "active") {
    return `https://${tenant.custom_domain}`;
  }
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
