import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * "התראות מייל" בפאנל החנות (חלק 17) — רק מנהל החנות.
 *
 *  getStoreEmailProvider    — האם החנות חיברה חשבון Resend משלה (בלי המפתח עצמו)
 *  saveStoreEmailProvider   — שמירת מפתח + כתובת שולח, אחרי בדיקה מול Resend
 *  removeStoreEmailProvider — חזרה למערכת השליחה של הפלטפורמה
 *  listNotificationLogs     — יומן ההתראות האחרונות (הצלחה / כישלון / דילוג)
 *
 * המפתח נשמר בטבלה tenant_email_secrets — רק השרת קורא אותה. הדפדפן מקבל
 * לכל היותר את 4 התווים האחרונים שלו.
 */

export type StoreEmailProviderState = {
  /** החנות חיברה חשבון Resend משלה */
  configured: boolean;
  /** "re_••••abcd" */
  keyHint: string | null;
  senderEmail: string | null;
  domainStatus: "verified" | "unverified" | "unknown" | null;
  checkedAt: string | null;
  /** הכישלון האחרון בשליחה דרך המפתח של החנות (אז נשלח דרך הפלטפורמה) */
  lastError: string | null;
  lastErrorAt: string | null;
  updatedAt: string | null;
  /** מערכת השליחה של הפלטפורמה — הגיבוי (וברירת המחדל) */
  platformReady: boolean;
  /** הדומיין של הפלטפורמה — אי אפשר לבחור כתובת שולח עליו */
  platformDomain: string;
};

export type NotificationLogEntry = {
  id: string;
  orderId: string | null;
  orderNumber: string | null;
  template: "order_confirmation" | "order_staff" | "order_shipped" | "test";
  recipient: string;
  subject: string;
  status: "sent" | "failed" | "skipped";
  provider: "tenant" | "platform" | null;
  error: string | null;
  sentAt: string;
};

const EMAIL_FORMAT = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

async function requireStoreAdmin(userId: string): Promise<void> {
  const { loadCaller } = await import("@/lib/caller.server");
  const caller = await loadCaller(userId);
  if (caller.role !== "admin") throw new Error("רק מנהל החנות יכול לנהל את התראות המייל");
}

async function loadState(): Promise<StoreEmailProviderState> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { resendApiKey, systemSenderDomain } = await import("@/lib/email.server");
  const { resendKeyHint } = await import("@/server/services/notifications");
  const { data, error } = await supabaseAdmin
    .from("tenant_email_secrets")
    .select(
      "resend_api_key, sender_email, domain_status, checked_at, last_error, last_error_at, updated_at",
    )
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    configured: Boolean(data),
    keyHint: data ? resendKeyHint(data.resend_api_key) : null,
    senderEmail: data?.sender_email ?? null,
    domainStatus: data?.domain_status ?? null,
    checkedAt: data?.checked_at ?? null,
    lastError: data?.last_error ?? null,
    lastErrorAt: data?.last_error_at ?? null,
    updatedAt: data?.updated_at ?? null,
    platformReady: resendApiKey() !== null,
    platformDomain: systemSenderDomain(),
  };
}

export const getStoreEmailProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }): Promise<StoreEmailProviderState> => {
    await requireStoreAdmin(context.userId);
    return loadState();
  });

/**
 * שמירת חשבון ה-Resend של החנות. apiKey ריק = שמירת המפתח הקיים (רק החלפת
 * כתובת השולח). לפני השמירה המפתח נבדק מול Resend — מפתח שגוי או דומיין
 * שלא נמצא בחשבון לא נשמרים.
 */
export const saveStoreEmailProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { apiKey?: string; senderEmail: string }) => {
    const apiKey = String(input?.apiKey ?? "").trim();
    const senderEmail = String(input?.senderEmail ?? "")
      .trim()
      .toLowerCase();
    if (apiKey.length > 220) throw new Error("מפתח ה-API ארוך מדי");
    if (!EMAIL_FORMAT.test(senderEmail) || senderEmail.length > 254) {
      throw new Error("כתובת השולח אינה תקינה (למשל orders@my-shop.co.il)");
    }
    return { apiKey, senderEmail };
  })
  .handler(
    async ({ data, context }): Promise<{ state: StoreEmailProviderState; message: string }> => {
      await requireStoreAdmin(context.userId);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { currentTenantId } = await import("@/integrations/supabase/tenant.server");
      const { allowAction } = await import("@/lib/rate-limit.server");
      const { systemSenderDomain } = await import("@/lib/email.server");
      const { checkResendKey, RESEND_KEY_FORMAT } = await import("@/server/services/notifications");

      const domain = data.senderEmail.split("@")[1] ?? "";
      const platformDomain = systemSenderDomain();
      if (domain === platformDomain || domain.endsWith(`.${platformDomain}`)) {
        throw new Error(
          `כתובת על ${platformDomain} שייכת למערכת השליחה של הפלטפורמה — בחרו כתובת על הדומיין שלכם, שאומת בחשבון ה-Resend שלכם`,
        );
      }
      if (!allowAction(`store-email-key:${currentTenantId()}`, 10, 60 * 60 * 1000)) {
        throw new Error("יותר מדי ניסיונות בשעה האחרונה. נסו שוב מאוחר יותר.");
      }

      let apiKey = data.apiKey;
      if (apiKey === "") {
        const { data: existing } = await supabaseAdmin
          .from("tenant_email_secrets")
          .select("resend_api_key")
          .maybeSingle();
        if (!existing) throw new Error("הדביקו את מפתח ה-API מחשבון ה-Resend שלכם");
        apiKey = existing.resend_api_key;
      } else if (!RESEND_KEY_FORMAT.test(apiKey)) {
        throw new Error("מפתח API של Resend מתחיל ב-re_ (העתיקו אותו מ-API Keys בחשבון ה-Resend)");
      }

      const check = await checkResendKey(apiKey, data.senderEmail);
      if (!check.ok) throw new Error(check.error);

      const nowIso = new Date().toISOString();
      const { error } = await supabaseAdmin.from("tenant_email_secrets").upsert(
        {
          tenant_id: currentTenantId(),
          resend_api_key: apiKey,
          sender_email: data.senderEmail,
          domain_status: check.domainStatus,
          checked_at: nowIso,
          last_error: null,
          last_error_at: null,
          updated_at: nowIso,
          updated_by: context.userId,
        },
        { onConflict: "tenant_id" },
      );
      if (error) throw new Error(error.message);
      console.log(
        `[notifications] store Resend key saved (${currentTenantId()}): ${data.senderEmail} · ${check.domainStatus}`,
      );
      return { state: await loadState(), message: check.message };
    },
  );

/** הסרת המפתח — המיילים חוזרים לצאת דרך מערכת השליחה של הפלטפורמה */
export const removeStoreEmailProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }): Promise<StoreEmailProviderState> => {
    await requireStoreAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("tenant_email_secrets").delete();
    if (error) throw new Error(error.message);
    return loadState();
  });

/** יומן ההתראות — האחרונות קודם */
export const listNotificationLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { status?: string; limit?: number } | undefined) => {
    const status = ["sent", "failed", "skipped"].includes(String(input?.status))
      ? (String(input?.status) as "sent" | "failed" | "skipped")
      : null;
    const limit = Math.min(Math.max(Math.trunc(Number(input?.limit) || 50), 1), 200);
    return { status, limit };
  })
  .handler(async ({ data, context }): Promise<NotificationLogEntry[]> => {
    await requireStoreAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let query = supabaseAdmin
      .from("notification_logs")
      .select(
        "id, order_id, template, recipient, subject, status, provider, error, sent_at, orders ( order_number )",
      )
      .order("sent_at", { ascending: false })
      .limit(data.limit);
    if (data.status) query = query.eq("status", data.status);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return (
      (rows ?? []) as unknown as Array<{
        id: string;
        order_id: string | null;
        template: NotificationLogEntry["template"];
        recipient: string;
        subject: string;
        status: NotificationLogEntry["status"];
        provider: NotificationLogEntry["provider"];
        error: string | null;
        sent_at: string;
        orders: { order_number: string } | { order_number: string }[] | null;
      }>
    ).map((row) => {
      const order = Array.isArray(row.orders) ? row.orders[0] : row.orders;
      return {
        id: row.id,
        orderId: row.order_id,
        orderNumber: order?.order_number ?? null,
        template: row.template,
        recipient: row.recipient,
        subject: row.subject,
        status: row.status,
        provider: row.provider,
        error: row.error,
        sentAt: row.sent_at,
      };
    });
  });
