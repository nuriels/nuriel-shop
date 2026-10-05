/**
 * סליקה (חלק 16) — עזרים טהורים, משותפים לדפדפן ולשרת: טיפוסים, קריאת
 * התשובות מהמסד, בדיקת פרטי העוסק, והטקסטים של ההדרכה וההבהרה המשפטית.
 */

/** הרשמה למסוף סליקה ב-MAX */
export const MAX_SIGNUP_URL = "https://www.max.co.il/business/pay/simplepay";

export const MAX_SIGNUP_GUIDE =
  "לאחר ההרשמה ופתיחת מסוף בחברת MAX, יש לבקש מנציגי השירות את 'מספר המסוף' ו'סיסמת ה-API' שלכם, ולהזין אותם בשדות כאן למטה כדי להתחיל לסלוק כסף לחשבונכם.";

export const LEGAL_INVOICE_NOTICE =
  "הבהרה חשובה: המערכת אינה מנפיקה חשבוניות מס או קבלות ללקוחות הקצה, אלא מפיקה 'אישורי הזמנה' בלבד. הפקת חשבוניות מס כחוק הינה באחריותו הבלעדית של בעל החנות מול רשויות המס (ניתן לעבוד עם מערכות הנהלת חשבונות חיצוניות).";

/** הנתיב שאליו Hyp מחזיר את הלקוח (זהה ל-HYP_RETURN_PATH בשרת) */
export const HYP_RETURN_PATH = "/payments/hyp/return";

/** הכתובת להגדרה במסוף ב-Hyp כ"דף הצלחה" וגם כ"דף כישלון" */
export function hypReturnUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}${HYP_RETURN_PATH}`;
}

/** הודעת שרת-לשרת (Webhook / IPN) — זהה ל-HYP_WEBHOOK_PATH בשרת (חלק 16ב) */
export const HYP_WEBHOOK_PATH = "/api/webhooks/hyp";

/** הכתובת להגדרה במסוף ב-Hyp כהודעת שרת אחרי תשלום */
export function hypWebhookUrl(origin: string): string {
  return `${origin.replace(/\/$/, "")}${HYP_WEBHOOK_PATH}`;
}

/** טוקן של כוונת תשלום (Order ב-Hyp) — 32 תווים הקסדצימליים */
export function isAddonOrPlanToken(value: string): boolean {
  return /^[0-9a-f]{32}$/.test(value);
}

// ------------------------------------------------------------
// הגדרות המסוף
// ------------------------------------------------------------

/** תוצאת "בדיקת סליקה" (חיוב של ₪1) האחרונה */
export type PaymentTestResult = {
  status: "pending" | "paid" | "failed" | "expired";
  transactionId: string | null;
  cardLast4: string | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type PaymentSettings = {
  terminal: string | null;
  /** חנות: סליקה פעילה בקופה; פלטפורמה: מוכנה (מסוף + סיסמה + מפתח) */
  enabled: boolean;
  maxPayments: number;
  hasPassword: boolean;
  hasKey: boolean;
  /** 4 התווים האחרונים של מפתח ה-API (הסודות עצמם לא חוזרים מהשרת) */
  keyHint: string | null;
  updatedAt: string | null;
  /** בדיקת הסליקה האחרונה (null = עוד לא בוצעה) */
  lastTest: PaymentTestResult | null;
  /**
   * חלק 16ב: הסליקה פתוחה במערכת (המתג הראשי במסד). false = ממתינה לאישור
   * סופי של חברת האשראי — אפשר לשמור פרטי מסוף ולבדוק, אבל לא להפעיל.
   */
  live: boolean;
};

type Raw = Record<string, unknown>;
const obj = (value: unknown): Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Raw) : {};
const strOrNull = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;
const numOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export function parsePaymentSettings(raw: unknown): PaymentSettings {
  const row = obj(raw);
  return {
    terminal: strOrNull(row["terminal"]),
    enabled: row["enabled"] === true || row["ready"] === true,
    maxPayments: numOrNull(row["max_payments"]) ?? 1,
    hasPassword: row["has_password"] === true,
    hasKey: row["has_key"] === true,
    keyHint: strOrNull(row["key_hint"]),
    updatedAt: strOrNull(row["updated_at"]),
    lastTest: parsePaymentTest(row["last_test"]),
    live: row["live"] === true,
  };
}

export function parsePaymentTest(raw: unknown): PaymentTestResult | null {
  const row = obj(raw);
  const status = row["status"];
  if (status !== "pending" && status !== "paid" && status !== "failed" && status !== "expired") {
    return null;
  }
  return {
    status,
    transactionId: strOrNull(row["transaction_id"]),
    cardLast4: strOrNull(row["card_last4"]),
    error: strOrNull(row["error"]),
    createdAt: String(row["created_at"] ?? ""),
    completedAt: strOrNull(row["completed_at"]),
  };
}

// ------------------------------------------------------------
// פרטי העוסק
// ------------------------------------------------------------

export type BusinessType = "exempt" | "licensed" | "company";

export const BUSINESS_TYPES: BusinessType[] = ["exempt", "licensed", "company"];

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  exempt: "עוסק פטור",
  licensed: "עוסק מורשה",
  company: 'חברה בע"מ',
};

/** התווית של שדה המספר לפי סוג העוסק */
export function taxIdLabel(type: BusinessType | ""): string {
  return type === "company" ? "ח.פ" : type === "exempt" ? "ת.ז / ע.פ" : "ע.מ";
}

export type BillingProfile = {
  businessType: BusinessType;
  companyName: string;
  taxId: string;
  address: string;
  billingEmail: string | null;
};

export type BillingProfileInput = {
  businessType: BusinessType | "" | undefined;
  companyName: string;
  taxId: string;
  address: string;
  billingEmail?: string;
};

export function parseBillingProfile(raw: unknown): BillingProfile {
  const row = obj(raw);
  const type = row["business_type"];
  return {
    businessType: type === "exempt" || type === "company" ? type : "licensed",
    companyName: String(row["company_name"] ?? ""),
    taxId: String(row["tax_id"] ?? ""),
    address: String(row["address"] ?? ""),
    billingEmail: strOrNull(row["billing_email"]),
  };
}

/** ספרת ביקורת של ת.ז / ע.מ / ח.פ — זהה ל-israeli_id_valid במסד */
export function israeliIdValid(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (!/^[0-9]{5,9}$/.test(digits)) return false;
  const padded = digits.padStart(9, "0");
  if (padded === "000000000") return false;
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    const d = Number(padded[i]) * (i % 2 === 0 ? 1 : 2);
    sum += d > 9 ? d - 9 : d;
  }
  return sum % 10 === 0;
}

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** null = תקין; אחרת — ההודעה הראשונה לתיקון */
export function billingProfileProblem(input: BillingProfileInput): string | null {
  if (!input.businessType || !BUSINESS_TYPES.includes(input.businessType)) {
    return "בחרו סוג עוסק";
  }
  const name = input.companyName.trim();
  if (name.length < 2 || name.length > 120) return "שם העסק / החברה: 2 עד 120 תווים";
  const taxId = input.taxId.replace(/\D/g, "");
  if (!/^[0-9]{9}$/.test(taxId.padStart(9, "0")) || taxId.length < 8 || !israeliIdValid(taxId)) {
    return `מספר ${taxIdLabel(input.businessType)} אינו תקין (9 ספרות)`;
  }
  const address = input.address.trim();
  if (address.length < 4 || address.length > 200) return "כתובת העסק: 4 עד 200 תווים";
  const email = (input.billingEmail ?? "").trim();
  if (email !== "" && (email.length > 254 || !EMAIL.test(email))) return "כתובת המייל אינה תקינה";
  return null;
}

// ------------------------------------------------------------
// מנוי שנתי
// ------------------------------------------------------------

export type PlanQuote = {
  plan: "basic" | "premium";
  title: string;
  months: number;
  monthlyPrice: number;
  /** סכום התוספים החודשיים הפעילים שמתחדשים יחד עם המנוי */
  addonsMonthly: number;
  addonTitles: string[];
  amount: number;
  /** חידוש של אותה חבילה (התקופה מתווספת לסוף הנוכחית) */
  renewal: boolean;
  currentPeriodEnd: string | null;
  paymentsReady: boolean;
  maxPayments: number;
};

export function parsePlanQuote(raw: unknown): PlanQuote {
  const row = obj(raw);
  return {
    plan: row["plan"] === "premium" ? "premium" : "basic",
    title: String(row["title"] ?? ""),
    months: numOrNull(row["months"]) ?? 12,
    monthlyPrice: numOrNull(row["monthly_price"]) ?? 0,
    addonsMonthly: numOrNull(row["addons_monthly"]) ?? 0,
    addonTitles: Array.isArray(row["addon_titles"]) ? row["addon_titles"].map(String) : [],
    amount: numOrNull(row["amount"]) ?? 0,
    renewal: row["renewal"] === true,
    currentPeriodEnd: strOrNull(row["current_period_end"]),
    paymentsReady: row["payments_ready"] === true,
    maxPayments: numOrNull(row["max_payments"]) ?? 12,
  };
}

// ------------------------------------------------------------
// דף התוצאה
// ------------------------------------------------------------

export type PaymentResult = {
  status: "paid" | "pending" | "failed" | "expired" | "unknown";
  orderNumber: string | null;
  amount: number | null;
  /** ההזמנה עצמה סומנה "שולמה" (גם אם הניסיון הזה נכשל ואחר הצליח) */
  orderPaid: boolean;
};

/** ?payment= בפאנל הניהול אחרי חזרה מ-Hyp */
export type PaymentOutcome = "success" | "failed" | "unverified";

export function paymentOutcomeOf(value: unknown): PaymentOutcome | undefined {
  return value === "success" || value === "failed" || value === "unverified" ? value : undefined;
}

/** אחרי חזרה מ"בדיקת סליקה" (חיוב של ₪1) */
export const PAYMENT_TEST_OUTCOME_TEXT: Record<PaymentOutcome, string> = {
  success: "בדיקת הסליקה עברה בהצלחה! ₪1 חויב ואומת מול חברת האשראי — המסוף מחובר ועובד תקין.",
  failed:
    "החיוב של ₪1 לא עבר (הכרטיס נדחה או שהתשלום בוטל). בדקו את הכרטיס או את הגדרות המסוף ונסו שוב.",
  unverified:
    "חזרתם מדף התשלום, אבל האימות מול Hyp נכשל — כנראה שסיסמת ה-API או מפתח ה-API אינם נכונים. בדקו אותם ונסו שוב.",
};

export const PAYMENT_OUTCOME_TEXT: Record<PaymentOutcome, string> = {
  success: "התשלום התקבל בהצלחה — תודה! הרכישה הופעלה.",
  failed: "התשלום לא הושלם. לא חויבתם — אפשר לנסות שוב.",
  unverified:
    "לא הצלחנו לאמת את התשלום מול חברת האשראי. אם חויבתם — פנו אלינו בצ'אט התמיכה ונטפל מיד.",
};
