/**
 * חלק 33: "סטטוס משלוחים" של המחסנאי — ההזמנות שבטיפול המחסן, בלי מחירים
 * והכנסות (fulfillment_orders במסד), ועדכון הסטטוס (fulfillment_set_status —
 * דרך פעולת השרת setFulfillmentStatus, ששולחת גם את המייל "יצאה למשלוח").
 */
import { supabase } from "@/integrations/supabase/client";

export type FulfillmentStatus = "picking" | "picked" | "awaiting_courier" | "shipped" | "delivered";

export type FulfillmentOrder = {
  id: string;
  order_number: string;
  created_at: string;
  status: FulfillmentStatus;
  is_urgent: boolean;
  customer_name: string;
  customer_phone: string | null;
  city: string | null;
  address: string | null;
  zip: string | null;
  shipping_method_name: string | null;
  shipping_kind: string | null;
  tracking_number: string | null;
  shipping_provider: string | null;
  delivery_attempts: number;
  items_count: number;
  units_count: number;
  order_source: "web" | "pos";
  note: string | null;
  updated_at: string;
};

export const FULFILLMENT_STATUS_LABEL: Record<FulfillmentStatus, string> = {
  picking: "בליקוט",
  picked: "לוקטה — ממתינה לאישור מנהל",
  awaiting_courier: "ממתינה לשליח",
  shipped: "נשלחה",
  delivered: "נמסרה ללקוח",
};

/** הקבוצות במסך, לפי הסדר */
export const FULFILLMENT_GROUPS: { value: FulfillmentStatus; label: string; hint: string }[] = [
  {
    value: "awaiting_courier",
    label: "ממתינות לשליח",
    hint: 'כשהשליח אסף — "סמן כנשלחה" (אפשר עם מספר מעקב), והלקוח מקבל מייל.',
  },
  {
    value: "picked",
    label: "לוקטו",
    hint: "ממתינות לאישור מנהל לפני משלוח.",
  },
  { value: "picking", label: "בליקוט", hint: 'הליקוט עצמו — בלשונית "ליקוט".' },
  {
    value: "shipped",
    label: "נשלחו",
    hint: 'כשהלקוח קיבל — "נמסרה". טעות? אפשר להחזיר ל"ממתינה לשליח".',
  },
  { value: "delivered", label: "נמסרו (שבוע אחרון)", hint: 'טעות? אפשר להחזיר ל"נשלחה".' },
];

/** הפעולות שמותר לעשות מכל סטטוס (זהה ל-fulfillment_set_status במסד) */
export function fulfillmentActions(
  status: FulfillmentStatus,
): { to: "shipped" | "delivered" | "awaiting_courier"; label: string; undo: boolean }[] {
  switch (status) {
    case "awaiting_courier":
      return [{ to: "shipped", label: "סמן כנשלחה", undo: false }];
    case "shipped":
      return [
        { to: "delivered", label: "נמסרה ללקוח", undo: false },
        { to: "awaiting_courier", label: 'החזר ל"ממתינה לשליח"', undo: true },
      ];
    case "delivered":
      return [{ to: "shipped", label: 'החזר ל"נשלחה"', undo: true }];
    default:
      return [];
  }
}

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export async function loadFulfillmentOrders(
  includeDelivered: boolean,
): Promise<FulfillmentOrder[]> {
  const { data, error } = await supabase.rpc("fulfillment_orders", {
    _include_delivered: includeDelivered,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: row.id,
    order_number: row.order_number,
    created_at: row.created_at,
    status: row.status as FulfillmentStatus,
    is_urgent: row.is_urgent === true,
    customer_name: row.customer_name ?? "",
    customer_phone: row.customer_phone ?? null,
    city: row.city ?? null,
    address: row.address ?? null,
    zip: row.zip ?? null,
    shipping_method_name: row.shipping_method_name ?? null,
    shipping_kind: row.shipping_kind ?? null,
    tracking_number: row.tracking_number ?? null,
    shipping_provider: row.shipping_provider ?? null,
    delivery_attempts: num(row.delivery_attempts),
    items_count: num(row.items_count),
    units_count: num(row.units_count),
    order_source: row.order_source === "pos" ? "pos" : "web",
    note: row.note ?? null,
    updated_at: row.updated_at,
  }));
}
