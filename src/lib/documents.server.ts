/**
 * איסוף כל הנתונים הדרושים למסמך הזמנה/הצעת מחיר והפקת ה-PDF.
 * משותף לשליחת המייל (צירוף אוטומטי) ולהורדה ידנית מהמסך.
 * צד שרת בלבד — משתמש במפתח ה-service role.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildOrderDocumentPdf,
  type DocumentData,
  type DocumentItem,
} from "@/lib/pdf/document.server";
import { calculateVat, DEFAULT_VAT_RATE } from "@/lib/vat";
import { ORDER_STATUS_LABEL, type OrderStatus } from "@/lib/orders";
import { DEFAULT_STORE_NAME } from "@/lib/branding";
import {
  ORDER_SHIPPING_COLUMNS,
  hasShippingLine,
  orderShippingLabel,
  type OrderShippingFields,
} from "@/lib/shipping";
import {
  ORDER_CONTACT_COLUMNS,
  billingOf,
  deliveryOf,
  type OrderContactFields,
} from "@/lib/order-details";
import {
  ORDER_COUPON_COLUMNS,
  orderDiscount,
  orderDiscountLabel,
  type OrderCouponFields,
} from "@/lib/coupons";

const BRANDING_BUCKET = "branding";

type OrderRecord = OrderContactFields &
  OrderShippingFields &
  OrderCouponFields & {
    id: string;
    order_number: string;
    /** null = הזמנת אורח (הפרטים בעמודות ההזמנה) */
    customer_id: string | null;
    agent_id: string | null;
    status: OrderStatus;
    kind: "order" | "quote";
    total: number;
    note: string | null;
    vat_rate: number | null;
    prices_include_vat: boolean | null;
    created_at: string;
    order_items: {
      quantity: number;
      unit_price: number;
      product_name: string | null;
      product_sku: string | null;
      product_barcode: string | null;
      is_digital?: boolean;
    }[];
  };

export type LoadedOrderDocument = {
  order: OrderRecord;
  customerEmail: string | null;
  customerName: string;
  /** הזמנת אורח — אין חשבון (ואין יומן מיילים בתיק לקוח) */
  isGuest: boolean;
  agentEmail: string | null;
  /** השם המלא בעברית של הסוכן — null אם לא הוזן (אז ללקוח מוצג רק מספר הסוכן) */
  agentName: string | null;
  pdf: { base64: string; filename: string };
};

/** הלוגו נטען מהאחסון ומומר ל-data URL; PDF תומך ב-PNG/JPEG בלבד */
export async function loadLogoDataUrl(logoPath: string | null): Promise<string | null> {
  if (!logoPath) return null;
  try {
    let bytes: Buffer;
    if (/^https?:\/\//i.test(logoPath)) {
      // חלק 22: לוגו שהוגדר כקישור מלא — הורדה מוגנת (SSRF, גודל, זמן)
      const { fetchRemoteImage } = await import("@/server/services/image-fetch");
      bytes = (await fetchRemoteImage(logoPath)).bytes;
    } else {
      const { data, error } = await supabaseAdmin.storage.from(BRANDING_BUCKET).download(logoPath);
      if (error || !data) return null;
      bytes = Buffer.from(await data.arrayBuffer());
    }
    // PNG / JPEG כמו שהם; WEBP וכו' — מומרים ל-PNG (jsPDF מטמיע רק PNG / JPEG)
    const { imageToPdfDataUrl } = await import("@/server/services/image-fetch");
    return await imageToPdfDataUrl(bytes);
  } catch {
    return null;
  }
}

/** טוען הזמנה מלאה ומפיק ממנה מסמך PDF */
export async function loadOrderDocument(orderId: string): Promise<LoadedOrderDocument> {
  const { data: orderData, error } = await supabaseAdmin
    .from("orders")
    .select(
      `id, order_number, customer_id, agent_id, status, kind, total, note, vat_rate, prices_include_vat, created_at, ${ORDER_CONTACT_COLUMNS}, ${ORDER_SHIPPING_COLUMNS}, ${ORDER_COUPON_COLUMNS}, order_items (quantity, unit_price, product_name, product_sku, product_barcode, is_digital)`,
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error || !orderData) throw new Error("ההזמנה לא נמצאה");
  const order = orderData as unknown as OrderRecord;

  const customerId = order.customer_id;
  const [{ data: customerRole }, { data: customerProfile }, { data: settings }] = await Promise.all(
    [
      customerId
        ? supabaseAdmin.from("user_roles").select("email").eq("user_id", customerId).maybeSingle()
        : Promise.resolve({ data: null }),
      customerId
        ? supabaseAdmin
            .from("customer_profiles")
            .select("business_name, business_address, city, zip_code, tax_id, contact_name, phone")
            .eq("user_id", customerId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabaseAdmin
        .from("site_settings")
        .select(
          "site_title, logo_path, business_name, business_tax_id, business_address, business_phone, business_email, support_phone, prices_include_vat, vat_rate, brand_color, price_tiers_enabled, business_type",
        )
        .eq("id", true)
        .maybeSingle(),
    ],
  );

  let agentEmail: string | null = null;
  let agentNumber: string | null = null;
  let agentName: string | null = null;
  if (order.agent_id) {
    const { data: agentRole } = await supabaseAdmin
      .from("user_roles")
      .select("email, agent_number, display_name")
      .eq("user_id", order.agent_id)
      .maybeSingle();
    agentEmail = agentRole?.email ?? null;
    agentNumber = agentRole?.agent_number ?? null;
    // ללקוח מציגים רק שם בעברית — לעולם לא שם משתמש או אימייל פנימי
    agentName = agentRole?.display_name?.trim() || null;
  }

  const items: DocumentItem[] = order.order_items.map((item) => ({
    name: `${item.product_name ?? "מוצר"}${item.is_digital ? " (דיגיטלי — נשלח במייל)" : ""}`,
    barcode: item.product_barcode,
    sku: item.product_sku,
    quantity: item.quantity,
    unitPrice: Number(item.unit_price),
  }));
  // המשלוח — שורה במסמך (כלול בסכום ובמע"מ, כמו ב-total של ההזמנה)
  if (hasShippingLine(order)) {
    items.push({
      name: `משלוח: ${orderShippingLabel(order) ?? "דמי משלוח"}`,
      barcode: null,
      sku: null,
      quantity: 1,
      unitPrice: Number(order.shipping_price ?? 0),
    });
  }
  // הנחת קופון — שורה שלילית (כלולה בסכום ובמע"מ, כמו ב-total של ההזמנה)
  const discount = order.kind === "quote" ? 0 : orderDiscount(order);
  if (discount > 0) {
    items.push({
      name: orderDiscountLabel(order),
      barcode: null,
      sku: null,
      quantity: 1,
      unitPrice: -discount,
    });
  }

  const itemsTotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const isQuote = order.kind === "quote";

  // פרטי החיוב מהקופה (על ההזמנה), ובהזמנה ישנה — מהפרופיל
  const billing = billingOf(order, customerProfile, customerRole?.email ?? null);
  const delivery = deliveryOf(order, customerProfile);

  const documentData: DocumentData = {
    kind: isQuote ? "quote" : "order",
    orderNumber: order.order_number,
    createdAt: order.created_at,
    statusLabel: ORDER_STATUS_LABEL[order.status] ?? "",
    business: {
      name: settings?.business_name?.trim() || settings?.site_title?.trim() || DEFAULT_STORE_NAME,
      taxId: settings?.business_tax_id ?? "",
      address: settings?.business_address ?? "",
      phone: settings?.business_phone ?? "",
      supportPhone: settings?.support_phone ?? "",
      email: settings?.business_email ?? "",
      logoDataUrl: await loadLogoDataUrl(settings?.logo_path ?? null),
      brandColor: settings?.brand_color ?? null,
      businessType: settings?.business_type === "exempt" ? "exempt" : "authorized",
    },
    customer: {
      businessName: billing.name,
      taxId: billing.taxId,
      address: billing.address,
      contactName: customerProfile?.contact_name ?? "",
      phone: billing.phone,
      email: billing.email,
    },
    // "שלח לכתובת אחרת" — בלוק נפרד ובולט, כדי שהמשלוח לא ייצא לכתובת החיוב
    shipping: delivery.isAlternate
      ? { name: delivery.name, phone: delivery.phone, address: delivery.address }
      : null,
    agentNumber,
    agentName,
    items,
    vat: isQuote
      ? null
      : calculateVat(itemsTotal, {
          // מצב המע"מ מצולם לתוך ההזמנה בעת יצירתה, כדי שמסמך שיופק
          // מחדש בעוד שנה ישקף את מה שהוצג ללקוח באותו יום.
          pricesIncludeVat: order.prices_include_vat ?? true,
          vatRate: Number(order.vat_rate ?? settings?.vat_rate ?? DEFAULT_VAT_RATE),
        }),
    note: order.note,
    b2b: settings?.price_tiers_enabled === true,
  };

  const pdf = await buildOrderDocumentPdf(documentData);

  return {
    order,
    customerEmail: billing.email || null,
    customerName: customerProfile?.contact_name?.trim() || billing.name,
    isGuest: customerId === null,
    agentEmail,
    agentName,
    pdf,
  };
}
