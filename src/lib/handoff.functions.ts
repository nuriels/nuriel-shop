import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * "היכנס לניהול" מפאנל הפלטפורמה (God Mode).
 *
 * החיבור לאתר נשמר בדפדפן לפי דומיין, ולכן מנהל-על שמחובר לפאנל
 * (nuriel.<base>) עוד לא מחובר באתר של החנות (<slug>.<base>). המעבר:
 *  1. בפאנל: קוד חד-פעמי (32 בתים אקראיים, נשמר רק ה-hash), צמוד לחנות
 *     אחת, בתוקף 2 דקות. הכתובת: https://<חנות>/admin-handoff#code=...
 *     (ב-fragment — הדפדפן לא שולח אותו לשרת ולא ללוגים של nginx).
 *  2. באתר החנות: הקוד נפדה פעם אחת בלבד, נבדק שהמשתמש עדיין מנהל-על,
 *     ונפתח לו חיבור רגיל (GoTrue magic link שנוצר ומאומת בשרת — בלי מייל).
 *     זה חיבור נפרד: החיבור בפאנל לא נפגע.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** תוקף הקוד: רק כדי לעבור מהפאנל לאתר החנות */
const HANDOFF_TTL_MS = 2 * 60 * 1000;

const EXPIRED =
  'קישור הכניסה לא תקף, פג תוקפו או שכבר נוצל. חזרו לפאנל הפלטפורמה ולחצו שוב על "היכנס לניהול".';

async function sha256(value: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(value).digest("hex");
}

export const createStoreAdminHandoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId: string }) => {
    const tenantId = String(input?.tenantId ?? "")
      .trim()
      .toLowerCase();
    if (!UUID.test(tenantId)) throw new Error("מזהה חנות לא תקין");
    return { tenantId };
  })
  .handler(async ({ data, context }) => {
    const { isPlatformAdminUser, supabaseAdminUnscoped } =
      await import("@/integrations/supabase/client.server");
    const { originForTenant } = await import("@/integrations/supabase/tenant.server");
    const { allowAction } = await import("@/lib/rate-limit.server");
    const { randomBytes } = await import("node:crypto");

    if (!(await isPlatformAdminUser(context.userId))) {
      throw new Error("רק מנהל הפלטפורמה יכול להיכנס לניהול של חנות");
    }
    if (!allowAction(`handoff:${context.userId}`, 30, 10 * 60 * 1000)) {
      throw new Error("יותר מדי כניסות בזמן קצר. נסו שוב בעוד כמה דקות.");
    }

    const { data: tenant } = await supabaseAdminUnscoped
      .from("tenants")
      .select("id, slug, name, domain, is_default")
      .eq("id", data.tenantId)
      .maybeSingle();
    if (!tenant) throw new Error("החנות לא נמצאה");

    // ניקוי קודים ישנים (נוצלו / פג תוקפם לפני יותר משעה)
    await supabaseAdminUnscoped
      .from("platform_admin_handoffs")
      .delete()
      .lt("expires_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());

    const code = randomBytes(32).toString("base64url");
    const { error } = await supabaseAdminUnscoped.from("platform_admin_handoffs").insert({
      token_hash: await sha256(code),
      user_id: context.userId,
      tenant_id: tenant.id,
      expires_at: new Date(Date.now() + HANDOFF_TTL_MS).toISOString(),
    });
    if (error) throw new Error(error.message);

    return {
      url: `${originForTenant(tenant)}/admin-handoff#code=${code}`,
      storeName: tenant.name,
    };
  });

export const redeemStoreAdminHandoff = createServerFn({ method: "POST" })
  .inputValidator((input: { code: string }) => {
    const code = String(input?.code ?? "").trim();
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(code)) throw new Error(EXPIRED);
    return { code };
  })
  .handler(async ({ data }) => {
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    const ip = await requestIp();
    if (!allowAction(`handoff-redeem:${ip}`, 20, 15 * 60 * 1000)) {
      throw new Error("יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.");
    }

    const { isPlatformAdminUser, supabaseAdminUnscoped } =
      await import("@/integrations/supabase/client.server");
    const { currentTenantId } = await import("@/integrations/supabase/tenant.server");

    // פדיון אטומי: רק פעם אחת, רק בחנות שהקוד נוצר עבורה, רק בתוקף
    const nowIso = new Date().toISOString();
    const { data: row } = await supabaseAdminUnscoped
      .from("platform_admin_handoffs")
      .update({ used_at: nowIso })
      .eq("token_hash", await sha256(data.code))
      .eq("tenant_id", currentTenantId())
      .is("used_at", null)
      .gt("expires_at", nowIso)
      .select("user_id")
      .maybeSingle();
    if (!row) throw new Error(EXPIRED);
    if (!(await isPlatformAdminUser(row.user_id))) throw new Error("אין לחשבון הרשאת מנהל-על");

    const { data: userData } = await supabaseAdminUnscoped.auth.admin.getUserById(row.user_id);
    const email = userData.user?.email;
    if (!email) throw new Error("לחשבון אין כתובת אימייל");

    // חיבור חדש לאותו משתמש: קישור כניסה שנוצר ומאומת כאן בשרת (לא נשלח מייל)
    const { sessionForEmail } = await import("@/lib/session.server");
    try {
      const { accessToken, refreshToken } = await sessionForEmail(email, "handoff");
      return { accessToken, refreshToken };
    } catch {
      throw new Error("החיבור לחנות נכשל. נסו שוב.");
    }
  });
