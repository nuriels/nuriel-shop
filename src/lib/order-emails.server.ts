/**
 * מיילי הזמנה / בקשת הצעת מחיר — צד שרת בלבד.
 *
 * סיכום מלא לסוכן המשויך ולמנהלים שנבחרו בהגדרות המייל, ואישור ללקוח
 * (או לאורח — לאימייל שמילא בקופה). לכל המיילים מצורף מסמך PDF.
 * משותף ל-sendOrderEmails (לקוח מחובר / צוות) ולהזמנת אורח בקופה.
 * כשלון שליחה לא מבטל את ההזמנה — היא כבר נשמרה במסד.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendEmail, renderEmailHtml, escapeHtml, emailActionButton } from "@/lib/email.server";
import { loadOrderDocument } from "@/lib/documents.server";
import { calculateVat } from "@/lib/vat";
import { formatUnitIls } from "@/lib/catalog";
import {
  ORDER_CONTACT_COLUMNS,
  billingOf,
  deliveryOf,
  type OrderContactFields,
} from "@/lib/order-details";
import {
  ORDER_SHIPPING_COLUMNS,
  hasShippingLine,
  orderShippingLabel,
  shippingWasFree,
  type OrderShippingFields,
} from "@/lib/shipping";
import { DEFAULT_STORE_NAME } from "@/lib/branding";
import { orderDiscount, orderDiscountLabel } from "@/lib/coupons";

type SendResult = { sent: boolean; reason?: string };

export async function sendOrderEmailsInternal(
  orderId: string,
  sentBy: string | null,
): Promise<{ staff: SendResult; customer: SendResult }> {
  const { order, customerEmail, customerName, agentEmail, agentName, pdf, isGuest } =
    await loadOrderDocument(orderId);

  const { data: customerProfile } = order.customer_id
    ? await supabaseAdmin
        .from("customer_profiles")
        .select("business_name, contact_name, phone, business_address, city, zip_code, tax_id")
        .eq("user_id", order.customer_id)
        .maybeSingle()
    : { data: null };

  const billing = billingOf(order, customerProfile, customerEmail);
  const delivery = deliveryOf(order, customerProfile);

  const recipientEmails = new Set<string>();
  if (agentEmail) recipientEmails.add(agentEmail);

  const { data: emailSettings } = await supabaseAdmin
    .from("email_settings")
    .select("notify_admin_user_ids")
    .eq("id", true)
    .maybeSingle();
  if (emailSettings?.notify_admin_user_ids?.length) {
    const { data: admins } = await supabaseAdmin
      .from("user_roles")
      .select("email")
      .in("user_id", emailSettings.notify_admin_user_ids);
    for (const admin of admins ?? []) if (admin.email) recipientEmails.add(admin.email);
  }

  const isQuote = order.kind === "quote";
  const documentLabel = isQuote ? "בקשה להצעת מחיר" : "הזמנה";

  const shippingAmount = hasShippingLine(order) ? Number(order.shipping_price ?? 0) : 0;
  // הנחת קופון (חלק 14) — כבר מופחתת ב-total של ההזמנה במסד
  const discount = order.kind === "quote" ? 0 : orderDiscount(order);
  const itemsTotal =
    order.order_items.reduce((sum, item) => sum + Number(item.unit_price) * item.quantity, 0) +
    shippingAmount -
    discount;
  const vat = isQuote
    ? null
    : calculateVat(itemsTotal, {
        pricesIncludeVat: order.prices_include_vat ?? true,
        vatRate: Number(order.vat_rate ?? 18),
      });

  const money = (value: number) => `₪${value.toFixed(2)}`;

  const itemsHtml = order.order_items
    .map((item) => {
      const cells = [
        escapeHtml(item.product_name ?? "מוצר"),
        escapeHtml(item.product_barcode ?? "—"),
        String(item.quantity),
        ...(isQuote
          ? []
          : [
              formatUnitIls(Number(item.unit_price)),
              money(Number(item.unit_price) * item.quantity),
            ]),
      ];
      return `<tr>${cells
        .map((cell) => `<td style="padding:6px 8px;border-bottom:1px solid #eee;">${cell}</td>`)
        .join("")}</tr>`;
    })
    .join("");

  // שורת המשלוח בטבלה (כלולה בסכום)
  const shippingLabel = orderShippingLabel(order);
  const shippingRowHtml = hasShippingLine(order)
    ? `<tr>${[
        escapeHtml(`משלוח: ${shippingLabel ?? "דמי משלוח"}`),
        "—",
        "1",
        ...(isQuote
          ? []
          : [
              shippingWasFree(order) ? "חינם" : money(shippingAmount),
              shippingWasFree(order) ? "חינם" : money(shippingAmount),
            ]),
      ]
        .map(
          (cell) =>
            `<td style="padding:6px 8px;border-bottom:1px solid #eee;background:#f7faf7;">${cell}</td>`,
        )
        .join("")}</tr>`
    : "";

  // שורת ההנחה בטבלה (כלולה בסכום)
  const discountRowHtml =
    discount > 0
      ? `<tr>${[
          escapeHtml(orderDiscountLabel(order)),
          "—",
          "1",
          `-${money(discount)}`,
          `-${money(discount)}`,
        ]
          .map(
            (cell) =>
              `<td style="padding:6px 8px;border-bottom:1px solid #eee;background:#f0fdf4;color:#15803d;">${cell}</td>`,
          )
          .join("")}</tr>`
      : "";

  const headers = ["מוצר", "ברקוד", "כמות", ...(isQuote ? [] : ["מחיר יחידה", 'סה"כ'])]
    .map((header) => `<th style="text-align:right;padding:6px 8px;">${header}</th>`)
    .join("");

  const totalsHtml = vat
    ? vat.showBreakdown
      ? `<p style="margin-top:12px;">סה"כ לפני מע"מ: ${money(vat.net)}<br/>מע"מ ${vat.vatRate}%: ${money(vat.vat)}<br/><strong>סה"כ לתשלום: ${money(vat.gross)}</strong></p>`
      : `<p style="margin-top:12px;"><strong>סה"כ לתשלום (כולל מע"מ): ${money(vat.gross)}</strong></p>`
    : `<p style="margin-top:12px;">מסמך זה אינו כולל מחירים. נציג ייצור קשר עם הצעת מחיר מותאמת.</p>`;

  // איסוף עצמי / דיגיטלי — אין כתובת משלוח; כתובת חלופית — מודגשת, כדי
  // שהמשלוח לא ייצא בטעות לכתובת החיוב
  const pickupAddress = order.shipping_kind === "pickup" ? await loadPickupAddress() : "";
  const deliveryHtml =
    order.shipping_kind === "pickup"
      ? `<div style="margin-top:12px;padding:10px 12px;border:1px solid #c4b5fd;border-radius:8px;background:#f5f3ff;">
        <p style="margin:0 0 4px;font-weight:bold;color:#5b21b6;">🏬 איסוף עצמי</p>
        <p style="margin:0;">${pickupAddress ? `מהכתובת: ${escapeHtml(pickupAddress)}` : "נעדכן כשההזמנה מוכנה לאיסוף."}</p>
      </div>`
      : order.shipping_kind === "digital"
        ? `<p><strong>משלוח:</strong> מוצרים דיגיטליים — הרישיונות יישלחו במייל נפרד.</p>`
        : delivery.isAlternate
          ? `<div style="margin-top:12px;padding:10px 12px;border:2px solid #d97706;border-radius:8px;background:#fffbeb;">
        <p style="margin:0 0 4px;font-weight:bold;color:#92400e;">📦 משלוח לכתובת אחרת</p>
        <p style="margin:0;">${escapeHtml(delivery.name)}${delivery.phone ? ` · <span dir="ltr">${escapeHtml(delivery.phone)}</span>` : ""}<br/>${escapeHtml(delivery.address)}</p>
      </div>`
          : delivery.address
            ? `<p><strong>כתובת למשלוח:</strong> ${escapeHtml(delivery.address)}</p>`
            : "";
  const shippingMethodHtml =
    shippingLabel && order.shipping_kind !== "digital"
      ? `<p><strong>שיטת משלוח:</strong> ${escapeHtml(shippingLabel)}${
          isQuote ? "" : ` · ${shippingWasFree(order) ? "חינם 🎉" : money(shippingAmount)}`
        }</p>`
      : "";

  const staffHtml = `
    <p><strong>מספר מסמך:</strong> ${escapeHtml(order.order_number)}</p>
    <p><strong>סוג:</strong> ${documentLabel}${isGuest ? " · <strong>אורח (ללא חשבון)</strong>" : ""}</p>
    <p><strong>לקוח:</strong> ${escapeHtml(billing.name)}${billing.taxId ? ` · ת.ז / ח.פ <span dir="ltr">${escapeHtml(billing.taxId)}</span>` : ""}</p>
    <p><strong>טלפון:</strong> <span dir="ltr">${escapeHtml(billing.phone)}</span> · <strong>אימייל:</strong> <span dir="ltr">${escapeHtml(billing.email)}</span></p>
    ${billing.address ? `<p><strong>כתובת:</strong> ${escapeHtml(billing.address)}</p>` : ""}
    ${shippingMethodHtml}
    ${deliveryHtml}
    ${order.note ? `<p><strong>הערות להזמנה:</strong> ${escapeHtml(order.note)}</p>` : ""}
    <table style="width:100%;border-collapse:collapse;margin-top:12px;">
      <thead><tr>${headers}</tr></thead>
      <tbody>${itemsHtml}${shippingRowHtml}${discountRowHtml}</tbody>
    </table>
    ${totalsHtml}
    <p style="margin-top:12px;color:#6b7280;font-size:13px;">המסמך המלא מצורף כקובץ PDF.</p>
  `;

  const greetingName = escapeHtml(customerName || billing.name);
  const customerHtml = isQuote
    ? `
    <p>שלום ${greetingName},</p>
    <p>בקשתכם להצעת מחיר <strong dir="ltr">${escapeHtml(order.order_number)}</strong> התקבלה.</p>
    <p>נציג יעבור על הפריטים ויחזור אליכם עם הצעת מחיר מותאמת.</p>
    ${totalsHtml}
    <p style="margin-top:12px;color:#6b7280;font-size:13px;">פירוט הפריטים מצורף כקובץ PDF.</p>
  `
    : `
    <p>שלום ${greetingName},</p>
    <p>ההזמנה שלכם <strong dir="ltr">${escapeHtml(order.order_number)}</strong> התקבלה ונשלחה לביצוע.</p>
    <p>${agentName ? `${escapeHtml(agentName)}, הסוכן המטפל שלכם, ייצור` : "נציג ייצור"} איתכם קשר בהקדם לתיאום המשך הטיפול.</p>
    ${shippingMethodHtml}
    ${deliveryHtml}
    ${discount > 0 ? `<p><strong>${escapeHtml(orderDiscountLabel(order))}:</strong> <span style="color:#15803d;">-${money(discount)}</span></p>` : ""}
    ${totalsHtml}
    <p style="margin-top:12px;color:#6b7280;font-size:13px;">אישור ההזמנה המלא מצורף כקובץ PDF.</p>
  `;

  const attachments = [{ filename: pdf.filename, content: pdf.base64 }];

  const staff: SendResult =
    recipientEmails.size > 0
      ? await sendEmail({
          to: [...recipientEmails],
          subject: `${documentLabel} חדשה ${order.order_number}${isGuest ? " (אורח)" : ""}`,
          html: await renderEmailHtml(`${documentLabel} חדשה התקבלה`, staffHtml),
          attachments,
        })
      : { sent: false, reason: "אין נמענים מוגדרים" };

  const customer: SendResult = customerEmail
    ? await sendEmail({
        to: [customerEmail],
        subject: `${documentLabel} ${order.order_number} התקבלה`,
        html: await renderEmailHtml(`${documentLabel} התקבלה`, customerHtml),
        attachments,
        // יומן המיילים בתיק הלקוח — רק ללקוח רשום (לאורח אין תיק)
        ...(order.customer_id
          ? {
              logFor: {
                userId: order.customer_id,
                kind: isQuote ? ("quote" as const) : ("order" as const),
                sentBy,
              },
            }
          : {}),
      })
    : { sent: false, reason: "אין כתובת מייל ללקוח" };

  // מלאי נמוך (חלק 14): אחרי כל הזמנה — מייל למנהל על מוצרים שירדו ל-3 ומטה
  if (!isQuote) {
    try {
      const { sendLowStockAlerts } = await import("@/lib/stock-alerts.server");
      await sendLowStockAlerts(orderId);
    } catch (error) {
      console.error("[stock-alerts] failed", order.order_number, error);
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

  return sendEmail({
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

/** כתובת האיסוף העצמי = כתובת העסק מהגדרות האתר */
async function loadPickupAddress(): Promise<string> {
  const { data } = await supabaseAdmin
    .from("site_settings")
    .select("business_address, business_name, site_title")
    .eq("id", true)
    .maybeSingle();
  const address = data?.business_address?.trim() ?? "";
  if (!address) return "";
  const name = data?.business_name?.trim() || data?.site_title?.trim() || DEFAULT_STORE_NAME;
  return `${name}, ${address}`;
}
