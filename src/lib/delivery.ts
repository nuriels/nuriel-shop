/**
 * משלוחים — צד לקוח (פאנל ההזמנות של המנהל / הסוכן).
 *
 * מסירה לשליח וקישורי שליח רצים ישירות מול המסד עם הרשאות המשתמש:
 * assign_order_courier בודקת is_staff, וה-RLS על order_courier_links מאפשר
 * לראות קישורים רק למנהל החנות ולסוכן של ההזמנה.
 */

import { supabase } from "@/integrations/supabase/client";
import type { OrderRow } from "@/lib/orders";
import type { ProfileContact } from "@/lib/order-details";
import { normalizeLabelSize, type LabelSize } from "@/lib/shipping-label";

export type CourierLink = {
  order_id: string;
  order_number: string;
  token: string;
  expires_at: string;
  delivery_attempts: number;
};

export type CourierLinkInfo = {
  order_id: string;
  token: string;
  courier_name: string | null;
  courier_phone: string | null;
  expires_at: string;
  opened_count: number;
  last_opened_at: string | null;
};

/** פרטי החנות למדבקה: שם, טלפון שירות ומידות המדבקה */
export type LabelStore = { name: string; phone: string | null; size: LabelSize };

export async function loadLabelStore(): Promise<LabelStore> {
  const { data } = await supabase
    .from("site_settings")
    .select(
      "business_name, site_title, support_phone, business_phone, label_width_mm, label_height_mm",
    )
    .eq("id", true)
    .maybeSingle();
  return {
    name: data?.business_name?.trim() || data?.site_title?.trim() || "",
    phone: data?.support_phone?.trim() || data?.business_phone?.trim() || null,
    size: normalizeLabelSize({
      width: Number(data?.label_width_mm),
      height: Number(data?.label_height_mm),
    }),
  };
}

/**
 * פרופילי לקוחות להזמנות ישנות (מלפני הקופה) — בלי כתובת על ההזמנה עצמה.
 * הזמנה עם פרטי קופה לא צריכה פרופיל.
 */
export async function loadLabelProfiles(orders: OrderRow[]): Promise<Map<string, ProfileContact>> {
  const ids = [
    ...new Set(
      orders
        .filter(
          (order) =>
            order.customer_id &&
            !order.ship_to_different &&
            !order.billing_address &&
            !order.customer_phone,
        )
        .map((order) => order.customer_id as string),
    ),
  ];
  if (ids.length === 0) return new Map();
  const { data } = await supabase
    .from("customer_profiles")
    .select("user_id, business_name, contact_name, phone, business_address, city, zip_code, tax_id")
    .in("user_id", ids);
  return new Map((data ?? []).map((profile) => [profile.user_id, profile as ProfileContact]));
}

/**
 * מסירה לשליח: ההזמנות עוברות ל"ממתינה לשליח" ומקבלות קישור אישי.
 * הזמנה שכבר ממתינה — אותו קישור (התוקף מתחדש ל-7 ימים); renew = קישור חדש
 * (הישן מפסיק לעבוד).
 */
export async function assignCourier(
  orderIds: string[],
  courier: { name?: string; phone?: string; renew?: boolean } = {},
): Promise<CourierLink[]> {
  const { data, error } = await supabase.rpc("assign_order_courier", {
    _order_ids: orderIds,
    _courier_name: courier.name?.trim() || null,
    _courier_phone: courier.phone?.trim() || null,
    _renew: courier.renew === true,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as CourierLink[];
}

/** הקישורים הקיימים (שם / טלפון השליח, כמה פעמים נפתח) */
export async function loadCourierLinks(orderIds: string[]): Promise<Map<string, CourierLinkInfo>> {
  if (orderIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("order_courier_links")
    .select(
      "order_id, token, courier_name, courier_phone, expires_at, opened_count, last_opened_at",
    )
    .in("order_id", orderIds);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((link) => [link.order_id, link as CourierLinkInfo]));
}

/** סימון ידני כ"נמסרה" (למשל כשהשליח דיווח בטלפון) */
export async function markOrderDelivered(orderId: string): Promise<void> {
  const { error } = await supabase.from("orders").update({ status: "delivered" }).eq("id", orderId);
  if (error) throw new Error(error.message);
}
