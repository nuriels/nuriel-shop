/**
 * טופס הקופה: סוגים, בדיקות בדפדפן (משקפות את normalize_checkout_details
 * במסד — שם הבדיקה המחייבת), והמרה למבנה שנשלח להזמנה.
 * משותף לקופה (לקוח רשום ואורח) ולאזור האישי.
 */

import type { CartItem } from "@/lib/orders";

export type CheckoutForm = {
  /** שם מלא / שם חברה */
  customerName: string;
  /** ת.ז / ח.פ */
  customerTaxId: string;
  customerPhone: string;
  customerEmail: string;
  billingCity: string;
  billingAddress: string;
  billingZip: string;
  /** "שלח לכתובת אחרת" */
  shipToDifferent: boolean;
  shippingName: string;
  shippingPhone: string;
  shippingCity: string;
  shippingAddress: string;
  shippingZip: string;
  note: string;
  acceptedTerms: boolean;
};

export const EMPTY_CHECKOUT_FORM: CheckoutForm = {
  customerName: "",
  customerTaxId: "",
  customerPhone: "",
  customerEmail: "",
  billingCity: "",
  billingAddress: "",
  billingZip: "",
  shipToDifferent: false,
  shippingName: "",
  shippingPhone: "",
  shippingCity: "",
  shippingAddress: "",
  shippingZip: "",
  note: "",
  acceptedTerms: false,
};

export type CheckoutErrors = Partial<Record<keyof CheckoutForm, string>>;

export const NOTE_MAX = 1000;
const EMAIL_FORMAT = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const digitsOnly = (value: string): string => value.replace(/\D/g, "");
/** טלפון כפי שנשמר במסד: ספרות בלבד (ו-+ בינלאומי בהתחלה) */
export const normalizePhone = (value: string): string => value.replace(/[^0-9+]/g, "");

export function isValidTaxId(value: string): boolean {
  return /^[0-9]{5,12}$/.test(digitsOnly(value));
}
export function isValidPhone(value: string): boolean {
  return /^\+?[0-9]{9,15}$/.test(normalizePhone(value));
}
export function isValidZip(value: string): boolean {
  return /^[0-9]{5,7}$/.test(digitsOnly(value));
}
export function isValidEmail(value: string): boolean {
  const email = value.trim();
  return email.length <= 254 && EMAIL_FORMAT.test(email);
}

const between = (value: string, min: number, max: number) => {
  const length = value.trim().length;
  return length >= min && length <= max;
};

/**
 * אותן הודעות כמו במסד — כדי שהלקוח יראה את הבעיה ליד השדה, לפני השליחה.
 * requireAddress = false (איסוף עצמי / סל דיגיטלי): הכתובת רשות — ואם הוזנה,
 * נבדקת — ואין "שלח לכתובת אחרת".
 */
export function validateCheckoutForm(
  form: CheckoutForm,
  { requireEmail, requireAddress = true }: { requireEmail: boolean; requireAddress?: boolean },
): CheckoutErrors {
  const errors: CheckoutErrors = {};
  if (!between(form.customerName, 2, 120)) errors.customerName = "נא להזין שם מלא או שם חברה";
  if (!isValidTaxId(form.customerTaxId)) {
    errors.customerTaxId = "נא להזין מספר ת.ז / ח.פ תקין (ספרות בלבד)";
  }
  if (!isValidPhone(form.customerPhone)) errors.customerPhone = "נא להזין מספר טלפון תקין";
  if (form.customerEmail.trim() === "") {
    if (requireEmail) errors.customerEmail = "נא להזין כתובת אימייל — אליה יישלח אישור ההזמנה";
  } else if (!isValidEmail(form.customerEmail)) {
    errors.customerEmail = "כתובת האימייל אינה תקינה";
  }
  const optional = (value: string) => !requireAddress && value.trim() === "";
  if (!optional(form.billingCity) && !between(form.billingCity, 2, 80)) {
    errors.billingCity = "נא להזין עיר";
  }
  if (!optional(form.billingAddress) && !between(form.billingAddress, 2, 200)) {
    errors.billingAddress = "נא להזין כתובת (רחוב ומספר בית)";
  }
  if (!optional(form.billingZip) && !isValidZip(form.billingZip)) {
    errors.billingZip = "נא להזין מיקוד תקין (5 או 7 ספרות)";
  }

  if (requireAddress && form.shipToDifferent) {
    if (!between(form.shippingName, 2, 120)) errors.shippingName = "נא להזין את שם מקבל המשלוח";
    if (form.shippingPhone.trim() !== "" && !isValidPhone(form.shippingPhone)) {
      errors.shippingPhone = "מספר הטלפון של מקבל המשלוח אינו תקין";
    }
    if (!between(form.shippingCity, 2, 80)) errors.shippingCity = "נא להזין את עיר המשלוח";
    if (!between(form.shippingAddress, 2, 200)) {
      errors.shippingAddress = "נא להזין את כתובת המשלוח (רחוב ומספר בית)";
    }
    if (!isValidZip(form.shippingZip)) {
      errors.shippingZip = "נא להזין מיקוד תקין לכתובת המשלוח (5 או 7 ספרות)";
    }
  }
  if (form.note.trim().length > NOTE_MAX) errors.note = "ההערות ארוכות מדי (עד 1000 תווים)";
  if (!form.acceptedTerms) errors.acceptedTerms = "יש לאשר את תנאי השימוש כדי להשלים את ההזמנה";
  return errors;
}

/** פרטי הקופה במבנה שהמסד מקבל (place_order / place_guest_order) */
export type CheckoutPayload = {
  customer_name: string;
  customer_tax_id: string;
  customer_phone: string;
  customer_email: string;
  billing_city: string;
  billing_address: string;
  billing_zip: string;
  ship_to_different: boolean;
  shipping_name: string;
  shipping_phone: string;
  shipping_city: string;
  shipping_address: string;
  shipping_zip: string;
  note: string;
  accepted_terms: boolean;
  /** שיטת המשלוח שנבחרה ("" = בלי — סל דיגיטלי בלבד) */
  shipping_method_id: string;
};

export function checkoutPayload(
  form: CheckoutForm,
  shipping: { methodId: string | null; requireAddress: boolean } = {
    methodId: null,
    requireAddress: true,
  },
): CheckoutPayload {
  const alternate = shipping.requireAddress && form.shipToDifferent;
  return {
    customer_name: form.customerName.trim(),
    customer_tax_id: digitsOnly(form.customerTaxId),
    customer_phone: normalizePhone(form.customerPhone),
    customer_email: form.customerEmail.trim().toLowerCase(),
    billing_city: form.billingCity.trim(),
    billing_address: form.billingAddress.trim(),
    billing_zip: digitsOnly(form.billingZip),
    ship_to_different: alternate,
    shipping_name: alternate ? form.shippingName.trim() : "",
    shipping_phone: alternate ? normalizePhone(form.shippingPhone) : "",
    shipping_city: alternate ? form.shippingCity.trim() : "",
    shipping_address: alternate ? form.shippingAddress.trim() : "",
    shipping_zip: alternate ? digitsOnly(form.shippingZip) : "",
    note: form.note.trim(),
    accepted_terms: form.acceptedTerms,
    shipping_method_id: shipping.methodId ?? "",
  };
}

export type OrderLineInput = {
  product_id: string;
  /** הוריאציה שנבחרה (צבע / מידה...) */
  variant_id?: string;
  quantity: number;
  unit_price: number;
  is_deposit?: boolean;
};

/**
 * שורות ההזמנה מהסל: מוצר, וריאציה וכמות. המחירים, הפיקדון (שורה אחת לכל
 * מוצר) והמתנות נקבעים במסד — מה שנשלח מכאן הוא רק ברירת מחדל לתצוגה.
 */
export function orderLinesFromCart(items: CartItem[], kind: "order" | "quote"): OrderLineInput[] {
  return items.map((item) => ({
    product_id: item.productId,
    ...(item.variantId ? { variant_id: item.variantId } : {}),
    quantity: item.quantity,
    unit_price: kind === "quote" ? 0 : item.price,
  }));
}

/** פרטי "הפרטים שלי" באזור האישי (ברירת המחדל בקופה) */
export type MyDetails = {
  businessName: string;
  contactName: string;
  taxId: string;
  phone: string;
  city: string;
  address: string;
  zipCode: string;
};

export type MyDetailsErrors = Partial<Record<keyof MyDetails, string>>;

export function validateMyDetails(details: MyDetails): MyDetailsErrors {
  const errors: MyDetailsErrors = {};
  if (!between(details.businessName, 2, 120)) errors.businessName = "נא להזין שם מלא או שם חברה";
  if (details.contactName.trim().length > 80) errors.contactName = "שם איש הקשר ארוך מדי";
  if (details.taxId.trim() !== "" && !isValidTaxId(details.taxId)) {
    errors.taxId = "מספר ת.ז / ח.פ: ספרות בלבד (5 עד 12)";
  }
  if (details.phone.trim() !== "" && !isValidPhone(details.phone)) {
    errors.phone = "נא להזין מספר טלפון תקין";
  }
  if (details.city.trim().length > 80) errors.city = "שם העיר ארוך מדי";
  if (details.address.trim().length > 200) errors.address = "הכתובת ארוכה מדי";
  if (details.zipCode.trim() !== "" && !isValidZip(details.zipCode)) {
    errors.zipCode = "מיקוד: 5 או 7 ספרות";
  }
  return errors;
}
