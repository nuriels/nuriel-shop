import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * שליחת מיילי הזמנה/בקשת הצעת מחיר: סיכום מלא לסוכן המשויך ולמנהלים
 * שנבחרו, ואישור ללקוח. לכל המיילים מצורף אוטומטית מסמך PDF (אישור הזמנה
 * או בקשה להצעת מחיר) עם לוגו העסק, פרטיו, מספר הסוכן ופירוט הפריטים.
 * כשלון שליחה לא מבטל את ההזמנה — היא כבר נשמרה במסד.
 */
export const sendOrderEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => {
    const orderId = String(input?.orderId ?? "").trim();
    if (!orderId) throw new Error("חסר מזהה הזמנה");
    return { orderId };
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendOrderEmailsInternal } = await import("@/lib/order-emails.server");

    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("customer_id, agent_id")
      .eq("id", data.orderId)
      .maybeSingle();
    if (!order) throw new Error("ההזמנה לא נמצאה");

    const { loadCaller } = await import("@/lib/caller.server");
    const caller = await loadCaller(context.userId);
    const isOwner = context.userId === order.customer_id || context.userId === order.agent_id;
    if (!isOwner && caller.role !== "admin") throw new Error("אין הרשאה");

    return sendOrderEmailsInternal(data.orderId, context.userId);
  });

/** כפתור "שליחת מייל בדיקה" בפאנל הניהול — נשלח למנהל המחובר עצמו */
export const sendTestEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendEmail, renderEmailHtml } = await import("@/lib/email.server");

    const { loadCaller } = await import("@/lib/caller.server");
    const caller = await loadCaller(context.userId);
    if (caller.role !== "admin" || !caller.email) throw new Error("אין הרשאה");
    const callerEmail = caller.email;

    const { data: emailSettings } = await supabaseAdmin
      .from("email_settings")
      .select("sender_email")
      .eq("id", true)
      .maybeSingle();
    const senderEmail = emailSettings?.sender_email?.trim() || "";

    const result = await sendEmail({
      from: senderEmail,
      to: [callerEmail],
      subject: "מייל בדיקה",
      // isTest משנה את שורת הסיום ל"אנו מבצעים בדיקה, נא לא להשיב למייל זה"
      html: await renderEmailHtml(
        "מייל בדיקה",
        "<p>זהו מייל בדיקה מפאנל הניהול. אם הוא הגיע — התקשורת עם Resend עובדת תקין.</p>",
        { isTest: true },
      ),
    });
    if (!result.sent) throw new Error(result.reason ?? "השליחה נכשלה");
    return { sentTo: callerEmail };
  });

/** הורדת מסמך ה-PDF של הזמנה קיימת (הלקוח עצמו, הסוכן המטפל או מנהל) */
export const downloadOrderDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => {
    const orderId = String(input?.orderId ?? "").trim();
    if (!orderId) throw new Error("חסר מזהה הזמנה");
    return { orderId };
  })
  .handler(async ({ data, context }) => {
    const { loadOrderDocument } = await import("@/lib/documents.server");

    const { order, pdf } = await loadOrderDocument(data.orderId);
    const { loadCaller } = await import("@/lib/caller.server");
    const caller = await loadCaller(context.userId);
    const isOwner = context.userId === order.customer_id || context.userId === order.agent_id;
    if (!isOwner && caller?.role !== "admin") throw new Error("אין הרשאה");

    return { filename: pdf.filename, base64: pdf.base64 };
  });

/**
 * אבחון הגדרות המייל עבור פאנל הניהול: האם מפתח Resend קיים בשרת, מה
 * כתובת השולחת המוגדרת, ומה הדומיין שלה. נועד לענות מיד על "ביקשתי
 * איפוס סיסמה ולא הגיע מייל" בלי לחפש בלוגים.
 */
export const getEmailDiagnostics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { loadCaller } = await import("@/lib/caller.server");
    const caller = await loadCaller(context.userId);
    if (caller?.role !== "admin") throw new Error("אין הרשאה");

    const { data: emailSettings } = await supabaseAdmin
      .from("email_settings")
      .select("sender_email")
      .eq("id", true)
      .maybeSingle();

    const senderEmail = emailSettings?.sender_email?.trim() ?? "";
    // מפתח החנות (פאנל הפלטפורמה) קודם; אחרת RESEND_API_KEY של השרת
    const { resolveResendKey } = await import("@/lib/email.server");
    const resolved = await resolveResendKey();
    const apiKey = resolved?.key ?? "";

    return {
      hasApiKey: apiKey !== "",
      // רק 4 תווים אחרונים, כדי לאמת שזה המפתח הנכון בלי לחשוף אותו
      apiKeyHint: apiKey === "" ? null : `••••${apiKey.slice(-4)}`,
      /** store = מפתח החנות מפאנל הפלטפורמה; server = המפתח הכללי של השרת */
      apiKeySource: resolved?.source ?? null,
      senderEmail,
      senderDomain: senderEmail.includes("@") ? senderEmail.split("@")[1] : null,
      // כתובת החנות לקישורים במיילים (tenants.domain / TENANT_BASE_DOMAIN / PUBLIC_SITE_URL)
      siteUrlConfigured: await (async () => {
        const { tenantSiteOrigin } = await import("@/integrations/supabase/tenant.server");
        try {
          tenantSiteOrigin();
          return true;
        } catch {
          return false;
        }
      })(),
    };
  });
