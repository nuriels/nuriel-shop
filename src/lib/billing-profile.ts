/**
 * פרטי העוסק של בעל החנות (חלק 16 — נשאר אחרי הסרת Hyp בחלק 28): סוג עוסק,
 * שם, ח.פ / ע.מ / ת.ז (ספרת ביקורת) וכתובת. משמשים בחיובי המנוי והתוספים
 * ובזהות המשפטית של החנות. משותף לדפדפן ולשרת.
 */

type Raw = Record<string, unknown>;
const obj = (value: unknown): Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Raw) : {};
const strOrNull = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

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
