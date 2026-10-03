/**
 * פרטי החיוב והמשלוח של הזמנה, כפי שנקלטו בקופה (עמודות על ההזמנה עצמה).
 * משותף לכל המסכים: ניהול, סוכן, אזור אישי, מסמך PDF ומיילים — כדי שכולם
 * יציגו את אותה כתובת משלוח בפועל.
 *
 * הזמנה ישנה (מלפני הקופה) — בלי העמודות האלה; אז נופלים לפרופיל הלקוח.
 */

export type OrderContactFields = {
  customer_id: string | null;
  customer_name: string | null;
  customer_tax_id: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  billing_city: string | null;
  billing_address: string | null;
  billing_zip: string | null;
  ship_to_different: boolean;
  shipping_name: string | null;
  shipping_phone: string | null;
  shipping_city: string | null;
  shipping_address: string | null;
  shipping_zip: string | null;
};

/** העמודות של פרטי הקופה (ל-select) */
export const ORDER_CONTACT_COLUMNS =
  "customer_name, customer_tax_id, customer_phone, customer_email, billing_city, billing_address, billing_zip, " +
  "ship_to_different, shipping_name, shipping_phone, shipping_city, shipping_address, shipping_zip";

/** פרטי לקוח מהפרופיל — גיבוי להזמנות ישנות */
export type ProfileContact = {
  business_name?: string | null;
  contact_name?: string | null;
  phone?: string | null;
  business_address?: string | null;
  city?: string | null;
  zip_code?: string | null;
  tax_id?: string | null;
};

/** הזמנת אורח = בלי חשבון לקוח */
export function isGuestOrder(order: Pick<OrderContactFields, "customer_id">): boolean {
  return order.customer_id === null;
}

/** "הרצל 1, תל אביב 6100001" — מדלג על חלקים ריקים */
export function formatAddress(
  street: string | null | undefined,
  city: string | null | undefined,
  zip: string | null | undefined,
): string {
  const cityZip = [city?.trim(), zip?.trim()].filter(Boolean).join(" ");
  return [street?.trim(), cityZip].filter(Boolean).join(", ");
}

/** טלפון לתצוגה: 0501234567 → 050-123-4567, 031234567 → 03-123-4567 */
export function formatPhone(phone: string | null | undefined): string {
  const value = (phone ?? "").trim();
  if (/^05\d{8}$/.test(value)) return `${value.slice(0, 3)}-${value.slice(3, 6)}-${value.slice(6)}`;
  if (/^0[2-9]\d{7}$/.test(value))
    return `${value.slice(0, 2)}-${value.slice(2, 5)}-${value.slice(5)}`;
  if (/^07\d{8}$/.test(value)) return `${value.slice(0, 3)}-${value.slice(3, 6)}-${value.slice(6)}`;
  return value;
}

export type OrderBilling = {
  name: string;
  taxId: string;
  phone: string;
  email: string;
  address: string;
};

/** פרטי החיוב — מההזמנה, ואם חסר (הזמנה ישנה) מהפרופיל */
export function billingOf(
  order: Partial<OrderContactFields>,
  profile?: ProfileContact | null,
  accountEmail?: string | null,
): OrderBilling {
  const fromOrder = formatAddress(order.billing_address, order.billing_city, order.billing_zip);
  return {
    name: order.customer_name?.trim() || profile?.business_name?.trim() || "",
    taxId: order.customer_tax_id?.trim() || profile?.tax_id?.trim() || "",
    phone: formatPhone(order.customer_phone || profile?.phone),
    email: order.customer_email?.trim() || accountEmail?.trim() || "",
    address:
      fromOrder ||
      formatAddress(profile?.business_address, profile?.city ?? null, profile?.zip_code ?? null),
  };
}

export type OrderDelivery = {
  /** מי מקבל את המשלוח */
  name: string;
  phone: string;
  address: string;
  /** true = כתובת חלופית שהלקוח בחר בקופה ("שלח לכתובת אחרת") */
  isAlternate: boolean;
};

/** לאן לשלוח בפועל: הכתובת החלופית אם נבחרה, אחרת כתובת החיוב */
export function deliveryOf(
  order: Partial<OrderContactFields>,
  profile?: ProfileContact | null,
): OrderDelivery {
  const billing = billingOf(order, profile);
  if (order.ship_to_different) {
    return {
      name: order.shipping_name?.trim() || billing.name,
      phone: formatPhone(order.shipping_phone) || billing.phone,
      address: formatAddress(order.shipping_address, order.shipping_city, order.shipping_zip),
      isAlternate: true,
    };
  }
  return {
    name: profile?.contact_name?.trim() || billing.name,
    phone: billing.phone,
    address: billing.address,
    isAlternate: false,
  };
}
