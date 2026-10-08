/**
 * הנתונים של מייל הזמנה / בקשת הצעת מחיר — צד שרת בלבד.
 *
 * נטען פעם אחת ומשמש את שני המיילים שיוצאים עם כל הזמנה:
 *  - ההתראה לצוות (src/lib/order-emails.server.ts)
 *  - אישור ההזמנה ללקוח (sendOrderEmail — src/server/services/notifications.ts)
 * כולל את מסמך ה-PDF המצורף, סיכום העגלה, פרטי המשלוח והסכומים.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { escapeHtml, type EmailAttachment } from "@/lib/email.server";
import { loadOrderDocument } from "@/lib/documents.server";
import { calculateVat, type VatBreakdown } from "@/lib/vat";
import { formatUnitIls } from "@/lib/catalog";
import { billingOf, deliveryOf, type OrderBilling, type OrderDelivery } from "@/lib/order-details";
import { hasShippingLine, orderShippingLabel, shippingWasFree } from "@/lib/shipping";
import { DEFAULT_STORE_NAME } from "@/lib/branding";
import { orderDiscount, orderDiscountLabel } from "@/lib/coupons";
import type { PaymentMethod, PaymentStatus } from "@/lib/bit-payments";

export type OrderEmailLine = {
  name: string;
  barcode: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  digital: boolean;
};

export type PreparedOrderEmail = {
  orderId: string;
  orderNumber: string;
  createdAt: string;
  customerId: string | null;
  kind: "order" | "quote";
  isQuote: boolean;
  /** הזמנת אורח — אין חשבון */
  isGuest: boolean;
  /** "הזמנה" / "בקשה להצעת מחיר" */
  documentLabel: string;
  /** לאן נשלח אישור ההזמנה ללקוח (null = אין) */
  customerEmail: string | null;
  /** השם שבפתיחת המייל ללקוח (לא מקודד) */
  greetingName: string;
  agentName: string | null;
  /** הסוכן המשויך + המנהלים שנבחרו בהגדרות המייל */
  staffRecipients: string[];
  billing: OrderBilling;
  delivery: OrderDelivery;
  shippingKind: string | null;
  /** איסוף עצמי: "שם העסק, הכתובת" ("" = לא הוגדרה / לא איסוף) */
  pickupAddress: string;
  note: string | null;
  /** חלק 16 / 17ב: איך משלמים ומה המצב (טלפוני / אשראי / ביט) */
  payment: {
    method: PaymentMethod;
    status: PaymentStatus;
    /** ביט: מספר האסמכתא שהלקוח הזין */
    bitReference: string | null;
    /** ביט: הלקוח צירף צילום מסך */
    bitReceipt: boolean;
    /** חלק 32: הזמנה מהקופה המהירה — אמצעי התשלום שנרשם בקופה (null = לא מהקופה) */
    posMethod: string | null;
  };
  /** מסמך ה-PDF (אישור הזמנה / בקשה להצעת מחיר) */
  attachments: EmailAttachment[];
  cart: {
    lines: OrderEmailLine[];
    shipping: { label: string; amount: number; free: boolean } | null;
    discount: { label: string; amount: number } | null;
    /** null = בקשה להצעת מחיר (בלי מחירים) */
    vat: VatBreakdown | null;
  };
  /** קטעי HTML מוכנים (מקודדים) — משותפים לצוות וללקוח */
  html: {
    /** טבלת הפריטים המלאה (עם ברקוד) — למייל הצוות */
    staffTable: string;
    shippingMethod: string;
    delivery: string;
    totals: string;
    discountLine: string;
  };
};

export const formatMoney = (value: number) => `₪${value.toFixed(2)}`;

/**
 * null = ההזמנה ממתינה לתשלום (ביט — חלק 17ב) — המיילים יוצאים רק אחרי
 * שהלקוח שולח אסמכתא / צילום מסך
 */
export async function prepareOrderEmail(orderId: string): Promise<PreparedOrderEmail | null> {
  const { data: payment } = await supabaseAdmin
    .from("orders")
    .select(
      "payment_method, payment_status, bit_transaction_id, bit_receipt_url, pos_payment_method",
    )
    .eq("id", orderId)
    .maybeSingle();
  // ממתינה לתשלום (ביט שעוד לא נשלחה עליו אסמכתא) — בלי מיילים
  if (payment?.payment_status === "awaiting") return null;

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

  const money = formatMoney;

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
      : vat.exempt
        ? // חלק 23: לא נגבה מע"מ (עוסק פטור)
          `<p style="margin-top:12px;"><strong>סה"כ לתשלום: ${money(vat.gross)}</strong><br/>ללא מע"מ</p>`
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

  const discountLineHtml =
    discount > 0
      ? `<p><strong>${escapeHtml(orderDiscountLabel(order))}:</strong> <span style="color:#15803d;">-${money(discount)}</span></p>`
      : "";

  const staffTable = `<table style="width:100%;border-collapse:collapse;margin-top:12px;">
      <thead><tr>${headers}</tr></thead>
      <tbody>${itemsHtml}${shippingRowHtml}${discountRowHtml}</tbody>
    </table>`;

  return {
    orderId: order.id,
    orderNumber: order.order_number,
    createdAt: order.created_at,
    customerId: order.customer_id,
    kind: order.kind,
    isQuote,
    isGuest,
    documentLabel,
    customerEmail,
    greetingName: customerName || billing.name,
    agentName,
    staffRecipients: [...recipientEmails],
    billing,
    delivery,
    shippingKind: order.shipping_kind ?? null,
    pickupAddress,
    note: order.note,
    payment: {
      method: (payment?.payment_method ?? "offline") as PaymentMethod,
      status: (payment?.payment_status ?? "not_required") as PaymentStatus,
      bitReference: payment?.bit_transaction_id ?? null,
      bitReceipt: Boolean(payment?.bit_receipt_url),
      posMethod: payment?.pos_payment_method ?? null,
    },
    attachments: [{ filename: pdf.filename, content: pdf.base64 }],
    cart: {
      lines: order.order_items.map((item) => ({
        name: item.product_name ?? "מוצר",
        barcode: item.product_barcode,
        quantity: item.quantity,
        unitPrice: Number(item.unit_price),
        lineTotal: Number(item.unit_price) * item.quantity,
        digital: item.is_digital === true,
      })),
      shipping: hasShippingLine(order)
        ? {
            label: shippingLabel ?? "דמי משלוח",
            amount: shippingAmount,
            free: shippingWasFree(order),
          }
        : null,
      discount: discount > 0 ? { label: orderDiscountLabel(order), amount: discount } : null,
      vat,
    },
    html: {
      staffTable,
      shippingMethod: shippingMethodHtml,
      delivery: deliveryHtml,
      totals: totalsHtml,
      discountLine: discountLineHtml,
    },
  };
}

/** כתובת האיסוף העצמי = כתובת העסק מהגדרות האתר */
export async function loadPickupAddress(): Promise<string> {
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
