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

const BRANDING_BUCKET = "branding";

type OrderRecord = {
  id: string;
  order_number: string;
  customer_id: string;
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
  }[];
};

export type LoadedOrderDocument = {
  order: OrderRecord;
  customerEmail: string | null;
  customerName: string;
  agentEmail: string | null;
  /** השם המלא בעברית של הסוכן — null אם לא הוזן (אז ללקוח מוצג רק מספר הסוכן) */
  agentName: string | null;
  pdf: { base64: string; filename: string };
};

/** הלוגו נטען מהאחסון ומומר ל-data URL; PDF תומך ב-PNG/JPEG בלבד */
export async function loadLogoDataUrl(logoPath: string | null): Promise<string | null> {
  if (!logoPath) return null;
  try {
    const { data, error } = await supabaseAdmin.storage.from(BRANDING_BUCKET).download(logoPath);
    if (error || !data) return null;
    const buffer = Buffer.from(await data.arrayBuffer());
    const isPng = buffer[0] === 0x89 && buffer[1] === 0x50;
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8;
    if (!isPng && !isJpeg) return null;
    return `data:image/${isPng ? "png" : "jpeg"};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

/** טוען הזמנה מלאה ומפיק ממנה מסמך PDF */
export async function loadOrderDocument(orderId: string): Promise<LoadedOrderDocument> {
  const { data: orderData, error } = await supabaseAdmin
    .from("orders")
    .select(
      "id, order_number, customer_id, agent_id, status, kind, total, note, vat_rate, prices_include_vat, created_at, order_items (quantity, unit_price, product_name, product_sku, product_barcode)",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error || !orderData) throw new Error("ההזמנה לא נמצאה");
  const order = orderData as unknown as OrderRecord;

  const [{ data: customerRole }, { data: customerProfile }, { data: settings }] = await Promise.all(
    [
      supabaseAdmin
        .from("user_roles")
        .select("email")
        .eq("user_id", order.customer_id)
        .maybeSingle(),
      supabaseAdmin
        .from("customer_profiles")
        .select("business_name, business_address, tax_id, contact_name, phone")
        .eq("user_id", order.customer_id)
        .maybeSingle(),
      supabaseAdmin
        .from("site_settings")
        .select(
          "site_title, logo_path, business_name, business_tax_id, business_address, business_phone, business_email, support_phone, prices_include_vat, vat_rate",
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
    name: item.product_name ?? "מוצר",
    barcode: item.product_barcode,
    sku: item.product_sku,
    quantity: item.quantity,
    unitPrice: Number(item.unit_price),
  }));

  const itemsTotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const isQuote = order.kind === "quote";

  const documentData: DocumentData = {
    kind: isQuote ? "quote" : "order",
    orderNumber: order.order_number,
    createdAt: order.created_at,
    statusLabel: ORDER_STATUS_LABEL[order.status] ?? "",
    business: {
      name: settings?.business_name?.trim() || settings?.site_title?.trim() || "סוכנות המשקאות",
      taxId: settings?.business_tax_id ?? "",
      address: settings?.business_address ?? "",
      phone: settings?.business_phone ?? "",
      supportPhone: settings?.support_phone ?? "",
      email: settings?.business_email ?? "",
      logoDataUrl: await loadLogoDataUrl(settings?.logo_path ?? null),
    },
    customer: {
      businessName: customerProfile?.business_name ?? "",
      taxId: customerProfile?.tax_id ?? "",
      address: customerProfile?.business_address ?? "",
      contactName: customerProfile?.contact_name ?? "",
      phone: customerProfile?.phone ?? "",
      email: customerRole?.email ?? "",
    },
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
  };

  const pdf = await buildOrderDocumentPdf(documentData);

  return {
    order,
    customerEmail: customerRole?.email ?? null,
    customerName: customerProfile?.contact_name ?? customerProfile?.business_name ?? "",
    agentEmail,
    agentName,
    pdf,
  };
}
