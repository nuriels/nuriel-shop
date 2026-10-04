/** לוגיקת הזמנות B2B – מספרי הזמנה, סטטוסים וסל קניות */

import { ORDER_CONTACT_COLUMNS, type OrderContactFields } from "@/lib/order-details";
import {
  ORDER_SHIPPING_COLUMNS,
  type OrderItemStatus,
  type OrderShippingKind,
} from "@/lib/shipping";
import { ORDER_COUPON_COLUMNS } from "@/lib/coupons";

export type CartItem = {
  productId: string;
  name: string;
  category: string;
  imageUrl: string | null;
  price: number;
  quantity: number;
  /** האם למוצר יש פיקדון — קובע אם תיווסף שורת פיקדון אוטומטית בשליחה */
  hasDeposit?: boolean;
  /** מחיר הפיקדון ליחידה בודדת (לא למארז) */
  depositPrice?: number | null;
  /** כמות היחידות במארז — סכום הפיקדון לשורה הוא depositPrice * depositUnits */
  depositUnits?: number | null;
  /** נמכר במארזים של N — הכמות (ביחידות) תמיד כפולה של N */
  packSize?: number | null;
  /** מינימום יחידות להזמנה (NULL = בלי) — נפרד מהמארזים */
  minOrderQuantity?: number | null;
  /** הוריאציה שנבחרה (צבע / מידה...) — null למוצר בלי וריאציות */
  variantId?: string | null;
  /** "אדום · S" — לתצוגה בסל */
  variantLabel?: string | null;
  /** מוצר דיגיטלי — לא דורש משלוח */
  isDigital?: boolean;
};

/**
 * המזהה של שורה בסל: מוצר + וריאציה (שתי מידות של אותה חולצה = שתי שורות).
 * כל פעולה על שורה (כמות, הסרה) לפי המפתח הזה.
 */
export function cartLineKey(item: Pick<CartItem, "productId" | "variantId">): string {
  return item.variantId ? `${item.productId}:${item.variantId}` : item.productId;
}

/** "קברנה — אדום · 750" */
export function cartLineName(item: Pick<CartItem, "name" | "variantLabel">): string {
  return item.variantLabel ? `${item.name} — ${item.variantLabel}` : item.name;
}

/** יש בסל מוצר פיזי (צריך שיטת משלוח)? סל שכולו דיגיטלי — בלי משלוח */
export function cartNeedsShipping(items: CartItem[]): boolean {
  return items.some((item) => !item.isDigital);
}

/** קפיצת הכמות בסל: גודל המארז, או 1 */
export function cartStep(item: CartItem): number {
  return item.packSize && item.packSize >= 2 ? item.packSize : 1;
}

/** המינימום שהוגדר למוצר בסל (1 = בלי מינימום) */
export function cartMinUnits(item: CartItem): number {
  return item.minOrderQuantity && item.minOrderQuantity >= 2 ? item.minOrderQuantity : 1;
}

/** הכמות הקטנה ביותר המותרת לשורה בסל: כפולה של המארז שאינה נמוכה מהמינימום */
export function cartMinimum(item: CartItem): number {
  const step = cartStep(item);
  return Math.max(step, Math.ceil(cartMinUnits(item) / step) * step);
}

/** סכום הפיקדון למארז אחד של הפריט (0 אם אין פיקדון) */
export function depositPerUnit(item: CartItem): number {
  if (!item.hasDeposit || !item.depositPrice || !item.depositUnits) return 0;
  return item.depositPrice * item.depositUnits;
}

/** סה"כ פיקדון בסל (על כל הכמויות) */
export function cartDepositTotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + depositPerUnit(item) * item.quantity, 0);
}

export type OrderStatus =
  | "pending"
  | "agent_review"
  | "picking"
  | "picked"
  | "awaiting_courier"
  | "shipped"
  | "delivered"
  | "cancelled";

export const ORDER_STATUSES: OrderStatus[] = [
  "pending",
  "agent_review",
  "picking",
  "picked",
  "awaiting_courier",
  "shipped",
  "delivered",
  "cancelled",
];

/**
 * הסטטוסים שאפשר לבחור ביצירת הזמנה ידנית. "ממתינה לשליח" ו"נמסרה" נקבעים
 * רק בזרימת המשלוח (מסירה לשליח עם קישור / דיווח השליח).
 */
export const ORDER_CREATE_STATUSES: OrderStatus[] = [
  "pending",
  "agent_review",
  "picking",
  "picked",
  "shipped",
  "cancelled",
];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "התקבלה / ממתינה לטיפול",
  agent_review: "בטיפול סוכן",
  picking: "בליקוט והכנה",
  picked: "לוקטה — בבדיקה לפני משלוח",
  awaiting_courier: "ממתינה לשליח",
  shipped: "נשלחה",
  delivered: "נמסרה ללקוח",
  cancelled: "בוטלה",
};

/**
 * הסטטוס לתצוגה, כולל ניסיונות משלוח שנכשלו:
 * "ממתינה לשליח · משלוח נכשל — ניסיון 2".
 */
export function orderStatusText(order: {
  status: OrderStatus;
  delivery_attempts?: number | null;
}): string {
  const base = ORDER_STATUS_LABEL[order.status] ?? order.status;
  const attempts = order.delivery_attempts ?? 0;
  if (order.status === "awaiting_courier" && attempts > 0) {
    return `${base} · משלוח נכשל — ניסיון ${attempts}`;
  }
  return base;
}

/** אפשר לסמן כ"נשלחה" (ידנית או במרוכז)? — לא הצעות מחיר ולא הזמנות שהסתיימו */
export function canMarkShipped(order: { status: OrderStatus; kind: OrderKind }): boolean {
  return order.kind === "order" && !["cancelled", "shipped", "delivered"].includes(order.status);
}

/** אפשר למסור לשליח? (אותו כלל כמו ב-assign_order_courier) */
export function canAssignCourier(order: { status: OrderStatus; kind: OrderKind }): boolean {
  return order.kind === "order" && order.status !== "cancelled" && order.status !== "delivered";
}

/**
 * קבוצות סטטוס לסרגל הצד (ניהול + אזור אישי של הלקוח):
 *   ממתינות לאישור = התקבלה + בטיפול סוכן · מאושרות = בליקוט והכנה ·
 *   ממתינות לשליח · בוצעו = נשלחה / נמסרה · מבוטלות — בנפרד.
 */
export type OrderGroup = "awaiting" | "approved" | "courier" | "completed" | "cancelled";

export const ORDER_GROUPS: {
  id: OrderGroup;
  label: string;
  statuses: OrderStatus[];
  /** הסבר קצר מעל הרשימה — לצוות */
  staffHint: string;
  /** הסבר קצר מעל הרשימה — ללקוח */
  customerHint: string;
}[] = [
  {
    id: "awaiting",
    label: "ממתינות לאישור",
    statuses: ["pending", "agent_review"],
    staffHint: 'הזמנות חדשות שעוד לא אושרו. "אישור הזמנה" מעביר אותן לליקוט והכנה.',
    customerHint: "הזמנות ששלחת ועדיין לא אושרו. נעדכן כאן כשההזמנה תאושר.",
  },
  {
    id: "approved",
    label: "מאושרות",
    // "לוקטה" (ממתינה לאישור מנהל) — ללקוח ולסוכן זה עדיין "בהכנה"
    statuses: ["picking", "picked"],
    staffHint: 'אושרו ונמצאות בליקוט והכנה במחסן. "סימון כבוצעה" אחרי שנשלחו.',
    customerHint: "ההזמנה אושרה ונמצאת בהכנה במחסן.",
  },
  {
    id: "courier",
    label: "ממתינות לשליח",
    statuses: ["awaiting_courier"],
    staffHint:
      'נמסרו לשליח עם קישור אישי (בלי התחברות). השליח מסמן בקישור "נמסר" או "משלוח נכשל" — ואז ההזמנה נשארת כאן והמונה עולה.',
    customerHint: "ההזמנה ארוזה ומחכה לשליח. נעדכן כשתימסר.",
  },
  {
    id: "completed",
    label: "בוצעו",
    statuses: ["shipped", "delivered"],
    staffHint: "הזמנות שנשלחו או נמסרו ללקוח.",
    customerHint: "הזמנות שנשלחו או נמסרו אליך. אפשר להזמין שוב בלחיצה.",
  },
  {
    id: "cancelled",
    label: "מבוטלות",
    statuses: ["cancelled"],
    staffHint: "הזמנות שבוטלו.",
    customerHint: "הזמנות שבוטלו.",
  },
];

export function orderGroupOf(status: OrderStatus): OrderGroup {
  return ORDER_GROUPS.find((group) => group.statuses.includes(status))?.id ?? "awaiting";
}

export const ORDER_STATUS_BADGE: Record<
  OrderStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  pending: "default",
  agent_review: "secondary",
  picking: "secondary",
  picked: "secondary",
  awaiting_courier: "default",
  shipped: "outline",
  delivered: "outline",
  cancelled: "destructive",
};

/** הזמנה רגילה מול בקשה להצעת מחיר (לקוח ללא קבוצת מחיר) */
export type OrderKind = "order" | "quote";

export const ORDER_KIND_LABEL: Record<OrderKind, string> = {
  order: "הזמנה",
  quote: "בקשה להצעת מחיר",
};

export type OrderItemRow = {
  id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  /** צילום פרטי המוצר בעת ההזמנה — הלקוח אינו רשאי לקרוא את טבלת המוצרים */
  product_name: string | null;
  product_sku: string | null;
  product_barcode: string | null;
  product_image_url: string | null;
  /** שורת פיקדון אוטומטית (על אותו product_id), לא פריט לליקוט בנפרד */
  is_deposit: boolean;
  /** מתנה מהטבת עגלה (במחיר 0) */
  is_gift?: boolean;
  /** מוצר דיגיטלי (רישיון / קוד) */
  is_digital?: boolean;
  /** ממתין לשליח / ממתין להזנת רישיון / נמסר במייל ... */
  item_status?: OrderItemStatus | null;
  /** מפתח הרישיון (מוצר דיגיטלי) — אחרי שהמנהל הזין ושלח */
  digital_license_key?: string | null;
  license_sent_at?: string | null;
  license_sent_to?: string | null;
  /** "אדום · S" — הוריאציה שנבחרה (כבר כלולה גם ב-product_name) */
  variant_label?: string | null;
};

export type OrderRow = OrderContactFields & {
  id: string;
  /** null = הזמנת אורח (בלי חשבון) — הפרטים בעמודות customer_* / billing_* */
  customer_id: string | null;
  agent_id: string | null;
  order_number: string;
  status: OrderStatus;
  kind: OrderKind;
  total: number;
  note: string | null;
  vat_rate: number | null;
  prices_include_vat: boolean | null;
  created_at: string;
  /** כמה פעמים השליח דיווח "משלוח נכשל" */
  delivery_attempts: number;
  last_delivery_failure_note: string | null;
  last_delivery_failure_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  /** שיטת המשלוח שנבחרה בקופה (צילום) */
  shipping_method_id?: string | null;
  shipping_method_name?: string | null;
  shipping_kind?: OrderShippingKind | null;
  shipping_base_price?: number;
  shipping_free_threshold?: number | null;
  /** דמי המשלוח בפועל — כלולים ב-total */
  shipping_price?: number;
  /** קופון (חלק 14): הקוד, צילום התנאים וההנחה שהופחתה — כבר מופחתת ב-total */
  coupon_code?: string | null;
  coupon_discount_type?: string | null;
  coupon_discount_value?: number | null;
  coupon_min_order?: number | null;
  discount_amount?: number;
  order_items: OrderItemRow[];
};

/** העמודות שנטענות בכל מסכי ההזמנות (לקוח, סוכן ומנהל) */
export const ORDER_SELECT_COLUMNS =
  "id, customer_id, agent_id, order_number, status, kind, total, note, vat_rate, prices_include_vat, created_at, " +
  "delivery_attempts, last_delivery_failure_note, last_delivery_failure_at, shipped_at, delivered_at, " +
  `${ORDER_CONTACT_COLUMNS}, ${ORDER_SHIPPING_COLUMNS}, ${ORDER_COUPON_COLUMNS}, ` +
  "order_items (id, product_id, quantity, unit_price, product_name, product_sku, product_barcode, product_image_url, is_deposit, is_gift, " +
  "is_digital, item_status, digital_license_key, license_sent_at, license_sent_to, variant_label)";

/**
 * מספר ההזמנה נקבע במסד בלבד (טריגר `orders_assign_number`):
 * SH + שתי ספרות שנה + מונה רץ בן 7 ספרות, למשל SH260000001.
 * המונה מתאפס בתחילת כל שנה. הלקוח לא שולח מספר — כל ערך שנשלח נדרס.
 */
export const ORDER_NUMBER_PATTERN = /^SH\d{9}$/;

export function cartTotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export function cartCount(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

export function formatOrderDate(iso: string): string {
  return new Date(iso).toLocaleString("he-IL", {
    dateStyle: "short",
    timeStyle: "short",
  });
}
