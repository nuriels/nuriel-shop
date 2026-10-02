/** לוגיקת הזמנות B2B – מספרי הזמנה, סטטוסים וסל קניות */

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
};

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
  "pending" | "agent_review" | "picking" | "picked" | "shipped" | "cancelled";

export const ORDER_STATUSES: OrderStatus[] = [
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
  shipped: "נשלחה / בוצעה",
  cancelled: "בוטלה",
};

/**
 * קבוצות סטטוס לסרגל הצד (ניהול + אזור אישי של הלקוח):
 *   ממתינות לאישור = התקבלה + בטיפול סוכן · מאושרות = בליקוט והכנה ·
 *   בוצעו = נשלחה · מבוטלות — בנפרד.
 */
export type OrderGroup = "awaiting" | "approved" | "completed" | "cancelled";

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
    id: "completed",
    label: "בוצעו",
    statuses: ["shipped"],
    staffHint: "הזמנות שנשלחו ללקוח.",
    customerHint: "הזמנות שנשלחו אליך. אפשר להזמין שוב בלחיצה.",
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
  shipped: "outline",
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
};

export type OrderRow = {
  id: string;
  customer_id: string;
  agent_id: string | null;
  order_number: string;
  status: OrderStatus;
  kind: OrderKind;
  total: number;
  note: string | null;
  vat_rate: number | null;
  prices_include_vat: boolean | null;
  created_at: string;
  order_items: OrderItemRow[];
};

/** העמודות שנטענות בכל מסכי ההזמנות (לקוח, סוכן ומנהל) */
export const ORDER_SELECT_COLUMNS =
  "id, customer_id, agent_id, order_number, status, kind, total, note, vat_rate, prices_include_vat, created_at, " +
  "order_items (id, product_id, quantity, unit_price, product_name, product_sku, product_barcode, product_image_url, is_deposit)";

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
