import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { TenantPlan, TenantStatus } from "@/integrations/supabase/types";

/**
 * באיזה דומיין אנחנו: פאנל ניהול הפלטפורמה (PLATFORM_ADMIN_HOST) או אתר של חנות.
 * נקרא מ-beforeLoad של ה-root route (גם ב-SSR וגם בניווט בדפדפן).
 */
export const getHostMode = createServerFn({ method: "GET" }).handler(async () => {
  const { isPlatformRequest, isSuspendedStoreRequest, tenantBaseDomain } =
    await import("@/integrations/supabase/tenant.server");
  return {
    platform: isPlatformRequest(),
    suspended: isSuspendedStoreRequest(),
    baseDomain: tenantBaseDomain(),
  };
});

/** אותו פורמט כמו ב-DB (platform_slug_problem) — כדי לא לשלוח בקשה על קלט שבור */
const SLUG_FORMAT = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;

function normalizeSlug(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/**
 * בדיקת כתובת חנות בזמן ההקלדה: פורמט, כתובת שמורה, כתובת תפוסה.
 * הבדיקה עצמה רצה במסד (platform_slug_problem) עם החיבור של המשתמש,
 * כך שרק מנהל פלטפורמה יכול להפעיל אותה.
 */
export const checkStoreSlug = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { slug: string }) => ({ slug: normalizeSlug(input?.slug) }))
  .handler(async ({ data, context }) => {
    const { data: problem, error } = await context.supabase.rpc("platform_slug_problem", {
      _slug: data.slug,
    });
    if (error) throw new Error(error.message);
    return { slug: data.slug, available: problem === null, message: problem };
  });

export const TENANT_PLANS = ["trial", "basic", "pro", "enterprise"] as const;
export const TENANT_STATUSES = ["active", "suspended"] as const;

export const PLAN_LABELS: Record<TenantPlan, string> = {
  trial: "ניסיון (Trial)",
  basic: "בסיסי",
  pro: "מקצועי",
  enterprise: "ארגוני",
};
export const STATUS_LABELS: Record<TenantStatus, string> = {
  active: "פעילה",
  suspended: "מוקפאת",
};

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/** ח.פ / עוסק מורשה: ספרות בלבד — מקפים ורווחים מההקלדה מוסרים */
function normalizeTaxId(value: unknown): string {
  return String(value ?? "").replace(/[\s-]/g, "");
}

export type CreateStoreInput = {
  name: string;
  slug: string;
  ownerEmail: string;
  taxId?: string;
  plan?: TenantPlan;
  status?: TenantStatus;
};

/**
 * הקמת חנות חדשה מהטופס בפאנל הפלטפורמה.
 * 1. platform_create_tenant — בודקת הרשאה, פורמט, שה-slug פנוי ואת כל
 *    השדות (ה-UNIQUE במסד מכריע גם בהקמות במקביל). שורות ההגדרות של
 *    החנות נוצרות בטריגר במסד.
 * 2. חשבון למנהל החנות (האימייל שבטופס) עם סיסמה זמנית — מוחזרת פעם אחת.
 *    אם רק השלב הזה נכשל, החנות נשארת ואפשר ליצור מנהל מהטבלה.
 */
export const createStore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CreateStoreInput) => {
    const name = String(input?.name ?? "").trim();
    const slug = normalizeSlug(input?.slug);
    const ownerEmail = normalizeEmail(input?.ownerEmail);
    const taxId = normalizeTaxId(input?.taxId);
    const plan = input?.plan ?? "trial";
    const status = input?.status ?? "active";
    if (name.length < 1 || name.length > 120) throw new Error("שם החנות חייב להכיל 1 עד 120 תווים");
    if (!SLUG_FORMAT.test(slug)) {
      throw new Error("כתובת: 3-63 תווים, אותיות אנגליות קטנות, ספרות ומקפים (לא בהתחלה או בסוף)");
    }
    if (!EMAIL_FORMAT.test(ownerEmail)) throw new Error("אימייל מנהל החנות לא תקין");
    if (taxId !== "" && !/^[0-9]{5,12}$/.test(taxId)) {
      throw new Error("ח.פ / עוסק מורשה: ספרות בלבד (5 עד 12)");
    }
    if (!TENANT_PLANS.includes(plan)) throw new Error("סוג מנוי לא מוכר");
    if (!TENANT_STATUSES.includes(status)) throw new Error("סטטוס לא מוכר");
    return { name, slug, ownerEmail, taxId, plan, status };
  })
  .handler(async ({ data, context }) => {
    // ההרשאה נבדקת במסד עם החיבור של המשתמש עצמו (לא service role)
    const { data: isPlatformAdmin } = await context.supabase.rpc("is_platform_admin", {});
    if (isPlatformAdmin !== true) throw new Error("רק מנהל הפלטפורמה יכול להקים חנויות");

    const { provisionStoreAdmin, storeAdminEmailProblem } = await import("@/lib/platform.server");
    const { originForTenant } = await import("@/integrations/supabase/tenant.server");

    // לא מקימים חנות שהמנהל שלה לא יוכל להיווצר
    const emailProblem = await storeAdminEmailProblem(data.ownerEmail);
    if (emailProblem) throw new Error(emailProblem);

    const { data: tenant, error } = await context.supabase.rpc("platform_create_tenant", {
      _slug: data.slug,
      _name: data.name,
      _owner_email: data.ownerEmail,
      _tax_id: data.taxId || null,
      _plan: data.plan,
      _status: data.status,
    });
    if (error || !tenant) throw new Error(error?.message ?? "הקמת החנות נכשלה");

    let admin: Awaited<ReturnType<typeof provisionStoreAdmin>> | null = null;
    let adminError: string | null = null;
    try {
      admin = await provisionStoreAdmin(tenant, data.ownerEmail);
    } catch (e) {
      adminError = e instanceof Error ? e.message : String(e);
    }

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      url: originForTenant(tenant),
      admin,
      adminError,
    };
  });

/**
 * מנהל לחנות קיימת (למשל חנות שהוקמה בלי מנהל, או שיצירת המנהל נכשלה
 * בהקמה). מחזיר סיסמה זמנית שמוצגת פעם אחת.
 */
export const createStoreAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId: string; email: string }) => {
    const tenantId = String(input?.tenantId ?? "").trim();
    const email = normalizeEmail(input?.email);
    if (!/^[0-9a-f-]{36}$/.test(tenantId)) throw new Error("חנות לא תקינה");
    if (!EMAIL_FORMAT.test(email)) throw new Error("כתובת אימייל לא תקינה");
    return { tenantId, email };
  })
  .handler(async ({ data, context }) => {
    const { data: isPlatformAdmin } = await context.supabase.rpc("is_platform_admin", {});
    if (isPlatformAdmin !== true) throw new Error("רק מנהל הפלטפורמה יכול להוסיף מנהלי חנויות");

    const { supabaseAdminUnscoped } = await import("@/integrations/supabase/client.server");
    const { provisionStoreAdmin } = await import("@/lib/platform.server");

    const { data: tenant } = await supabaseAdminUnscoped
      .from("tenants")
      .select("id, slug, domain, is_default, owner_email")
      .eq("id", data.tenantId)
      .maybeSingle();
    if (!tenant) throw new Error("החנות לא נמצאה");

    const credentials = await provisionStoreAdmin(tenant, data.email);
    // חנות בלי אימייל בעלים — המנהל הראשון הוא הבעלים
    if (!tenant.owner_email) {
      await supabaseAdminUnscoped
        .from("tenants")
        .update({ owner_email: data.email })
        .eq("id", tenant.id);
    }
    return credentials;
  });

/** שם ברירת המחדל לחנות שעוד לא הגדירה שם עסק */
export const DEFAULT_STORE_NAME = "החנות שלי";
/** הכותרת הקבועה של פאנל ניהול הפלטפורמה */
export const PLATFORM_SITE_NAME = "מערכת ניהול אתר אינטרנט";

/**
 * השם שמוצג ב-title / Open Graph: בדומיין הניהול — קבוע; בחנות — שם העסק
 * מהגדרות החנות (site_settings.business_name), ואם ריק — "החנות שלי".
 */
export const getSiteSeo = createServerFn({ method: "GET" }).handler(async () => {
  const { isPlatformRequest, maybeCurrentTenant } =
    await import("@/integrations/supabase/tenant.server");
  if (isPlatformRequest()) return { siteName: PLATFORM_SITE_NAME };
  if (!maybeCurrentTenant()) return { siteName: DEFAULT_STORE_NAME };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("site_settings")
    .select("business_name")
    .eq("id", true)
    .maybeSingle();
  const storeName = data?.business_name?.trim();
  return { siteName: storeName || DEFAULT_STORE_NAME };
});
