// Billing & Agreements (מיגרציה 189) — לוגיקה טהורה (בלי שרת ובלי React): בדיקת קלט לפני שליחה למסד
// (המסד בודק שוב), ותצוגה: סכומים, תאריכים ותוויות. אין כאן חישוב כספי — הסכומים מגיעים מהמסד.
import type {
  AgreementInput,
  BillingCycle,
  EntryCategory,
  EntryInput,
  EntryKind,
  PaymentMethod,
  PriceParts,
  RequestStatus,
  VatMode,
} from "./types";

export class BillingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingInputError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLAN_CODE = /^[a-z][a-z0-9_]{1,30}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_AMOUNT = 1_000_000;

export const CYCLE_LABELS: Record<BillingCycle, string> = { monthly: "חודשי", yearly: "שנתי" };
export const VAT_MODE_LABELS: Record<VatMode, string> = {
  included: "המחיר כולל מע״מ",
  excluded: "המחיר לפני מע״מ (המע״מ מתווסף)",
};
export const KIND_LABELS: Record<EntryKind, string> = {
  charge: "חיוב",
  payment: "תשלום",
  credit: "זיכוי",
  reversal: "ביטול רישום",
};
export const CATEGORY_LABELS: Record<EntryCategory, string> = {
  subscription: "מנוי",
  setup: "דמי הקמה",
  other: "אחר",
};
export const METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: "העברה בנקאית",
  bit: "Bit",
  credit_card: "כרטיס אשראי",
  cash: "מזומן",
  check: "צ׳ק",
  other: "אחר",
};
export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  pending: "ממתינה לטיפול",
  approved: "אושרה",
  rejected: "לא אושרה",
  canceled: "בוטלה",
};
export const ENGINE_LABELS = { ecommerce: "חנות אונליין", hospitality: "אתר צימר" } as const;

/**
 * "אושר" שמור לאישור אמיתי מספק תשלומים. תשלום שמנהל הפלטפורמה רשם — "התקבל (נרשם על ידי Nuriel)"
 */
export function confirmationLabel(confirmation: "manual" | "provider"): string {
  return confirmation === "provider" ? "אושר על ידי ספק התשלומים" : "התקבל (נרשם על ידי Nuriel)";
}

// ---------------------------------------------------------------- תצוגה

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const fractional = Math.round(value * 100) % 100 !== 0;
  const text = Math.abs(value).toLocaleString("he-IL", {
    minimumFractionDigits: fractional ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `${value < 0 ? "−" : ""}₪${text}`;
}

/** 2026-11-14 → 14/11/2026 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

/** שורת מחיר עם מע"מ, למשל "₪200 כולל מע״מ 18%" או "₪200 + מע״מ 18% (₪36) = ₪236" */
export function priceLine(parts: PriceParts | null | undefined): string {
  if (!parts) return "—";
  if (parts.mode === "list") return `${formatMoney(parts.gross)} (לפי המחירון)`;
  const rate = parts.rate ?? 0;
  if (parts.mode === "included") {
    return rate > 0
      ? `${formatMoney(parts.gross)} כולל מע״מ ${rate}%`
      : `${formatMoney(parts.gross)} (ללא מע״מ)`;
  }
  if (rate === 0) return `${formatMoney(parts.net ?? parts.gross)} (ללא מע״מ)`;
  return `${formatMoney(parts.net ?? 0)} + מע״מ ${rate}% (${formatMoney(parts.vat ?? 0)}) = ${formatMoney(parts.gross)}`;
}

export function daysLeftText(days: number | null | undefined): string {
  if (days === null || days === undefined) return "ללא תאריך סיום";
  if (days === 0) return "מסתיים היום";
  if (days === 1) return "נותר יום אחד";
  return `נותרו ${days} ימים`;
}

/** יתרה: חיובי — לתשלום; אפס — אין יתרה; שלילי — שולם יותר מהנדרש */
export function balanceText(balance: number): string {
  if (Math.abs(balance) < 0.005) return "אין יתרה";
  return balance > 0 ? `${formatMoney(balance)} לתשלום` : `${formatMoney(-balance)} זכות`;
}

// ---------------------------------------------------------------- קלט

function text(value: unknown, max: number): string | null {
  const t = String(value ?? "").trim();
  if (!t) return null;
  return t.slice(0, max);
}

/** סכום: ריק → null; מספר אי-שלילי עד מיליון, מעוגל לאגורות */
export function parseAmount(value: unknown, label: string, opts: { positive?: boolean } = {}): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(String(value).replace(/[,₪\s]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) throw new BillingInputError(`${label}: סכום לא תקין`);
  if (opts.positive && n <= 0) throw new BillingInputError(`${label}: הסכום חייב להיות גדול מאפס`);
  return Math.round(n * 100) / 100;
}

export function parseIsoDate(value: unknown, label: string): string | null {
  const t = String(value ?? "").trim();
  if (!t) return null;
  if (!ISO_DATE.test(t) || Number.isNaN(Date.parse(`${t}T00:00:00Z`)))
    throw new BillingInputError(`${label}: תאריך לא תקין`);
  return t;
}

export function parseUuid(value: unknown, label = "מזהה"): string {
  const t = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!UUID.test(t)) throw new BillingInputError(`${label} לא תקין`);
  return t;
}

export function parseVatRate(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new BillingInputError("שיעור מע״מ: 0 עד 100");
  return Math.round(n * 100) / 100;
}

export function parseAgreementInput(raw: Record<string, unknown> | null | undefined): AgreementInput {
  const r = raw ?? {};
  const plan = String(r["plan"] ?? "")
    .trim()
    .toLowerCase();
  if (!PLAN_CODE.test(plan)) throw new BillingInputError("בחרו חבילה");
  const cycle = r["billing_cycle"] === "yearly" ? "yearly" : "monthly";
  if (r["billing_cycle"] !== undefined && r["billing_cycle"] !== "monthly" && r["billing_cycle"] !== "yearly")
    throw new BillingInputError("מחזור חיוב: חודשי או שנתי");
  const vatMode = r["vat_mode"] === "included" ? "included" : "excluded";
  if (r["vat_mode"] !== undefined && r["vat_mode"] !== "included" && r["vat_mode"] !== "excluded")
    throw new BillingInputError("מע״מ: כולל או לא כולל");
  const vatRate = parseVatRate(r["vat_rate"]);
  if (vatRate === null) throw new BillingInputError("שיעור מע״מ: 0 עד 100");
  let commitment: number | null = null;
  if (r["commitment_months"] !== null && r["commitment_months"] !== undefined && String(r["commitment_months"]).trim() !== "") {
    commitment = Number(r["commitment_months"]);
    if (!Number.isInteger(commitment) || commitment < 1 || commitment > 120)
      throw new BillingInputError("תקופת התחייבות: 1 עד 120 חודשים");
  }
  return {
    plan,
    billing_cycle: cycle,
    agreed_monthly: parseAmount(r["agreed_monthly"], "מחיר חודשי מוסכם"),
    agreed_yearly: parseAmount(r["agreed_yearly"], "מחיר שנתי מוסכם"),
    setup_fee: parseAmount(r["setup_fee"], "דמי הקמה") ?? 0,
    commitment_months: commitment,
    start_date: parseIsoDate(r["start_date"], "תאריך התחלה"),
    vat_mode: vatMode,
    vat_rate: vatRate,
    terms: text(r["terms"], 2000),
    internal_note: text(r["internal_note"], 2000),
  };
}

const ENTRY_KINDS = ["charge", "payment", "credit"] as const;
const CATEGORIES = ["subscription", "setup", "other"] as const;
const METHODS = Object.keys(METHOD_LABELS) as PaymentMethod[];

export function parseMethod(value: unknown): PaymentMethod | null {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (!METHODS.includes(v as PaymentMethod)) throw new BillingInputError("אמצעי תשלום לא מוכר");
  return v as PaymentMethod;
}

export function parseEntryInput(raw: Record<string, unknown> | null | undefined): EntryInput {
  const r = raw ?? {};
  const kind = r["kind"];
  if (!ENTRY_KINDS.includes(kind as (typeof ENTRY_KINDS)[number]))
    throw new BillingInputError("סוג רישום: חיוב, תשלום או זיכוי");
  const category = r["category"] ?? "subscription";
  if (!CATEGORIES.includes(category as EntryCategory))
    throw new BillingInputError("קטגוריה: מנוי, הקמה או אחר");
  const method = parseMethod(r["method"]);
  if (kind === "payment" && !method) throw new BillingInputError("בחרו אמצעי תשלום");
  const amount = parseAmount(r["amount"], "סכום", { positive: true });
  if (amount === null) throw new BillingInputError("סכום: חובה");
  const occurred = parseIsoDate(r["occurred_on"], "תאריך");
  if (!occurred) throw new BillingInputError("תאריך: חובה");
  return {
    kind: kind as EntryInput["kind"],
    category: category as EntryCategory,
    amount,
    method: kind === "payment" ? method : null,
    occurred_on: occurred,
    description: text(r["description"], 200),
    reference: text(r["reference"], 120),
    internal_note: text(r["internal_note"], 500),
    vat_rate: parseVatRate(r["vat_rate"]),
  };
}

export function parseRequestNote(value: unknown): string | null {
  return text(value, 500);
}

export function parsePlanCode(value: unknown): string {
  const plan = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!PLAN_CODE.test(plan)) throw new BillingInputError("בחרו חבילה");
  return plan;
}

export function parseCycle(value: unknown): BillingCycle {
  if (value === undefined || value === null || value === "") return "monthly";
  if (value !== "monthly" && value !== "yearly") throw new BillingInputError("מחזור חיוב: חודשי או שנתי");
  return value;
}

/** תאריך היום בישראל (YYYY-MM-DD) — ברירת המחדל של תאריך תשלום בטופס */
export function israelToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
