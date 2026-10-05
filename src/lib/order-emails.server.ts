/**
 * מיילי הזמנה / בקשת הצעת מחיר — צד שרת בלבד.
 *
 * סיכום מלא לסוכן המשויך ולמנהלים שנבחרו בהגדרות המייל, ואישור ללקוח
 * (או לאורח — לאימייל שמילא בקופה). לכל המיילים מצורף מסמך PDF.
 * משותף ל-sendOrderEmails (לקוח מחובר / צוות), להזמנת אורח בקופה ולתשלום
 * שאושר (Webhook / חזרה מ-Hyp).
 * כשלון שליחה לא מבטל את ההזמנה — היא כבר נשמרה במסד.
 *
 * חלק 17: אישור ההזמנה ללקוח — sendOrderEmail (src/server/services/notifications.ts):
 * דרך חשבון ה-Resend של החנות אם חובר, ובגיבוי — מפתח הפלטפורמה. כל ניסיון
 * (גם ההתראה לצוות ומייל "נשלחה") נרשם ב-notification_logs.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { renderEmailHtml, escapeHtml, emailActionButton } from "@/lib/email.server";
import {
  ORDER_CONTACT_COLUMNS,
  billingOf,
  deliveryOf,
  type OrderContactFields,
} from "@/lib/order-details";
import { ORDER_SHIPPING_COLUMNS, type OrderShippingFields } from "@/lib/shipping";
import { loadPickupAddress, prepareOrderEmail } from "@/lib/order-email-data.server";
import {
  logNotification,
  sendNotificationEmail,
  sendOrderEmail,
} from "@/server/services/notifications";

type SendResult = { sent: boolean; reason?: string };

export async function sendOrderEmailsInternal(
  orderId: string,
  sentBy: string | null,
): Promise<{ staff: SendResult; customer: SendResult }> {
  // חלק 16: הזמנה שממתינה לתשלום באשראי — המיילים (והתראת המלאי) יוצאים רק
  // אחרי שהתשלום אושר (src/server/services/payments.ts)
  const prepared = await prepareOrderEmail(orderId);
  if (!prepared) {
    const waiting = { sent: false, reason: "ההזמנה ממתינה לתשלום" };
    return { staff: waiting, customer: waiting };
  }

  const { isQuote, isGuest, documentLabel, billing, html: parts } = prepared;

  const staffHtml = `
    <p><strong>מספר מסמך:</strong> ${escapeHtml(prepared.orderNumber)}</p>
    <p><strong>סוג:</strong> ${documentLabel}${isGuest ? " · <strong>אורח (ללא חשבון)</strong>" : ""}</p>
    <p><strong>לקוח:</strong> ${escapeHtml(billing.name)}${billing.taxId ? ` · ת.ז / ח.פ <span dir="ltr">${escapeHtml(billing.taxId)}</span>` : ""}</p>
    <p><strong>טלפון:</strong> <span dir="ltr">${escapeHtml(billing.phone)}</span> · <strong>אימייל:</strong> <span dir="ltr">${escapeHtml(billing.email)}</span></p>
    ${billing.address ? `<p><strong>כתובת:</strong> ${escapeHtml(billing.address)}</p>` : ""}
    ${parts.shippingMethod}
    ${parts.delivery}
    ${prepared.note ? `<p><strong>הערות להזמנה:</strong> ${escapeHtml(prepared.note)}</p>` : ""}
    ${parts.staffTable}
    ${parts.totals}
    <p style="margin-top:12px;color:#6b7280;font-size:13px;">המסמך המלא מצורף כקובץ PDF.</p>
  `;

  // התראה פנימית לצוות החנות — תמיד דרך מערכת השליחה של הפלטפורמה
  const staffSubject = `${documentLabel} חדשה ${prepared.orderNumber}${isGuest ? " (אורח)" : ""}`;
  let staff: SendResult;
  if (prepared.staffRecipients.length > 0) {
    staff = await sendNotificationEmail({
      template: "order_staff",
      orderId,
      to: prepared.staffRecipients,
      subject: staffSubject,
      html: await renderEmailHtml(`${documentLabel} חדשה התקבלה`, staffHtml),
      attachments: prepared.attachments,
      useStoreKey: false,
    });
  } else {
    staff = { sent: false, reason: "אין נמענים מוגדרים" };
    await logNotification(
      { template: "order_staff", orderId, to: [], subject: staffSubject },
      {
        sent: false,
        skipped: true,
        reason: 'לא נבחרו מנהלים לקבלת התראה — סמנו אותם ב"מנהלים שיקבלו התראה על כל הזמנה חדשה"',
      },
      null,
    );
  }

  // אישור ההזמנה ללקוח (חלק 17)
  const customer: SendResult = await sendOrderEmail(orderId, { sentBy, prepared });

  // מלאי נמוך (חלק 14): אחרי כל הזמנה — מייל למנהל על מוצרים שירדו ל-3 ומטה
  if (!isQuote) {
    try {
      const { sendLowStockAlerts } = await import("@/lib/stock-alerts.server");
      await sendLowStockAlerts(orderId);
    } catch (error) {
      console.error("[stock-alerts] failed", prepared.orderNumber, error);
    }
  }

  return { staff, customer };
}

/**
 * מייל "ההזמנה יצאה למשלוח" ללקוח (או לאורח, לאימייל שמילא בקופה) — אחרי
 * סימון כ"נשלחה", גם בפעולה מרוכזת על כמה הזמנות. בלי PDF (המסמך כבר
 * נשלח עם אישור ההזמנה): פריטים, כתובת המשלוח וקישור ל"ההזמנות שלי".
 *
 */
export async function sendShippedEmailInternal(
  orderId: string,
  sentBy: string | null,
): Promise<SendResult> {
  const { data: orderData, error } = await supabaseAdmin
    .from("orders")
    .select(
      `id, order_number, customer_id, kind, status, ${ORDER_CONTACT_COLUMNS}, ${ORDER_SHIPPING_COLUMNS}, order_items (product_name, quantity, is_deposit, is_gift, is_digital)`,
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error || !orderData) return { sent: false, reason: "ההזמנה לא נמצאה" };
  const order = orderData as unknown as OrderContactFields &
    OrderShippingFields & {
      id: string;
      order_number: string;
      customer_id: string | null;
      kind: string;
      status: string;
      order_items: {
        product_name: string | null;
        quantity: number;
        is_deposit: boolean;
        is_gift: boolean | null;
        is_digital: boolean | null;
      }[];
    };
  if (order.kind !== "order") return { sent: false, reason: "בקשה להצעת מחיר — אין משלוח" };
  // מוצרים דיגיטליים נשלחים במייל הרישיון — אין כאן מה "לשלוח"
  const physical = order.order_items.filter((item) => !item.is_deposit && !item.is_digital);
  if (physical.length === 0) return { sent: false, reason: "הזמנה דיגיטלית — אין משלוח פיזי" };
  const isPickup = order.shipping_kind === "pickup";

  const [{ data: customerRole }, { data: customerProfile }] = await Promise.all([
    order.customer_id
      ? supabaseAdmin
          .from("user_roles")
          .select("email")
          .eq("user_id", order.customer_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    order.customer_id
      ? supabaseAdmin
          .from("customer_profiles")
          .select("business_name, contact_name, phone, business_address, city, zip_code, tax_id")
          .eq("user_id", order.customer_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const billing = billingOf(order, customerProfile, customerRole?.email ?? null);
  const delivery = deliveryOf(order, customerProfile);
  const to = billing.email;
  if (!to) return { sent: false, reason: "אין כתובת מייל ללקוח" };

  // קישור לאזור האישי — רק ללקוח רשום (לאורח אין חשבון)
  let accountUrl: string | null = null;
  if (order.customer_id) {
    try {
      const { tenantSiteOrigin } = await import("@/integrations/supabase/tenant.server");
      accountUrl = `${tenantSiteOrigin()}/account?tab=orders`;
    } catch {
      accountUrl = null;
    }
  }

  const itemsHtml = physical
    .map(
      (item) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(item.product_name ?? "מוצר")}${item.is_gift ? " 🎁" : ""}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;white-space:nowrap;">${item.quantity} יח׳</td></tr>`,
    )
    .join("");

  const pickupAddress = isPickup ? await loadPickupAddress() : "";
  const deliveryHtml = isPickup
    ? `<div style="margin-top:12px;padding:10px 12px;border:1px solid #c4b5fd;border-radius:8px;background:#f5f3ff;">
        <p style="margin:0 0 4px;font-weight:bold;color:#5b21b6;">🏬 איסוף עצמי</p>
        <p style="margin:0;">${pickupAddress ? `הכתובת לאיסוף: ${escapeHtml(pickupAddress)}` : "לתיאום האיסוף — צרו איתנו קשר."}</p>
      </div>`
    : delivery.address
      ? `<div style="margin-top:12px;padding:10px 12px;border:1px solid #e2e8e2;border-radius:8px;background:#f7faf7;">
        <p style="margin:0 0 4px;font-weight:bold;">📦 כתובת המשלוח</p>
        <p style="margin:0;">${escapeHtml(delivery.name)}${delivery.phone ? ` · <span dir="ltr">${escapeHtml(delivery.phone)}</span>` : ""}<br/>${escapeHtml(delivery.address)}</p>
      </div>`
      : "";

  const greetingName = escapeHtml(
    delivery.isAlternate ? billing.name : delivery.name || billing.name,
  );
  const body = `
    <p>שלום ${greetingName},</p>
    ${
      isPickup
        ? `<p>ההזמנה שלכם <strong dir="ltr">${escapeHtml(order.order_number)}</strong> מוכנה לאיסוף 🏬</p>`
        : `<p>ההזמנה שלכם <strong dir="ltr">${escapeHtml(order.order_number)}</strong> יצאה למשלוח 🚚</p>
    <p>השליח ייצור קשר לפני ההגעה, אם יהיה צורך.</p>`
    }
    ${deliveryHtml}
    ${
      itemsHtml
        ? `<table style="width:100%;border-collapse:collapse;margin-top:12px;">
            <thead><tr><th style="text-align:right;padding:6px 8px;">מוצר</th><th style="text-align:right;padding:6px 8px;">כמות</th></tr></thead>
            <tbody>${itemsHtml}</tbody>
          </table>`
        : ""
    }
    ${accountUrl ? emailActionButton("למעקב אחרי ההזמנה", accountUrl) : ""}
  `;

  // ללקוח — דרך חשבון ה-Resend של החנות אם חובר (חלק 17), ונרשם ביומן ההתראות
  return sendNotificationEmail({
    template: "order_shipped",
    orderId,
    to: [to],
    subject: isPickup
      ? `הזמנה ${order.order_number} מוכנה לאיסוף`
      : `הזמנה ${order.order_number} יצאה למשלוח`,
    html: await renderEmailHtml(isPickup ? "ההזמנה מוכנה לאיסוף" : "ההזמנה יצאה למשלוח", body),
    ...(order.customer_id
      ? { logFor: { userId: order.customer_id, kind: "order" as const, sentBy } }
      : {}),
  });
}
