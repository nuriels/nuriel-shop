/**
 * מיילי הזמנה / בקשת הצעת מחיר — צד שרת בלבד.
 *
 * סיכום מלא לסוכן המשויך ולמנהלים שנבחרו בהגדרות המייל, ואישור ללקוח
 * (או לאורח — לאימייל שמילא בקופה). לכל המיילים מצורף מסמך PDF.
 * משותף ל-sendOrderEmails (לקוח מחובר / צוות) ולהזמנת אורח בקופה.
 * כשלון שליחה לא מבטל את ההזמנה — היא כבר נשמרה במסד.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendEmail, renderEmailHtml, escapeHtml } from "@/lib/email.server";
import { loadOrderDocument } from "@/lib/documents.server";
import { calculateVat } from "@/lib/vat";
import { formatUnitIls } from "@/lib/catalog";
import { billingOf, deliveryOf } from "@/lib/order-details";

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
    .select("sender_email, notify_admin_user_ids")
    .eq("id", true)
    .maybeSingle();
  if (emailSettings?.notify_admin_user_ids?.length) {
    const { data: admins } = await supabaseAdmin
      .from("user_roles")
      .select("email")
      .in("user_id", emailSettings.notify_admin_user_ids);
    for (const admin of admins ?? []) if (admin.email) recipientEmails.add(admin.email);
  }

  const senderEmail = emailSettings?.sender_email?.trim() || "";
  const isQuote = order.kind === "quote";
  const documentLabel = isQuote ? "בקשה להצעת מחיר" : "הזמנה";

  const itemsTotal = order.order_items.reduce(
    (sum, item) => sum + Number(item.unit_price) * item.quantity,
    0,
  );
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

  const headers = ["מוצר", "ברקוד", "כמות", ...(isQuote ? [] : ["מחיר יחידה", 'סה"כ'])]
    .map((header) => `<th style="text-align:right;padding:6px 8px;">${header}</th>`)
    .join("");

  const totalsHtml = vat
    ? vat.showBreakdown
      ? `<p style="margin-top:12px;">סה"כ לפני מע"מ: ${money(vat.net)}<br/>מע"מ ${vat.vatRate}%: ${money(vat.vat)}<br/><strong>סה"כ לתשלום: ${money(vat.gross)}</strong></p>`
      : `<p style="margin-top:12px;"><strong>סה"כ לתשלום (כולל מע"מ): ${money(vat.gross)}</strong></p>`
    : `<p style="margin-top:12px;">מסמך זה אינו כולל מחירים. נציג ייצור קשר עם הצעת מחיר מותאמת.</p>`;

  // כתובת חלופית — מודגשת, כדי שהמשלוח לא ייצא בטעות לכתובת החיוב
  const deliveryHtml = delivery.isAlternate
    ? `<div style="margin-top:12px;padding:10px 12px;border:2px solid #d97706;border-radius:8px;background:#fffbeb;">
        <p style="margin:0 0 4px;font-weight:bold;color:#92400e;">📦 משלוח לכתובת אחרת</p>
        <p style="margin:0;">${escapeHtml(delivery.name)}${delivery.phone ? ` · <span dir="ltr">${escapeHtml(delivery.phone)}</span>` : ""}<br/>${escapeHtml(delivery.address)}</p>
      </div>`
    : delivery.address
      ? `<p><strong>כתובת למשלוח:</strong> ${escapeHtml(delivery.address)}</p>`
      : "";

  const staffHtml = `
    <p><strong>מספר מסמך:</strong> ${escapeHtml(order.order_number)}</p>
    <p><strong>סוג:</strong> ${documentLabel}${isGuest ? " · <strong>אורח (ללא חשבון)</strong>" : ""}</p>
    <p><strong>לקוח:</strong> ${escapeHtml(billing.name)}${billing.taxId ? ` · ת.ז / ח.פ <span dir="ltr">${escapeHtml(billing.taxId)}</span>` : ""}</p>
    <p><strong>טלפון:</strong> <span dir="ltr">${escapeHtml(billing.phone)}</span> · <strong>אימייל:</strong> <span dir="ltr">${escapeHtml(billing.email)}</span></p>
    ${billing.address ? `<p><strong>כתובת:</strong> ${escapeHtml(billing.address)}</p>` : ""}
    ${deliveryHtml}
    ${order.note ? `<p><strong>הערות להזמנה:</strong> ${escapeHtml(order.note)}</p>` : ""}
    <table style="width:100%;border-collapse:collapse;margin-top:12px;">
      <thead><tr>${headers}</tr></thead>
      <tbody>${itemsHtml}</tbody>
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
    ${deliveryHtml}
    ${totalsHtml}
    <p style="margin-top:12px;color:#6b7280;font-size:13px;">אישור ההזמנה המלא מצורף כקובץ PDF.</p>
  `;

  const attachments = [{ filename: pdf.filename, content: pdf.base64 }];

  const staff: SendResult =
    recipientEmails.size > 0
      ? await sendEmail({
          from: senderEmail,
          to: [...recipientEmails],
          subject: `${documentLabel} חדשה ${order.order_number}${isGuest ? " (אורח)" : ""}`,
          html: await renderEmailHtml(`${documentLabel} חדשה התקבלה`, staffHtml),
          attachments,
        })
      : { sent: false, reason: "אין נמענים מוגדרים" };

  const customer: SendResult = customerEmail
    ? await sendEmail({
        from: senderEmail,
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

  return { staff, customer };
}
