import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * באיזה דומיין אנחנו: פאנל ניהול הפלטפורמה (PLATFORM_ADMIN_HOST) או אתר של חנות.
 * נקרא מ-beforeLoad של ה-root route (גם ב-SSR וגם בניווט בדפדפן).
 */
export const getHostMode = createServerFn({ method: "GET" }).handler(async () => {
  const { isPlatformRequest, tenantBaseDomain } =
    await import("@/integrations/supabase/tenant.server");
  return { platform: isPlatformRequest(), baseDomain: tenantBaseDomain() };
});

/**
 * מנהל ראשון לחנות שהוקמה בפאנל הפלטפורמה. נוצר כאן (ולא ב-SQL) כי
 * צריך את ה-Auth API של Supabase. מחזיר סיסמה זמנית שמוצגת פעם אחת;
 * בכניסה הראשונה המנהל חייב לקבוע סיסמה משלו.
 */
export const createStoreAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId: string; email: string }) => {
    const tenantId = String(input?.tenantId ?? "").trim();
    const email = String(input?.email ?? "")
      .trim()
      .toLowerCase();
    if (!/^[0-9a-f-]{36}$/.test(tenantId)) throw new Error("חנות לא תקינה");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("כתובת אימייל לא תקינה");
    return { tenantId, email };
  })
  .handler(async ({ data, context }) => {
    // ההרשאה נבדקת במסד עם החיבור של המשתמש עצמו (לא service role)
    const { data: isPlatformAdmin } = await context.supabase.rpc("is_platform_admin", {});
    if (isPlatformAdmin !== true) throw new Error("רק מנהל הפלטפורמה יכול להוסיף מנהלי חנויות");

    const { supabaseAdminUnscoped } = await import("@/integrations/supabase/client.server");
    const { originForTenant } = await import("@/integrations/supabase/tenant.server");
    const { randomInt } = await import("node:crypto");

    const { data: tenant } = await supabaseAdminUnscoped
      .from("tenants")
      .select("id, slug, name, domain, is_default")
      .eq("id", data.tenantId)
      .maybeSingle();
    if (!tenant) throw new Error("החנות לא נמצאה");

    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const block = () =>
      Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join("");
    const tempPassword = `${block()}-${block()}-${block()}`;

    // חשבון התחברות אחד לכל אימייל בכל הפלטפורמה — מנהל של חנות אחרת לא יכול להיות גם כאן
    const { data: created, error: createError } = await supabaseAdminUnscoped.auth.admin.createUser(
      {
        email: data.email,
        password: tempPassword,
        email_confirm: true,
      },
    );
    if (createError || !created.user) {
      const message = createError?.message ?? "";
      if (/already|exists|registered|duplicate/i.test(message)) {
        throw new Error("כתובת האימייל הזו כבר רשומה במערכת (בחנות זו או בחנות אחרת)");
      }
      throw new Error(message || "יצירת המשתמש נכשלה");
    }

    const { error: roleError } = await supabaseAdminUnscoped.from("user_roles").insert({
      tenant_id: tenant.id,
      user_id: created.user.id,
      email: data.email,
      role: "admin",
      is_approved: true,
      is_blocked: false,
      must_change_password: true,
    });
    if (roleError) {
      // לא משאירים חשבון התחברות בלי שיוך לחנות
      await supabaseAdminUnscoped.auth.admin.deleteUser(created.user.id);
      throw new Error(roleError.message);
    }

    return {
      email: data.email,
      tempPassword,
      loginUrl: `${originForTenant(tenant)}/login`,
    };
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
