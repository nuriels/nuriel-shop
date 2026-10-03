/**
 * שיטות משלוח, משלוח בהזמנה וסטטוס של שורה בהזמנה — משותף לקופה, לניהול,
 * לאזור האישי ולמסמכים (דפדפן ושרת).
 *
 * המחיר המחייב נקבע במסד (orders_shipping_and_total): המחיר של השיטה, ו-0
 * כשסכום המוצרים עבר את סף המשלוח החינם (רק בשיטת "משלוח"). כאן — אותו
 * חישוב, לתצוגה בקופה.
 */

import type {
  OrderItemStatus,
  OrderShippingKind,
  ShippingMethodKind,
} from "@/integrations/supabase/types";

export type { OrderItemStatus, OrderShippingKind, ShippingMethodKind };

export type ShippingMethod = {
  id: string;
  name: string;
  description: string;
  kind: ShippingMethodKind;
  price: number;
  is_active: boolean;
  sort_order: number;
};

export const SHIPPING_METHOD_COLUMNS =
  "id, name, description, kind, price, is_active, sort_order" as const;

export const SHIPPING_KIND_LABEL: Record<ShippingMethodKind, string> = {
  delivery: "משלוח לכתובת",
  pickup: "איסוף עצמי",
};

export const SHIPPING_NAME_MAX = 60;
export const SHIPPING_DESCRIPTION_MAX = 200;
export const SHIPPING_PRICE_MAX = 100_000;

/** אותם כללים כמו במסד (shipping_methods) — הודעה ראשונה, או null */
export function shippingMethodProblem(input: {
  name: string;
  description: string;
  price: string;
}): string | null {
  const name = input.name.trim();
  if (name.length < 2 || name.length > SHIPPING_NAME_MAX) {
    return `שם השיטה: 2 עד ${SHIPPING_NAME_MAX} תווים`;
  }
  if (input.description.trim().length > SHIPPING_DESCRIPTION_MAX) {
    return `ההסבר ארוך מדי (עד ${SHIPPING_DESCRIPTION_MAX} תווים)`;
  }
  const raw = input.price.trim();
  if (raw !== "" && !/^\d+(\.\d{1,2})?$/.test(raw)) {
    return "מחיר לא תקין — מספר (0 ומעלה), עד 2 ספרות אחרי הנקודה";
  }
  if ((raw === "" ? 0 : Number(raw)) > SHIPPING_PRICE_MAX) return "המחיר גבוה מדי";
  return null;
}

/** השוואה באגורות — בלי הפתעות של נקודה צפה */
const cents = (value: number) => Math.round(value * 100);

/**
 * דמי המשלוח בפועל לסל: איסוף עצמי — המחיר שלו (בדרך כלל 0); משלוח — 0 אם
 * סכום המוצרים עבר את סף המשלוח החינם של החנות.
 */
export function shippingCost(
  method: Pick<ShippingMethod, "kind" | "price"> | null,
  productsSubtotal: number,
  freeShippingThreshold: number | null | undefined,
): number {
  if (!method) return 0;
  const price = Number(method.price) || 0;
  if (
    method.kind === "delivery" &&
    freeShippingThreshold !== null &&
    freeShippingThreshold !== undefined &&
    freeShippingThreshold > 0 &&
    cents(productsSubtotal) >= cents(freeShippingThreshold)
  ) {
    return 0;
  }
  return price;
}

/** האם השיטה זכאית למשלוח חינם (להצגת "חינם!" ליד השיטה) */
export function isFreeByThreshold(
  method: Pick<ShippingMethod, "kind" | "price">,
  productsSubtotal: number,
  freeShippingThreshold: number | null | undefined,
): boolean {
  return method.price > 0 && shippingCost(method, productsSubtotal, freeShippingThreshold) === 0;
}

// ------------------------------------------------------------
// סטטוס לכל שורה בהזמנה
// ------------------------------------------------------------

export const ITEM_STATUS_LABEL: Record<OrderItemStatus, string> = {
  awaiting_courier: "ממתין לשליח",
  awaiting_pickup: "ממתין לאיסוף",
  shipped: "נשלח",
  delivered: "נמסר",
  awaiting_license: "ממתין להזנת רישיון",
  delivered_email: "נמסר במייל",
  cancelled: "בוטל",
};

/** צבע התג לכל סטטוס (Tailwind) */
export const ITEM_STATUS_TONE: Record<OrderItemStatus, string> = {
  awaiting_courier: "border-sky-300 bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200",
  awaiting_pickup:
    "border-violet-300 bg-violet-50 text-violet-900 dark:bg-violet-950/40 dark:text-violet-200",
  shipped:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  delivered:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  awaiting_license:
    "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  delivered_email:
    "border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
  cancelled: "border-border bg-muted text-muted-foreground",
};

/** תווית הסטטוס — באיסוף עצמי "נשלח" / "נמסר" = "נאסף" */
export function itemStatusLabel(
  status: OrderItemStatus | null | undefined,
  shippingKind?: OrderShippingKind | null,
): string | null {
  if (!status) return null;
  if (shippingKind === "pickup" && (status === "shipped" || status === "delivered")) return "נאסף";
  return ITEM_STATUS_LABEL[status] ?? null;
}

// ------------------------------------------------------------
// מפתח רישיון
// ------------------------------------------------------------

export const LICENSE_KEY_MAX = 100;

/** ניקוי מפתח רישיון שהודבק (רווחים בקצוות, שורות) — ובדיקה */
export function normalizeLicenseKey(raw: string): string {
  return raw.replace(/[\r\n\t]+/g, " ").trim();
}

export function licenseKeyProblem(key: string): string | null {
  if (key === "") return "נא להזין את מפתח הרישיון";
  if (key.length > LICENSE_KEY_MAX) return `מפתח הרישיון ארוך מדי (עד ${LICENSE_KEY_MAX} תווים)`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(key)) return "מפתח הרישיון מכיל תווים לא תקינים";
  return null;
}

// ------------------------------------------------------------
// המשלוח של הזמנה — לתצוגה
// ------------------------------------------------------------

export type OrderShippingFields = {
  shipping_method_name?: string | null;
  shipping_kind?: OrderShippingKind | null;
  shipping_price?: number | null;
  shipping_base_price?: number | null;
  shipping_free_threshold?: number | null;
};

/** "שליח עד הבית" / "איסוף עצמי" / "מוצר דיגיטלי — נשלח במייל" / null */
export function orderShippingLabel(order: OrderShippingFields): string | null {
  if (order.shipping_kind === "digital") return "מוצרים דיגיטליים — נשלחים במייל";
  if (order.shipping_method_name) return order.shipping_method_name;
  if (order.shipping_kind === "pickup") return "איסוף עצמי";
  return null;
}

/** האם להציג שורת משלוח בסיכום (יש שיטה, או דמי משלוח שהוזנו ידנית) */
export function hasShippingLine(order: OrderShippingFields): boolean {
  return (
    order.shipping_kind === "delivery" ||
    order.shipping_kind === "pickup" ||
    Number(order.shipping_price ?? 0) > 0
  );
}

/** משלוח חינם בזכות הסף (המחיר הרגיל של השיטה גבוה מ-0, ונגבה 0) */
export function shippingWasFree(order: OrderShippingFields): boolean {
  return (
    order.shipping_kind === "delivery" &&
    Number(order.shipping_price ?? 0) === 0 &&
    Number(order.shipping_base_price ?? 0) > 0
  );
}

export const ORDER_SHIPPING_COLUMNS =
  "shipping_method_id, shipping_method_name, shipping_kind, shipping_base_price, shipping_free_threshold, shipping_price" as const;
