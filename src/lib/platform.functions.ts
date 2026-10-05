import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { TenantPlan, TenantStatus } from "@/integrations/supabase/types";
import { DEFAULT_STORE_NAME } from "@/lib/branding";
import { PORTAL_STORE_SLUG } from "@/lib/portal";

/**
 * באיזה דומיין אנחנו: פאנל ניהול הפלטפורמה (PLATFORM_ADMIN_HOST) או אתר של חנות.
 * נקרא מ-beforeLoad של ה-root route (גם ב-SSR וגם בניווט בדפדפן).
 */
export const getHostMode = createServerFn({ method: "GET" }).handler(async () => {
  const { isPlatformRequest, storeLockReason, tenantBaseDomain } =
    await import("@/integrations/supabase/tenant.server");
  const adminHost = process.env["PLATFORM_ADMIN_HOST"]?.trim().toLowerCase() || null;
  const lock = storeLockReason();
  return {
    platform: isPlatformRequest(),
    suspended: lock !== null,
    lock,
    baseDomain: tenantBaseDomain(),
    /** פאנל הפלטפורמה — לקישור "חזרה לפאנל" של מנהל-על שנמצא בחנות */
    platformUrl: adminHost ? `https://${adminHost}/platform` : null,
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

/** החבילות (חלק 13 — מקור האמת: tenant_subscriptions; כאן לתצוגה) */
export const TENANT_PLANS = ["trial", "basic", "premium"] as const;
export const TENANT_STATUSES = ["active", "suspended"] as const;

export const PLAN_LABELS: Record<TenantPlan, string> = {
  trial: "ניסיון",
  basic: "בסיסי",
  premium: "פרימיום",
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
  status?: TenantStatus;
};

/**
 * הקמת חנות חדשה מהטופס בפאנל הפלטפורמה.
 * 1. platform_create_tenant — בודקת הרשאה, פורמט, שה-slug פנוי ואת כל
 *    השדות (ה-UNIQUE במסד מכריע גם בהקמות במקביל). שורות ההגדרות של
 *    החנות נוצרות בטריגר במסד.
 * 2. חשבון למנהל החנות (האימייל שבטופס) עם סיסמה זמנית — מוחזרת פעם אחת.
 *    אם רק השלב הזה נכשל, החנות נשארת ואפשר ליצור מנהל מהטבלה.
 * כל חנות חדשה מתחילה ב-14 ימי ניסיון (טריגר במסד); חבילה בתשלום נקבעת
 * ב"תעד תשלום" בטבלת החנויות.
 */
export const createStore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CreateStoreInput) => {
    const name = String(input?.name ?? "").trim();
    const slug = normalizeSlug(input?.slug);
    const ownerEmail = normalizeEmail(input?.ownerEmail);
    const taxId = normalizeTaxId(input?.taxId);
    const status = input?.status ?? "active";
    if (name.length < 1 || name.length > 120) throw new Error("שם החנות חייב להכיל 1 עד 120 תווים");
    if (!SLUG_FORMAT.test(slug)) {
      throw new Error("כתובת: 3-63 תווים, אותיות אנגליות קטנות, ספרות ומקפים (לא בהתחלה או בסוף)");
    }
    if (!EMAIL_FORMAT.test(ownerEmail)) throw new Error("אימייל מנהל החנות לא תקין");
    if (taxId !== "" && !/^[0-9]{5,12}$/.test(taxId)) {
      throw new Error("ח.פ / עוסק מורשה: ספרות בלבד (5 עד 12)");
    }
    if (!TENANT_STATUSES.includes(status)) throw new Error("סטטוס לא מוכר");
    return { name, slug, ownerEmail, taxId, status };
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
      _plan: "trial",
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

/**
 * מחיקת חנות לצמיתות (מנהל-על בלבד; לא החנות הראשית). לאישור צריך להקליד
 * את כתובת החנות. סדר הפעולות:
 * 1. platform_delete_tenant — כל המידע במסד, בטרנזקציה אחת (או הכל או כלום).
 * 2. חשבונות ההתחברות של החנות (Auth) — כדי שהאימיילים יתפנו.
 * 3. הקבצים של החנות ב-Storage (תמונות מוצרים, לוגו, באנרים).
 * תעודת ה-SSL והגדרת ה-nginx של הכתובת מוסרות בשרת תוך דקה (store-certs.sh).
 */
export const deleteStore = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId: string; confirmSlug: string }) => {
    const tenantId = String(input?.tenantId ?? "").trim();
    if (!/^[0-9a-f-]{36}$/.test(tenantId)) throw new Error("חנות לא תקינה");
    return { tenantId, confirmSlug: normalizeSlug(input?.confirmSlug) };
  })
  .handler(async ({ data, context }) => {
    // הבדיקות (מנהל-על, לא החנות הראשית, כתובת לאישור) — במסד, עם החיבור של המשתמש
    const { data: deleted, error } = await context.supabase.rpc("platform_delete_tenant", {
      _tenant: data.tenantId,
      _confirm_slug: data.confirmSlug,
    });
    if (error || !deleted) throw new Error(error?.message ?? "מחיקת החנות נכשלה");

    const { deleteAuthUsers, removeTenantStorage } = await import("@/lib/platform.server");
    const auth = await deleteAuthUsers(deleted.user_ids ?? []);
    const storage = await removeTenantStorage(data.tenantId);
    const warnings = [...auth.errors, ...storage.errors];
    if (warnings.length > 0)
      console.error("[deleteStore] cleanup warnings", data.tenantId, warnings);

    return {
      slug: deleted.slug,
      rows: deleted.rows,
      users: auth.users,
      files: storage.files,
      warnings,
    };
  });

export { DEFAULT_STORE_NAME } from "@/lib/branding";
/** הכותרת הקבועה של פאנל ניהול הפלטפורמה */
export const PLATFORM_SITE_NAME = "מערכת ניהול אתר אינטרנט";

/**
 * מה שה-root route צריך כבר ב-SSR (בלי הבהוב בטעינה):
 * - siteName: ל-title / Open Graph — בדומיין הניהול שם קבוע; בחנות שם העסק
 *   מהגדרות החנות (site_settings.business_name), ואם ריק — "החנות שלי".
 * - brandColor: צבע המותג של החנות (null = עיצוב ברירת המחדל).
 * - sabbath: מצב שבת — הלקוחות רואים מסך "שבת שלום" במקום הקטלוג.
 * - isDefaultStore: החנות הראשית (הלוגו המובנה שייך רק לה).
 * - isPortal: האתר של שער הפלטפורמה (nuriel-app2) — בעמוד הבית דף נחיתה
 *   ופתיחת חנויות במקום קטלוג (חלק 12).
 * - subscription: מנוי החנות (חלק 13) — חבילה, תפוגה ופיצ'רים. משמש לנעילת
 *   פיצ'רים במסכים (האכיפה עצמה גם במסד). null בדומיין הפלטפורמה.
 * - seoTitle / seoDescription: כותרת ותיאור לגוגל ולשיתוף (חלק 14; ריק = שם העסק).
 * - tracking: מזהי Facebook Pixel / Google Analytics — נכנסים ל-<head>.
 * - promo: פופ-אפ המבצעים בכניסה לאתר (null = כבוי).
 */
export const getSiteSeo = createServerFn({ method: "GET" }).handler(async () => {
  const { isPlatformRequest, maybeCurrentTenant } =
    await import("@/integrations/supabase/tenant.server");
  const none = {
    brandColor: null,
    sabbath: false,
    isDefaultStore: false,
    isPortal: false,
    subscription: null,
    seoTitle: "",
    seoDescription: "",
    tracking: null,
    promo: null,
    schema: null,
  };
  if (isPlatformRequest()) return { siteName: PLATFORM_SITE_NAME, ...none };
  const tenant = maybeCurrentTenant();
  if (!tenant) return { siteName: DEFAULT_STORE_NAME, ...none };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("site_settings")
    .select(
      "business_name, brand_color, is_sabbath_mode, seo_title, seo_description, facebook_pixel_id, google_analytics_id, promo_popup_enabled, promo_popup_text, promo_popup_coupon, logo_path, business_phone, support_phone, business_email, business_address, business_hours",
    )
    .eq("id", true)
    .maybeSingle();
  const storeName = data?.business_name?.trim();
  const isPortal = tenant.slug === PORTAL_STORE_SLUG;
  const pixelId = data?.facebook_pixel_id ?? null;
  const gaId = data?.google_analytics_id ?? null;
  const promoText = data?.promo_popup_text?.trim() ?? "";
  // חלק 21: הכתובת הראשית של החנות (לכתובת הקנונית, og:url ו-JSON-LD), הלוגו
  // (לתמונת השיתוף) ואמצעי הקשר — לסכמת העסק של גוגל. site_settings ציבורי.
  let origin: string | null = null;
  try {
    const { tenantSiteOrigin } = await import("@/integrations/supabase/tenant.server");
    origin = tenantSiteOrigin();
  } catch {
    origin = null;
  }
  const logoPath = data?.logo_path?.trim() ?? "";
  const supabaseUrl = process.env["SUPABASE_URL"]?.replace(/\/$/, "") ?? "";
  const logoUrl = /^https?:\/\//i.test(logoPath)
    ? logoPath
    : logoPath && supabaseUrl
      ? `${supabaseUrl}/storage/v1/object/public/branding/${logoPath}`
      : null;
  return {
    siteName: storeName || DEFAULT_STORE_NAME,
    brandColor: data?.brand_color ?? null,
    sabbath: data?.is_sabbath_mode === true,
    isDefaultStore: tenant.is_default,
    isPortal,
    subscription: tenant.subscription,
    seoTitle: data?.seo_title?.trim() ?? "",
    seoDescription: data?.seo_description?.trim() ?? "",
    tracking: pixelId || gaId ? { pixelId, gaId } : null,
    promo:
      data?.promo_popup_enabled && promoText !== "" && !isPortal
        ? { text: promoText, coupon: data.promo_popup_coupon ?? null }
        : null,
    schema:
      origin && !isPortal
        ? {
            url: origin,
            logoUrl,
            phone: data?.support_phone?.trim() || data?.business_phone?.trim() || null,
            email: data?.business_email?.trim() || null,
            address: data?.business_address?.trim() || null,
            hours: data?.business_hours?.trim() || null,
          }
        : null,
  };
});
