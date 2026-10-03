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

/**
 * "בדיקת שליחת מייל" בהגדרות המייל של החנות: מייל טסט לכתובת שהמנהל מזין
 * (ברירת מחדל — המנהל עצמו), מהשולח של החנות — "שם החנות <orders@nuri1.fit>".
 * מחזיר את השגיאה המדויקת של Resend אם השליחה נכשלה (מפתח / דומיין לא מאומת).
 * מוגבל ל-10 בדיקות בשעה לחנות, כדי שלא ישמש לשליחת מיילים לכתובות זרות.
 */
export const sendTestEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { to?: string } | undefined) => {
    const to = String(input?.to ?? "")
      .trim()
      .toLowerCase();
    if (to !== "" && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(to)) {
      throw new Error("כתובת המייל לבדיקה אינה תקינה");
    }
    return { to };
  })
  .handler(async ({ data, context }) => {
    const { sendEmail, renderEmailHtml, storeSender, escapeHtml } =
      await import("@/lib/email.server");
    const { allowAction } = await import("@/lib/rate-limit.server");
    const { currentTenantId } = await import("@/integrations/supabase/tenant.server");

    const { loadCaller } = await import("@/lib/caller.server");
    const caller = await loadCaller(context.userId);
    if (caller.role !== "admin") throw new Error("רק מנהל החנות יכול לשלוח מייל בדיקה");
    const to = data.to || caller.email || "";
    if (!to) throw new Error("נא להזין כתובת מייל לבדיקה");
    if (!allowAction(`test-email:${currentTenantId()}`, 10, 60 * 60 * 1000)) {
      throw new Error("נשלחו כבר 10 מיילי בדיקה בשעה האחרונה. נסו שוב מאוחר יותר.");
    }

    const sender = await storeSender();
    const sentAt = new Date().toLocaleString("he-IL", {
      timeZone: "Asia/Jerusalem",
      dateStyle: "short",
      timeStyle: "medium",
    });
    const result = await sendEmail({
      to: [to],
      subject: `מייל בדיקה — ${sender.name}`,
      // isTest משנה את שורת הסיום ל"אנו מבצעים בדיקה, נא לא להשיב למייל זה"
      html: await renderEmailHtml(
        "מייל בדיקה",
        `<p>זהו מייל בדיקה מפאנל הניהול של <strong>${escapeHtml(sender.name)}</strong>.</p>
         <p>אם הוא הגיע — שליחת המיילים של החנות עובדת: אישורי הזמנה, "ההזמנה יצאה למשלוח", קודי כניסה ואיפוס סיסמה.</p>
         <p style="color:#6b7280;font-size:13px;">נשלח מ: <span dir="ltr">${escapeHtml(sender.from)}</span><br/>בתאריך: ${escapeHtml(sentAt)}</p>`,
        { isTest: true },
      ),
    });
    if (!result.sent) throw new Error(result.reason ?? "השליחה נכשלה");
    return {
      sentTo: to,
      from: sender.from,
      fromName: sender.name,
      fromAddress: sender.address,
      replyTo: sender.replyTo,
    };
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
 * אבחון הגדרות המייל עבור פאנל הניהול: האם מפתח Resend הגלובלי קיים בשרת,
 * מאיזו כתובת יוצאים המיילים של החנות ולאן מגיעות תשובות. נועד לענות מיד
 * על "ביקשתי איפוס סיסמה ולא הגיע מייל" בלי לחפש בלוגים.
 */
export const getEmailDiagnostics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }) => {
    const { loadCaller } = await import("@/lib/caller.server");
    const caller = await loadCaller(context.userId);
    if (caller?.role !== "admin") throw new Error("אין הרשאה");

    const { resendApiKey, storeSender } = await import("@/lib/email.server");
    const apiKey = resendApiKey() ?? "";
    const sender = await storeSender();

    return {
      hasApiKey: apiKey !== "",
      // רק 4 תווים אחרונים, כדי לאמת שזה המפתח הנכון בלי לחשוף אותו
      apiKeyHint: apiKey === "" ? null : `••••${apiKey.slice(-4)}`,
      /** "שם החנות <orders@nuri1.fit>" */
      from: sender.from,
      senderName: sender.name,
      senderAddress: sender.address,
      senderDomain: sender.address.split("@")[1] ?? null,
      /** לאן מגיעות תשובות של לקוחות */
      replyTo: sender.replyTo,
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
