import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  customDomainProblem,
  normalizeDomainInput,
  type CustomDomainStatus,
} from "@/lib/custom-domain";

/**
 * דומיין מותאם אישית לחנות — פעולות מנהל החנות.
 *
 *  getCustomDomain    — המצב הנוכחי + לאן להפנות (תת-הדומיין של החנות, IP השרת)
 *  saveCustomDomain   — שמירת דומיין (או הסרה) → pending
 *  verifyCustomDomain — בדיקת DNS אמיתית בשרת; רק אם עברה → verified.
 *                       מכאן סקריפט התעודות בשרת מוסיף ל-nginx ומנפיק SSL
 *                       (כדקה-שתיים) ומעדכן → active.
 *
 * רק מנהל החנות (או מנהל-על). הכתיבה לטבלת tenants נעשית כאן בשרת (service
 * role) — הדפדפן לא יכול לסמן דומיין כמאומת בעצמו.
 */

export type CustomDomainState = {
  /** תת-הדומיין הקבוע של החנות — היעד של רשומת ה-CNAME */
  storeHost: string | null;
  baseDomain: string | null;
  domain: string | null;
  status: CustomDomainStatus | null;
  error: string | null;
  verifiedAt: string | null;
  checkedAt: string | null;
  sslExpiresAt: string | null;
  /** כתובות ה-IP של השרת — לרשומת A (דומיין ראשי בלי www) */
  serverIps: string[];
};

type TenantDomainRow = {
  id: string;
  slug: string;
  custom_domain: string | null;
  custom_domain_status: string | null;
  custom_domain_error: string | null;
  custom_domain_verified_at: string | null;
  custom_domain_checked_at: string | null;
  custom_domain_ssl_expires_at: string | null;
};

const DOMAIN_COLUMNS =
  "id, slug, custom_domain, custom_domain_status, custom_domain_error, custom_domain_verified_at, custom_domain_checked_at, custom_domain_ssl_expires_at";

async function requireStoreAdmin(userId: string): Promise<void> {
  const { loadCaller } = await import("@/lib/caller.server");
  const caller = await loadCaller(userId);
  if (caller.role !== "admin") throw new Error("רק מנהל החנות יכול לנהל את הדומיין");
}

async function loadTenantRow(): Promise<TenantDomainRow> {
  const { supabaseAdminUnscoped } = await import("@/integrations/supabase/client.server");
  const { currentTenantId } = await import("@/integrations/supabase/tenant.server");
  const { data, error } = await supabaseAdminUnscoped
    .from("tenants")
    .select(DOMAIN_COLUMNS)
    .eq("id", currentTenantId())
    .single();
  if (error || !data) throw new Error("החנות לא נמצאה");
  return data as unknown as TenantDomainRow;
}

async function toState(row: TenantDomainRow, withIps: boolean): Promise<CustomDomainState> {
  const { tenantBaseDomain } = await import("@/integrations/supabase/tenant.server");
  const baseDomain = tenantBaseDomain();
  const storeHost = baseDomain ? `${row.slug}.${baseDomain}` : null;
  let serverIps: string[] = [];
  if (withIps) {
    const { expectedTargets } = await import("@/lib/custom-domain-dns.server");
    serverIps = (await expectedTargets(storeHost).catch(() => ({ ips: [] as string[] }))).ips;
  }
  return {
    storeHost,
    baseDomain,
    domain: row.custom_domain,
    status: (row.custom_domain_status as CustomDomainStatus | null) ?? null,
    error: row.custom_domain_error,
    verifiedAt: row.custom_domain_verified_at,
    checkedAt: row.custom_domain_checked_at,
    sslExpiresAt: row.custom_domain_ssl_expires_at,
    serverIps,
  };
}

/** הכתובות של המערכת עצמה — אי אפשר לחבר אותן כדומיין של חנות */
async function reservedHosts(): Promise<string[]> {
  const hosts: string[] = [];
  const adminHost = process.env["PLATFORM_ADMIN_HOST"]?.trim().toLowerCase();
  if (adminHost) hosts.push(adminHost);
  const siteUrl = process.env["PUBLIC_SITE_URL"]?.trim();
  if (siteUrl) {
    try {
      hosts.push(new URL(siteUrl).hostname.toLowerCase());
    } catch {
      // כתובת לא תקינה בסביבה — אין מה להוסיף
    }
  }
  const supabaseUrl = process.env["SUPABASE_URL"]?.trim();
  if (supabaseUrl) {
    try {
      hosts.push(new URL(supabaseUrl).hostname.toLowerCase());
    } catch {
      // כנ"ל
    }
  }
  return hosts;
}

export const getCustomDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  // light: רענון תקופתי (בהמתנה לתעודה) — בלי שאילתת DNS לכתובות השרת
  .inputValidator((input: { light?: boolean } | undefined) => ({ light: input?.light === true }))
  .handler(async ({ data, context }): Promise<CustomDomainState> => {
    await requireStoreAdmin(context.userId);
    return toState(await loadTenantRow(), !data.light);
  });

/** שמירת דומיין חדש (→ ממתין לאימות). ריק = הסרת הדומיין */
export const saveCustomDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { domain: string }) => ({
    domain: normalizeDomainInput(String(input?.domain ?? "")),
  }))
  .handler(async ({ data, context }): Promise<CustomDomainState> => {
    await requireStoreAdmin(context.userId);
    const { supabaseAdminUnscoped } = await import("@/integrations/supabase/client.server");
    const { tenantBaseDomain } = await import("@/integrations/supabase/tenant.server");
    const { allowAction } = await import("@/lib/rate-limit.server");
    const row = await loadTenantRow();

    if (!allowAction(`custom-domain-save:${row.id}`, 20, 60 * 60 * 1000)) {
      throw new Error("יותר מדי שינויים בשעה האחרונה. נסו שוב מאוחר יותר.");
    }

    // הסרה
    if (data.domain === "") {
      if (row.custom_domain !== null) {
        const { error } = await supabaseAdminUnscoped
          .from("tenants")
          .update({ custom_domain: null })
          .eq("id", row.id);
        if (error) throw new Error(error.message);
      }
      return toState(await loadTenantRow(), false);
    }

    const problem = customDomainProblem(data.domain, tenantBaseDomain());
    if (problem) throw new Error(problem);
    if ((await reservedHosts()).includes(data.domain)) {
      throw new Error("הכתובת הזו שייכת למערכת — הזינו דומיין שרכשתם בעצמכם");
    }
    if (row.custom_domain === data.domain) return toState(row, true);

    // תפוס בחנות אחרת (גם כדומיין מלא של חנות)
    const { data: taken } = await supabaseAdminUnscoped
      .from("tenants")
      .select("id")
      .neq("id", row.id)
      .or(`custom_domain.eq.${data.domain},domain.eq.${data.domain}`)
      .limit(1);
    if (taken && taken.length > 0) {
      throw new Error("הדומיין הזה כבר מחובר לחנות אחרת במערכת");
    }

    // הטריגר במסד מאפס אימות ותעודה ומסמן pending
    const { error } = await supabaseAdminUnscoped
      .from("tenants")
      .update({ custom_domain: data.domain })
      .eq("id", row.id);
    if (error) {
      if (/unique|כבר משמש/i.test(error.message)) {
        throw new Error("הדומיין הזה כבר מחובר לחנות אחרת במערכת");
      }
      throw new Error(error.message);
    }
    return toState(await loadTenantRow(), true);
  });

export type VerifyResult = {
  ok: boolean;
  method: "cname" | "a" | null;
  message: string;
  found: { cnames: string[]; a: string[]; aaaa: string[] };
  state: CustomDomainState;
};

/** "אימות וחיבור דומיין": בדיקת DNS בשרת, ועדכון הסטטוס לפי התוצאה */
export const verifyCustomDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }): Promise<VerifyResult> => {
    await requireStoreAdmin(context.userId);
    const { supabaseAdminUnscoped } = await import("@/integrations/supabase/client.server");
    const { tenantBaseDomain } = await import("@/integrations/supabase/tenant.server");
    const { allowAction } = await import("@/lib/rate-limit.server");
    const { lookupDomain, expectedTargets, evaluateDns } =
      await import("@/lib/custom-domain-dns.server");

    const row = await loadTenantRow();
    if (!row.custom_domain) throw new Error("קודם שמרו את הדומיין שברצונכם לחבר");
    if (!allowAction(`custom-domain-verify:${row.id}`, 30, 10 * 60 * 1000)) {
      throw new Error("יותר מדי בדיקות בזמן קצר. נסו שוב בעוד כמה דקות.");
    }

    const baseDomain = tenantBaseDomain();
    const storeHost = baseDomain ? `${row.slug}.${baseDomain}` : null;
    const [findings, expected] = await Promise.all([
      lookupDomain(row.custom_domain),
      expectedTargets(storeHost),
    ]);
    const verdict = evaluateDns(row.custom_domain, findings, expected);

    const nowIso = new Date().toISOString();
    const patch = verdict.ok
      ? {
          // כבר פעיל עם SSL — נשאר פעיל; אחרת → verified (סקריפט התעודות ימשיך)
          custom_domain_status: row.custom_domain_status === "active" ? "active" : "verified",
          custom_domain_verified_at: row.custom_domain_verified_at ?? nowIso,
          custom_domain_error: null,
        }
      : {
          custom_domain_status: "error",
          custom_domain_verified_at: null,
          custom_domain_error: verdict.message.slice(0, 500),
        };
    const { error } = await supabaseAdminUnscoped
      .from("tenants")
      .update(patch)
      .eq("id", row.id)
      // הדומיין לא הוחלף בזמן הבדיקה
      .eq("custom_domain", row.custom_domain);
    if (error) throw new Error(error.message);

    console.log(
      `[custom-domain] verify ${row.custom_domain} (${row.slug}): ${verdict.ok ? `ok via ${verdict.method}` : "failed"}`,
    );
    return {
      ok: verdict.ok,
      method: verdict.method,
      message: verdict.message,
      found: findings,
      state: await toState(await loadTenantRow(), true),
    };
  });
