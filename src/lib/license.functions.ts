import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { licenseKeyProblem, normalizeLicenseKey } from "@/lib/shipping";

/**
 * "שלח רישיון" — מוצר דיגיטלי בהזמנה (מנהל החנות בלבד):
 *  1. שומר את מפתח הרישיון על השורה (digital_license_key)
 *  2. שולח ללקוח מייל עם המפתח (Resend, מהשולח של החנות)
 *  3. רק אם המייל יצא — הסטטוס של השורה "נמסר במייל" (+ מתי ולאן)
 * אם המייל נכשל — המפתח נשמר (הלקוח רואה אותו באזור האישי), הסטטוס נשאר
 * "ממתין להזנת רישיון", והמנהל מקבל את הסיבה ויכול לנסות שוב.
 * שליחה חוזרת (תיקון מפתח / הלקוח לא קיבל) — אותה פעולה.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SendLicenseResult =
  { sent: true; to: string; sentAt: string } | { sent: false; reason: string };

type ItemRow = {
  id: string;
  order_id: string;
  product_name: string | null;
  quantity: number;
  is_digital: boolean;
  is_deposit: boolean;
};

type OrderRow = {
  id: string;
  order_number: string;
  kind: string;
  status: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
};

export const sendDigitalLicense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { itemId: string; licenseKey: string }) => {
    const itemId = String(input?.itemId ?? "");
    if (!UUID.test(itemId)) throw new Error("שורה לא תקינה בהזמנה");
    const licenseKey = normalizeLicenseKey(String(input?.licenseKey ?? ""));
    const problem = licenseKeyProblem(licenseKey);
    if (problem) throw new Error(problem);
    return { itemId, licenseKey };
  })
  .handler(async ({ data, context }): Promise<SendLicenseResult> => {
    const { loadCaller } = await import("@/lib/caller.server");
    const caller = await loadCaller(context.userId);
    if (caller.role !== "admin") throw new Error("רק מנהל החנות יכול לשלוח רישיונות");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { currentTenantId, tenantSiteOrigin } =
      await import("@/integrations/supabase/tenant.server");
    const { allowAction } = await import("@/lib/rate-limit.server");
    const { sendEmail, renderEmailHtml, escapeHtml, emailActionButton, isValidEmail } =
      await import("@/lib/email.server");

    if (!allowAction(`license-send:${currentTenantId()}`, 120, 60 * 60 * 1000)) {
      throw new Error("נשלחו יותר מדי רישיונות בשעה האחרונה. נסו שוב מאוחר יותר.");
    }

    const { data: itemData, error: itemError } = await supabaseAdmin
      .from("order_items")
      .select("id, order_id, product_name, quantity, is_digital, is_deposit")
      .eq("id", data.itemId)
      .maybeSingle();
    if (itemError || !itemData) throw new Error("השורה לא נמצאה בהזמנה");
    const item = itemData as unknown as ItemRow;
    if (!item.is_digital || item.is_deposit) {
      throw new Error("רישיון נשלח רק למוצר דיגיטלי");
    }

    const { data: orderData, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("id, order_number, kind, status, customer_id, customer_name, customer_email")
      .eq("id", item.order_id)
      .maybeSingle();
    if (orderError || !orderData) throw new Error("ההזמנה לא נמצאה");
    const order = orderData as unknown as OrderRow;
    if (order.kind !== "order") {
      throw new Error("זו בקשה להצעת מחיר — קודם ממירים אותה להזמנה");
    }
    if (order.status === "cancelled") throw new Error("ההזמנה בוטלה — לא שולחים רישיון");

    // לאן: האימייל מהקופה, ואם אין (הזמנה ישנה) — האימייל של החשבון
    let to = order.customer_email?.trim() || "";
    if (!to && order.customer_id) {
      const { data: account } = await supabaseAdmin
        .from("user_roles")
        .select("email")
        .eq("user_id", order.customer_id)
        .maybeSingle();
      to = account?.email?.trim() || "";
    }
    if (!isValidEmail(to)) {
      throw new Error("אין להזמנה כתובת מייל תקינה — לא ניתן לשלוח את הרישיון");
    }

    // 1. המפתח נשמר לפני השליחה — גם אם המייל ייכשל, הוא לא הולך לאיבוד
    const { error: saveError } = await supabaseAdmin
      .from("order_items")
      .update({ digital_license_key: data.licenseKey })
      .eq("id", item.id);
    if (saveError) throw new Error(saveError.message);

    // 2. המייל
    let accountUrl: string | null = null;
    if (order.customer_id) {
      try {
        accountUrl = `${tenantSiteOrigin()}/account?tab=orders`;
      } catch {
        accountUrl = null;
      }
    }
    const productName = item.product_name?.trim() || "המוצר הדיגיטלי";
    const greeting = order.customer_name?.trim()
      ? `שלום ${escapeHtml(order.customer_name.trim())},`
      : "שלום,";
    const body = `
      <p>${greeting}</p>
      <p>תודה על ההזמנה <strong dir="ltr">${escapeHtml(order.order_number)}</strong>.
         זה מפתח הרישיון שלך עבור <strong>${escapeHtml(productName)}</strong>${item.quantity > 1 ? ` (${item.quantity} יח׳)` : ""}:</p>
      <div style="margin:18px 0;padding:16px;border:2px dashed #9C6F22;border-radius:10px;background:#fbf8f1;text-align:center;">
        <div dir="ltr" style="font-family:Consolas,Menlo,'Courier New',monospace;font-size:20px;font-weight:bold;letter-spacing:1px;color:#12211F;word-break:break-all;">${escapeHtml(data.licenseKey)}</div>
      </div>
      <p>מומלץ לשמור את המפתח במקום בטוח.${accountUrl ? " הוא שמור גם באזור האישי שלך, בפרטי ההזמנה." : ""}</p>
      ${accountUrl ? emailActionButton("להזמנות שלי", accountUrl) : ""}
    `;
    const result = await sendEmail({
      to: [to],
      subject: `מפתח הרישיון שלך — ${productName} (הזמנה ${order.order_number})`,
      html: await renderEmailHtml("מפתח הרישיון שלך", body),
      ...(order.customer_id
        ? { logFor: { userId: order.customer_id, kind: "order" as const, sentBy: context.userId } }
        : {}),
    });

    if (!result.sent) {
      console.error(
        `[license] email for ${order.order_number} item ${item.id} failed: ${result.reason ?? "unknown"}`,
      );
      return {
        sent: false,
        reason: `המפתח נשמר, אבל המייל לא נשלח: ${result.reason ?? "שגיאה לא ידועה"}`,
      };
    }

    // 3. נמסר במייל
    const sentAt = new Date().toISOString();
    const { error: statusError } = await supabaseAdmin
      .from("order_items")
      .update({ item_status: "delivered_email", license_sent_at: sentAt, license_sent_to: to })
      .eq("id", item.id);
    if (statusError) throw new Error(statusError.message);

    console.log(`[license] sent for ${order.order_number} item ${item.id}`);
    return { sent: true, to, sentAt };
  });
