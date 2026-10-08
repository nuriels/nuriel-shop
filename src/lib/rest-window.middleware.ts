import { createMiddleware } from "@tanstack/react-start";

/**
 * חלק 35: Middleware לשבת / חג — לפעולות שרת שיוצרות הזמנה מהאתר (הזמנת אורח,
 * "הזמנה חוזרת"). בודק בשרת, לפי שעון ישראל, אם החנות בחלון שבת / חג, ועוצר
 * עם ההודעה הברורה עוד לפני הקריאה למסד. המסד אוכף את אותו כלל בכל מקרה
 * (orders_require_open_storefront → store_rest_state).
 * בדומיין הפלטפורמה / בלי חנות — לא חוסם.
 */
export const requireStoreOpen = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { maybeCurrentTenant, isPlatformRequest } =
    await import("@/integrations/supabase/tenant.server");
  if (!isPlatformRequest() && maybeCurrentTenant()) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("site_settings")
      .select("shabbat_auto_enabled, shabbat_start_time, shabbat_end_time, holidays")
      .eq("id", true)
      .maybeSingle();
    const { computeRestState, restSettingsFrom, REST_CHECKOUT_MESSAGE } =
      await import("@/lib/rest-window");
    const state = computeRestState(restSettingsFrom(data), new Date());
    if (state.closed) throw new Error(REST_CHECKOUT_MESSAGE);
  }
  return next();
});
