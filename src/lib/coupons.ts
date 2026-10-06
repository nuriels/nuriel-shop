/**
 * קופונים (חלק 14) — עזרים טהורים, משותפים לדפדפן ולשרת.
 * החישוב כאן רק לתצוגה בקופה ובמסכים: ההנחה בפועל נקבעת במסד
 * (orders_shipping_and_total) — הנוסחה חייבת להיות זהה.
 */

export type CouponType = "percent" | "fixed" | "free_shipping";

export type Coupon = {
  id: string;
  code: string;
  discount_type: CouponType;
  discount_value: number;
  is_active: boolean;
  description: string | null;
  min_order_total: number | null;
  max_uses: number | null;
  starts_at: string | null;
  expires_at: string | null;
  created_at: string;
};

export const COUPON_COLUMNS =
  "id, code, discount_type, discount_value, is_active, description, min_order_total, max_uses, starts_at, expires_at, created_at" as const;

/** הקופון שהלקוח הקליד ואומת בשרת — מה שהקופה צריכה כדי להציג את ההנחה */
export type AppliedCoupon = {
  code: string;
  discountType: CouponType;
  discountValue: number;
  minOrderTotal: number | null;
  description: string | null;
};

/** אותו פורמט כמו ב-CHECK במסד: אותיות אנגליות גדולות, ספרות, מקף וקו תחתון */
export const COUPON_CODE_FORMAT = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

export function normalizeCouponCode(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

export function couponCodeProblem(code: string): string | null {
  if (code.length < 3) return "קוד קופון: לפחות 3 תווים";
  if (code.length > 32) return "קוד קופון: עד 32 תווים";
  if (!COUPON_CODE_FORMAT.test(code)) {
    return "קוד קופון: אותיות באנגלית, ספרות, מקף וקו תחתון בלבד (בלי רווחים)";
  }
  return null;
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * ההנחה על סכום המוצרים (בלי פיקדונות, מתנות ומשלוח). 0 אם לא הגיעו
 * למינימום. לא יותר מסכום המוצרים. זהה למסד.
 */
export function couponDiscount(
  coupon: Pick<AppliedCoupon, "discountType" | "discountValue" | "minOrderTotal">,
  productsSubtotal: number,
  /** חלק 24: דמי המשלוח — בקופון "משלוח חינם" זו ההנחה */
  shippingAmount = 0,
): number {
  if (coupon.minOrderTotal !== null && productsSubtotal < coupon.minOrderTotal) return 0;
  if (coupon.discountType === "free_shipping") return Math.max(0, round2(shippingAmount));
  if (!Number.isFinite(productsSubtotal) || productsSubtotal <= 0) return 0;
  const raw =
    coupon.discountType === "percent"
      ? round2((productsSubtotal * coupon.discountValue) / 100)
      : coupon.discountValue;
  return Math.max(0, Math.min(raw, round2(productsSubtotal)));
}

/** "10% הנחה" / "₪20 הנחה" */
export function couponLabel(type: CouponType, value: number): string {
  const amount = Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (type === "free_shipping") return "משלוח חינם";
  return type === "percent" ? `${amount}% הנחה` : `₪${amount} הנחה`;
}

/** שדות הקופון על ההזמנה — לבחירה מהמסד יחד עם שאר פרטי ההזמנה */
export const ORDER_COUPON_COLUMNS =
  "coupon_code, coupon_discount_type, coupon_discount_value, coupon_min_order, discount_amount" as const;

export type OrderCouponFields = {
  coupon_code?: string | null;
  /** צילום תנאי הקופון בעת ההזמנה — לחישוב מחדש בעריכת ההזמנה */
  coupon_discount_type?: string | null;
  coupon_discount_value?: number | string | null;
  coupon_min_order?: number | string | null;
  discount_amount?: number | string | null;
};

/** ההנחה מחדש לפי הצילום על ההזמנה (עריכת הזמנה — כמו שהמסד יחשב) */
export function orderCouponDiscount(
  order: OrderCouponFields,
  productsSubtotal: number,
  shippingAmount = 0,
): number {
  if (!order.coupon_code || !order.coupon_discount_type) return 0;
  return couponDiscount(
    {
      discountType:
        order.coupon_discount_type === "fixed" || order.coupon_discount_type === "free_shipping"
          ? order.coupon_discount_type
          : "percent",
      discountValue: Number(order.coupon_discount_value ?? 0),
      minOrderTotal: order.coupon_min_order == null ? null : Number(order.coupon_min_order),
    },
    productsSubtotal,
    shippingAmount,
  );
}

/** כמה הופחת מההזמנה בקופון (0 = בלי) */
export function orderDiscount(order: OrderCouponFields): number {
  const value = Number(order.discount_amount ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** "קופון SAVE10" — לשורת ההנחה במסמכים ובמיילים */
export function orderDiscountLabel(order: OrderCouponFields): string {
  return order.coupon_code ? `הנחת קופון ${order.coupon_code}` : "הנחה";
}

export type CouponStatus = "active" | "inactive" | "scheduled" | "expired" | "used_up";

/** מצב הקופון לתצוגה ברשימת הקופונים של המנהל */
export function couponStatus(
  coupon: Pick<Coupon, "is_active" | "starts_at" | "expires_at" | "max_uses">,
  uses: number,
  now: number = Date.now(),
): CouponStatus {
  if (!coupon.is_active) return "inactive";
  if (coupon.expires_at && Date.parse(coupon.expires_at) <= now) return "expired";
  if (coupon.max_uses !== null && uses >= coupon.max_uses) return "used_up";
  if (coupon.starts_at && Date.parse(coupon.starts_at) > now) return "scheduled";
  return "active";
}

export const COUPON_STATUS_LABELS: Record<CouponStatus, string> = {
  active: "פעיל",
  inactive: "כבוי",
  scheduled: "מתוזמן",
  expired: "פג תוקף",
  used_up: "נוצל",
};
