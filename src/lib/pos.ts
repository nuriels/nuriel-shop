/**
 * קופה מהירה בניהול (חלק 32) — עזרים טהורים, משותפים לדפדפן ולשרת.
 *
 * הזמנה טלפונית / מכירה בחנות: המנהל בוחר לקוח (או מזין אורח), מוסיף
 * מוצרים מהקטלוג (חיפוש או סריקת ברקוד), בוחר מסירה, אמצעי תשלום והנחה.
 * ההזמנה עצמה נוצרת ומחושבת במסד (admin_create_order → הטריגרים של כל
 * הזמנה). החישובים כאן לתצוגה בלבד — הנוסחאות זהות למסד
 * (pos_unit_price, orders_shipping_and_total).
 */

// ------------------------------------------------------------
// אמצעי תשלום בקופה
// ------------------------------------------------------------

export type PosPaymentMethod = "cash" | "card" | "bit" | "transfer" | "check" | "later";

export const POS_PAYMENT_METHODS: readonly { value: PosPaymentMethod; label: string }[] = [
  { value: "cash", label: "מזומן" },
  { value: "card", label: "כרטיס אשראי" },
  { value: "bit", label: "ביט / פייבוקס" },
  { value: "transfer", label: "העברה בנקאית" },
  { value: "check", label: "צ׳ק" },
  { value: "later", label: "תשלום בהמשך" },
];

export const POS_PAYMENT_LABEL: Record<PosPaymentMethod, string> = {
  cash: "מזומן",
  card: "כרטיס אשראי",
  bit: "ביט / פייבוקס",
  transfer: "העברה בנקאית",
  check: "צ׳ק",
  later: "תשלום בהמשך",
};

export function isPosPaymentMethod(value: unknown): value is PosPaymentMethod {
  return typeof value === "string" && value in POS_PAYMENT_LABEL;
}

/** שדות הקופה בהזמנה — נבחרים יחד עם שאר פרטי ההזמנה */
export const ORDER_POS_COLUMNS = "order_source, pos_payment_method" as const;

export type OrderPosFields = {
  /** 'pos' = נוצרה בקופה המהירה */
  order_source?: string | null;
  pos_payment_method?: string | null;
};

/** "שולמה · מזומן" / "תשלום בהמשך" — לתג התשלום ולמיילים (null = לא הזמנת קופה) */
export function posPaymentText(
  method: string | null | undefined,
  paid: boolean,
): { label: string; paid: boolean } | null {
  if (!isPosPaymentMethod(method)) return null;
  if (method === "later" || !paid) {
    return {
      label: method === "later" ? "תשלום בהמשך" : `לתשלום: ${POS_PAYMENT_LABEL[method]}`,
      paid: false,
    };
  }
  return { label: `שולמה · ${POS_PAYMENT_LABEL[method]}`, paid: true };
}

// ------------------------------------------------------------
// הנחה ידנית
// ------------------------------------------------------------

export type ManualDiscountType = "percent" | "fixed";
export type ManualDiscount = { type: ManualDiscountType; value: number };

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * ההנחה הידנית בפועל — זהה למסד: על סכום המוצרים בלבד (בלי משלוח,
 * פיקדונות ומתנות), אחרי הקופון, ולא יותר ממה שנשאר לתשלום על המוצרים.
 */
export function manualDiscountAmount(
  discount: ManualDiscount | null | undefined,
  productsSubtotal: number,
  couponProductDiscount = 0,
): number {
  if (!discount || !Number.isFinite(discount.value) || discount.value <= 0) return 0;
  if (!Number.isFinite(productsSubtotal) || productsSubtotal <= 0) return 0;
  const raw =
    discount.type === "percent"
      ? round2((productsSubtotal * Math.min(100, discount.value)) / 100)
      : discount.value;
  const room = round2(productsSubtotal) - Math.max(0, couponProductDiscount);
  return Math.max(0, Math.min(raw, round2(room)));
}

/** הקלט של שדה ההנחה → הנחה (null = בלי) או שגיאה */
export function parseManualDiscount(
  type: ManualDiscountType,
  raw: string,
): { discount: ManualDiscount | null; problem: string | null } {
  const text = raw.trim().replace(",", ".");
  if (text === "") return { discount: null, problem: null };
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(text)) {
    return { discount: null, problem: "סכום ההנחה אינו תקין (מספר, עד 2 ספרות אחרי הנקודה)" };
  }
  const value = Number(text);
  if (value === 0) return { discount: null, problem: null };
  if (type === "percent" && value > 100) {
    return { discount: null, problem: "הנחה באחוזים — עד 100%" };
  }
  return { discount: { type, value }, problem: null };
}

/** "הנחה 10%" / "הנחה" */
export function manualDiscountLabel(
  type: string | null | undefined,
  value: number | string | null | undefined,
): string {
  const number = Number(value);
  if (type === "percent" && Number.isFinite(number) && number > 0) {
    return `הנחה ${Number.isInteger(number) ? number : number.toFixed(2)}%`;
  }
  return "הנחה";
}

/** צילום ההנחה הידנית על ההזמנה (חלק 32) */
export type OrderManualDiscountFields = {
  manual_discount_type?: string | null;
  manual_discount_value?: number | string | null;
  manual_discount_amount?: number | string | null;
};

/** ההנחה הידנית מחדש לפי הצילום על ההזמנה (עריכת הזמנה — כמו שהמסד יחשב) */
export function orderManualDiscount(
  order: OrderManualDiscountFields,
  productsSubtotal: number,
  couponProductDiscount = 0,
): number {
  const type = order.manual_discount_type;
  if (type !== "percent" && type !== "fixed") return 0;
  return manualDiscountAmount(
    { type, value: Number(order.manual_discount_value ?? 0) },
    productsSubtotal,
    couponProductDiscount,
  );
}

// ------------------------------------------------------------
// הקטלוג בקופה ותמחור
// ------------------------------------------------------------

export type PosVariant = {
  id: string;
  product_id: string;
  options: Record<string, string>;
  sku: string | null;
  price: number | null;
  stock_quantity: number | null;
  is_active: boolean;
};

export type PosProduct = {
  id: string;
  sku: string;
  name: string;
  category: string;
  barcode: string | null;
  image_url: string | null;
  price_tier1: number;
  price_tier2: number;
  price_tier3: number;
  sale_price: number | null;
  sale_starts_at: string | null;
  sale_ends_at: string | null;
  stock_quantity: number;
  is_hidden: boolean;
  is_digital: boolean;
  has_deposit: boolean;
  deposit_price: number | null;
  deposit_units: number | null;
  variant_attributes: unknown;
  /** הוריאציות הפעילות של המוצר (נטענות בנפרד) */
  variants: PosVariant[];
};

export type PosPricing = {
  /** הדרג האפקטיבי של הקונה (אורח = 1) */
  tier: number;
  /** מחירון אישי (רק ללקוח במחירון אישי) — productId → מחיר */
  customPrices: ReadonlyMap<string, number> | null;
};

export const GUEST_PRICING: PosPricing = { tier: 1, customPrices: null };

export function saleIsActive(
  product: Pick<PosProduct, "sale_price" | "sale_starts_at" | "sale_ends_at">,
  now: number = Date.now(),
): boolean {
  if (product.sale_price === null || product.sale_price === undefined) return false;
  if (product.sale_starts_at && Date.parse(product.sale_starts_at) > now) return false;
  if (product.sale_ends_at && Date.parse(product.sale_ends_at) < now) return false;
  return true;
}

/**
 * המחיר ליחידה כמו שהקונה היה משלם — זהה ל-pos_unit_price במסד: מחיר
 * הוריאציה → מחירון אישי → מחיר הדרג, ומבצע בתוקף כשהוא זול יותר.
 */
export function posUnitPrice(
  product: PosProduct,
  variant: Pick<PosVariant, "price"> | null,
  pricing: PosPricing = GUEST_PRICING,
  now: number = Date.now(),
): number {
  if (variant && variant.price !== null && variant.price !== undefined) {
    return round2(Number(variant.price));
  }
  const tierPrice =
    pricing.tier === 2
      ? product.price_tier2
      : pricing.tier === 3
        ? product.price_tier3
        : product.price_tier1;
  let price = Number(tierPrice ?? 0);
  const custom = pricing.customPrices?.get(product.id);
  if (custom !== undefined && Number.isFinite(custom)) price = Number(custom);
  if (saleIsActive(product, now)) price = Math.min(price, Number(product.sale_price));
  return round2(Number.isFinite(price) ? price : 0);
}

/** מלאי זמין לשורה: של הוריאציה (אם מנוהל בה), אחרת של המוצר; null = לא רלוונטי (דיגיטלי) */
export function availableStock(product: PosProduct, variant: PosVariant | null): number | null {
  if (product.is_digital) return null;
  if (variant && variant.stock_quantity !== null && variant.stock_quantity !== undefined) {
    return variant.stock_quantity;
  }
  return product.stock_quantity;
}

export function hasActiveVariants(product: Pick<PosProduct, "variants">): boolean {
  return product.variants.some((variant) => variant.is_active);
}

// ------------------------------------------------------------
// חיפוש מוצר / סריקת ברקוד
// ------------------------------------------------------------

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * מוצר לפי קוד מדויק — ברקוד, מק"ט, או מק"ט של וריאציה (קורא ברקודים
 * "מקליד" את הקוד ולוחץ Enter). null = אין התאמה יחידה.
 */
export function exactCodeMatch(
  products: readonly PosProduct[],
  raw: string,
): { product: PosProduct; variant: PosVariant | null } | null {
  const code = raw.trim();
  if (code === "") return null;
  const lower = code.toLowerCase();
  for (const product of products) {
    if ((product.barcode ?? "") === code || product.sku === code) {
      return { product, variant: null };
    }
  }
  for (const product of products) {
    const variant = product.variants.find(
      (v) => v.is_active && (v.sku ?? "").toLowerCase() === lower,
    );
    if (variant) return { product, variant };
  }
  return null;
}

/**
 * חיפוש לקופה: התאמה מדויקת של קוד קודם, אחר כך שם שמתחיל במונח, ואז
 * שם / מק"ט / ברקוד שמכילים אותו (כל המילים). מוצרים מוסתרים — בסוף.
 */
export function searchPosProducts(
  products: readonly PosProduct[],
  term: string,
  limit = 8,
): PosProduct[] {
  const query = normalize(term);
  if (query === "") return [];
  const words = query.split(" ");
  const scored: { product: PosProduct; score: number }[] = [];
  for (const product of products) {
    const name = normalize(product.name);
    const codes = [product.sku, product.barcode ?? "", ...product.variants.map((v) => v.sku ?? "")]
      .map((code) => code.toLowerCase())
      .filter(Boolean);
    let score = 0;
    if (codes.includes(query)) score = 100;
    else if (name === query) score = 90;
    else if (name.startsWith(query)) score = 70;
    else if (words.every((word) => name.includes(word))) score = 50;
    else if (codes.some((code) => code.includes(query))) score = 40;
    if (score === 0) continue;
    if (product.is_hidden) score -= 5;
    scored.push({ product, score });
  }
  scored.sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name, "he"));
  return scored.slice(0, limit).map((entry) => entry.product);
}

// ------------------------------------------------------------
// העגלה והסיכום
// ------------------------------------------------------------

export type PosCartLine = {
  /** מפתח יציב לשורה (מוצר + וריאציה) */
  key: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPrice: number;
  /** המנהל שינה את המחיר ידנית — לא מתעדכן כשמחליפים לקוח */
  priceEdited: boolean;
};

export const POS_MAX_QUANTITY = 99_999;
export const POS_MAX_LINES = 200;

export function lineKey(productId: string, variantId: string | null): string {
  return `${productId}:${variantId ?? ""}`;
}

export function clampQuantity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(POS_MAX_QUANTITY, Math.max(1, Math.floor(value)));
}

export type PosShippingChoice = {
  /** null = מכירה בחנות (נמסר במקום) */
  methodId: string | null;
  kind: "delivery" | "pickup" | null;
  price: number;
};

export type PosTotals = {
  /** סכום המוצרים (בלי פיקדונות) */
  products: number;
  deposits: number;
  shipping: number;
  /** משלוח חינם בזכות סף המשלוח החינם של החנות */
  freeShipping: boolean;
  discount: number;
  total: number;
  units: number;
};

/**
 * הסכום לתשלום — כמו במסד: מוצרים + פיקדונות + משלוח − הנחה ידנית.
 * משלוח עד הבית חינם כשסכום המוצרים מגיע לסף של החנות.
 */
export function posTotals(
  lines: readonly PosCartLine[],
  productsById: ReadonlyMap<string, PosProduct>,
  shipping: PosShippingChoice,
  discount: ManualDiscount | null,
  freeShippingThreshold: number | null | undefined,
): PosTotals {
  let products = 0;
  let deposits = 0;
  let units = 0;
  for (const line of lines) {
    products += line.quantity * line.unitPrice;
    units += line.quantity;
    const product = productsById.get(line.productId);
    if (product?.has_deposit && product.deposit_price !== null && product.deposit_units !== null) {
      deposits +=
        line.quantity * round2(Number(product.deposit_price) * Number(product.deposit_units));
    }
  }
  products = round2(products);
  deposits = round2(deposits);
  const threshold = Number(freeShippingThreshold ?? 0);
  const freeShipping =
    shipping.methodId !== null &&
    shipping.kind === "delivery" &&
    threshold > 0 &&
    products >= threshold &&
    shipping.price > 0;
  const shippingAmount = shipping.methodId === null || freeShipping ? 0 : round2(shipping.price);
  const discountAmount = manualDiscountAmount(discount, products);
  return {
    products,
    deposits,
    shipping: shippingAmount,
    freeShipping,
    discount: discountAmount,
    total: round2(products + deposits + shippingAmount - discountAmount),
    units,
  };
}

// ------------------------------------------------------------
// פרטי הלקוח
// ------------------------------------------------------------

/** 050-123 4567 → 0501234567 (+972… נשאר עם +) — כמו במסד */
export function normalizePosPhone(raw: string): string {
  return raw.replace(/[^0-9+]/g, "");
}

export function posPhoneProblem(raw: string, required: boolean): string | null {
  const phone = normalizePosPhone(raw);
  if (phone === "") return required ? "נא להזין מספר טלפון נייד של הלקוח" : null;
  return /^\+?\d{9,15}$/.test(phone) ? null : "מספר הטלפון אינו תקין";
}

export function posEmailProblem(raw: string): string | null {
  const email = raw.trim();
  if (email === "") return null;
  return email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
    ? null
    : "כתובת האימייל אינה תקינה";
}

export function posZipProblem(raw: string): string | null {
  const zip = raw.replace(/\D/g, "");
  if (zip === "") return null;
  return /^\d{5,7}$/.test(zip) ? null : "מיקוד לא תקין (5 או 7 ספרות) — או השאירו ריק";
}

/** לקוח מתוצאות החיפוש (admin_search_customers) */
export type PosCustomer = {
  kind: "account" | "guest";
  customer_id: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  city: string | null;
  address: string | null;
  zip: string | null;
  price_tier: number;
  price_list_type: string;
  orders_count: number;
  last_order_at: string | null;
};

export type PosCustomerForm = {
  name: string;
  phone: string;
  email: string;
  city: string;
  address: string;
  zip: string;
};

export const EMPTY_CUSTOMER_FORM: PosCustomerForm = {
  name: "",
  phone: "",
  email: "",
  city: "",
  address: "",
  zip: "",
};

export function customerFormFrom(customer: PosCustomer): PosCustomerForm {
  return {
    name: customer.name ?? "",
    phone: customer.phone ?? "",
    email: customer.email ?? "",
    city: customer.city ?? "",
    address: customer.address ?? "",
    zip: customer.zip ?? "",
  };
}

// ------------------------------------------------------------
// בדיקה לפני שליחה + המבנה שהמסד מקבל
// ------------------------------------------------------------

export type PosDraft = {
  /** לקוח רשום שנבחר (null = אורח) */
  customerId: string | null;
  form: PosCustomerForm;
  lines: readonly PosCartLine[];
  shipping: PosShippingChoice;
  payment: PosPaymentMethod;
  paid: boolean;
  discount: ManualDiscount | null;
  note: string;
};

/** כל מה שחסר / שגוי — בסדר שבו הוא מופיע במסך (ריק = מוכן) */
export function posDraftProblems(
  draft: PosDraft,
  productsById: ReadonlyMap<string, PosProduct>,
): string[] {
  const problems: string[] = [];
  const guest = draft.customerId === null;
  if (guest) {
    const name = draft.form.name.trim().replace(/\s+/g, " ");
    if (name === "") problems.push("נא להזין את שם הלקוח (או לבחור לקוח קיים)");
    else if (name.length < 2 || name.length > 120) problems.push("שם הלקוח: בין 2 ל-120 תווים");
  }
  const phoneProblem = posPhoneProblem(draft.form.phone, guest);
  if (phoneProblem) problems.push(phoneProblem);
  const emailProblem = posEmailProblem(draft.form.email);
  if (emailProblem) problems.push(emailProblem);
  if (draft.shipping.kind === "delivery") {
    if (draft.form.city.trim().length < 2 || draft.form.address.trim().length < 2) {
      problems.push("למשלוח עד הבית נא להזין עיר וכתובת (רחוב ומספר בית)");
    }
    const zipProblem = posZipProblem(draft.form.zip);
    if (zipProblem) problems.push(zipProblem);
  }
  if (draft.lines.length === 0) problems.push("הוסיפו לפחות מוצר אחד להזמנה");
  if (draft.lines.length > POS_MAX_LINES) problems.push(`עד ${POS_MAX_LINES} שורות בהזמנה אחת`);
  for (const line of draft.lines) {
    const product = productsById.get(line.productId);
    if (!product) {
      problems.push("אחד המוצרים כבר לא קיים בקטלוג — הסירו אותו מהעגלה");
      continue;
    }
    if (line.variantId === null && hasActiveVariants(product)) {
      problems.push(`בחרו אפשרות עבור "${product.name}"`);
    }
    if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0) {
      problems.push(`המחיר של "${product.name}" אינו תקין`);
    }
  }
  if (draft.note.trim().length > 1000) problems.push("ההערה ארוכה מדי (עד 1000 תווים)");
  return problems;
}

export type PosOrderPayload = {
  _customer_id: string | null;
  _items: { product_id: string; variant_id: string | null; quantity: number; unit_price: string }[];
  _details: {
    [key: string]: string | boolean | null | { type: ManualDiscountType; value: string };
  };
};

/** הפרמטרים ל-admin_create_order (המחיר נשלח תמיד — מה שהמנהל ראה הוא מה שנשמר) */
export function posOrderPayload(draft: PosDraft): PosOrderPayload {
  const delivery = draft.shipping.kind === "delivery";
  return {
    _customer_id: draft.customerId,
    _items: draft.lines.map((line) => ({
      product_id: line.productId,
      variant_id: line.variantId,
      quantity: clampQuantity(line.quantity),
      unit_price: round2(Math.max(0, line.unitPrice)).toFixed(2),
    })),
    _details: {
      customer_name: draft.form.name.trim(),
      customer_phone: normalizePosPhone(draft.form.phone),
      customer_email: draft.form.email.trim(),
      // כתובת — רק במשלוח עד הבית (במכירה בחנות / איסוף אין בה צורך)
      city: delivery ? draft.form.city.trim() : "",
      address: delivery ? draft.form.address.trim() : "",
      zip: delivery ? draft.form.zip.replace(/\D/g, "") : "",
      fulfillment: draft.shipping.methodId === null ? "in_store" : "shipping",
      shipping_method_id: draft.shipping.methodId,
      payment_method: draft.payment,
      paid: draft.payment !== "later" && draft.paid,
      discount: draft.discount
        ? { type: draft.discount.type, value: draft.discount.value.toFixed(2) }
        : null,
      note: draft.note.trim(),
    },
  };
}
