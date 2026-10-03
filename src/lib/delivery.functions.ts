import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * משלוחים ושליחים — פעולות שרת.
 *
 * צוות (מחובר):
 *   markOrdersShipped — סימון מרוכז כ"נשלחה" + מייל "יצאה למשלוח" לכל לקוח,
 *   מהשולח של החנות ("שם החנות <orders@nuri1.fit>").
 *   (מסירה לשליח וקישורי שליח — ישירות מהדפדפן ב-RPC assign_order_courier,
 *   שרץ עם הרשאות המשתמש: RLS + is_staff.)
 *
 * שליח (בלי התחברות, לפי טוקן סודי בקישור):
 *   courierGetDelivery / courierReport — נקראים מ-/courier/$token. במסד
 *   הפונקציות פתוחות רק ל-service_role, והחנות נקבעת לפי הדומיין — קישור
 *   של חנות אחת לא עובד באתר של חנות אחרת.
 */

const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{32,64}$/;

/** כמה הזמנות בפעולה מרוכזת אחת (כמו ב-assign_order_courier) */
export const MAX_BULK_ORDERS = 200;
/** עד כמה מיילים נשלחים "בזמן אמת" (עם דיווח מדויק); מעבר לזה — ברקע */
const INLINE_EMAILS = 10;
/** Resend מגביל ל-2 בקשות בשנייה כברירת מחדל */
const EMAIL_SPACING_MS = 600;

function cleanOrderIds(value: unknown): string[] {
  const ids = Array.isArray(value) ? value.map((id) => String(id ?? "").trim()) : [];
  const unique = [...new Set(ids.filter((id) => UUID_FORMAT.test(id)))];
  if (unique.length === 0) throw new Error("לא נבחרו הזמנות");
  if (unique.length > MAX_BULK_ORDERS) {
    throw new Error(`אפשר לעדכן עד ${MAX_BULK_ORDERS} הזמנות בפעולה אחת`);
  }
  return unique;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type MarkShippedResult = {
  updated: { id: string; order_number: string }[];
  skipped: { order_number: string; reason: string }[];
  /** הזמנות שנבחרו ולא נמצאו (נמחקו / אין הרשאה) */
  missing: number;
  emails: {
    /** נשלחו בפועל (במצב ברקע — 0, הדיווח בלוג השרת וביומן המיילים) */
    sent: number;
    failed: number;
    /** כמה הזמנות בלי כתובת מייל */
    noAddress: number;
    background: boolean;
    /** הסבר כשמיילים לא יצאו בכלל (אין מפתח / אין כתובת שולחת) */
    warning: string | null;
    firstError: string | null;
  };
};

/**
 * סימון מרוכז כ"נשלחה" + מייל ללקוחות.
 * הקריאה והעדכון — עם החיבור של המשתמש (RLS: סוכן רק ללקוחות שלו).
 * מדלג על בקשות להצעת מחיר ועל הזמנות שבוטלו / כבר נשלחו / נמסרו.
 */
export const markOrdersShipped = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderIds: string[]; notify?: boolean }) => ({
    orderIds: cleanOrderIds(input?.orderIds),
    notify: input?.notify !== false,
  }))
  .handler(async ({ data, context }): Promise<MarkShippedResult> => {
    const { loadCaller } = await import("@/lib/caller.server");
    const caller = await loadCaller(context.userId);
    if (caller.role !== "admin" && caller.role !== "agent") {
      throw new Error("אין הרשאה לעדכן הזמנות");
    }

    const { data: rows, error } = await context.supabase
      .from("orders")
      .select("id, order_number, status, kind")
      .in("id", data.orderIds);
    if (error) throw new Error(error.message);

    const skipped: MarkShippedResult["skipped"] = [];
    const eligible: string[] = [];
    for (const row of rows ?? []) {
      if (row.kind !== "order") {
        skipped.push({ order_number: row.order_number, reason: "בקשה להצעת מחיר" });
      } else if (row.status === "cancelled") {
        skipped.push({ order_number: row.order_number, reason: "ההזמנה בוטלה" });
      } else if (row.status === "shipped") {
        skipped.push({ order_number: row.order_number, reason: "כבר סומנה כנשלחה" });
      } else if (row.status === "delivered") {
        skipped.push({ order_number: row.order_number, reason: "כבר נמסרה" });
      } else {
        eligible.push(row.id);
      }
    }

    let updated: MarkShippedResult["updated"] = [];
    if (eligible.length > 0) {
      const { data: changed, error: updateError } = await context.supabase
        .from("orders")
        .update({ status: "shipped" })
        .in("id", eligible)
        // הגנה ממרוץ: מישהו ביטל / סימן בינתיים
        .not("status", "in", "(cancelled,shipped,delivered)")
        .select("id, order_number");
      if (updateError) throw new Error(updateError.message);
      updated = changed ?? [];
    }

    const emails: MarkShippedResult["emails"] = {
      sent: 0,
      failed: 0,
      noAddress: 0,
      background: false,
      warning: null,
      firstError: null,
    };

    if (data.notify && updated.length > 0) {
      const { resendApiKey } = await import("@/lib/email.server");
      const { sendShippedEmailInternal } = await import("@/lib/order-emails.server");

      if (!resendApiKey()) {
        emails.warning =
          "הסטטוס עודכן, אבל מיילים לא נשלחו: מפתח Resend (RESEND_API_KEY) לא הוגדר בשרת";
      } else {
        const ids = updated.map((order) => order.id);
        const sendAll = async () => {
          for (const [index, orderId] of ids.entries()) {
            if (index > 0) await sleep(EMAIL_SPACING_MS);
            try {
              const result = await sendShippedEmailInternal(orderId, context.userId);
              if (result.sent) emails.sent += 1;
              else if (result.reason === "אין כתובת מייל ללקוח") emails.noAddress += 1;
              else {
                emails.failed += 1;
                emails.firstError ??= result.reason ?? null;
              }
            } catch (sendError) {
              emails.failed += 1;
              emails.firstError ??=
                sendError instanceof Error ? sendError.message : "שליחת המייל נכשלה";
            }
          }
        };

        if (ids.length <= INLINE_EMAILS) {
          await sendAll();
        } else {
          // הרבה הזמנות: לא מחזיקים את הבקשה דקות — ממשיכים ברקע (באותו
          // הקשר חנות), והתוצאה נרשמת בלוג ובתיק הלקוח (יומן מיילים)
          emails.background = true;
          void sendAll()
            .then(() =>
              console.info(
                `[delivery] shipped emails: ${emails.sent} sent, ${emails.failed} failed, ${emails.noAddress} without address`,
              ),
            )
            .catch((bgError: unknown) =>
              console.error("[delivery] shipped emails failed", bgError),
            );
        }
      }
    }

    return {
      updated,
      skipped,
      missing: data.orderIds.length - (rows?.length ?? 0),
      emails: { ...emails },
    };
  });

/** מה שהשליח רואה בקישור — לפי מצב ההזמנה */
export type CourierDelivery =
  | { state: "invalid" }
  | { state: "delivered"; order_number: string; delivered_at: string | null }
  | { state: "closed" | "expired"; order_number: string }
  | {
      state: "active";
      order_number: string;
      recipient_name: string | null;
      customer_name: string | null;
      recipient_phone: string | null;
      street: string | null;
      city: string | null;
      zip: string | null;
      alternate_address: boolean;
      note: string | null;
      items: number;
      units: number;
      attempts: number;
      last_failure_note: string | null;
      last_failure_at: string | null;
      courier_name: string | null;
      expires_at: string;
      store_name: string | null;
      store_phone: string | null;
    };

async function courierRateLimit(action: "view" | "report"): Promise<void> {
  const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
  const ip = await requestIp();
  const allowed =
    action === "view"
      ? allowAction(`courier-view:${ip}`, 120, 10 * 60_000)
      : allowAction(`courier-report:${ip}`, 30, 10 * 60_000);
  if (!allowed) throw new Error("יותר מדי פניות — נסו שוב בעוד כמה דקות");
}

/** פרטי המשלוח לשליח (בלי התחברות). פרטים אישיים רק כשההזמנה ממתינה לשליח */
export const courierGetDelivery = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => ({ token: String(input?.token ?? "").trim() }))
  .handler(async ({ data }): Promise<CourierDelivery> => {
    if (!TOKEN_FORMAT.test(data.token)) return { state: "invalid" };
    await courierRateLimit("view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc("courier_delivery", {
      _token: data.token,
    });
    if (error) {
      console.error("[courier] courier_delivery failed", error.message);
      throw new Error("טעינת פרטי המשלוח נכשלה — נסו לרענן");
    }
    return result as unknown as CourierDelivery;
  });

export type CourierReportResult = {
  status: "delivered" | "awaiting_courier";
  attempts: number;
  order_number: string;
};

/** דיווח השליח: נמסר, או משלוח נכשל (חוזר ל"ממתינה לשליח" והמונה עולה) */
export const courierReport = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string; delivered: boolean; note?: string }) => ({
    token: String(input?.token ?? "").trim(),
    delivered: input?.delivered === true,
    note: String(input?.note ?? "")
      .trim()
      .slice(0, 300),
  }))
  .handler(async ({ data }): Promise<CourierReportResult> => {
    if (!TOKEN_FORMAT.test(data.token)) throw new Error("הקישור לא תקין");
    await courierRateLimit("report");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result, error } = await supabaseAdmin.rpc("courier_report", {
      _token: data.token,
      _delivered: data.delivered,
      _note: data.note || null,
    });
    // הודעות השגיאה מהמסד כתובות לשליח ("כבר נמסרה", "תוקף הקישור פג"...)
    if (error) throw new Error(error.message);
    return result as unknown as CourierReportResult;
  });
