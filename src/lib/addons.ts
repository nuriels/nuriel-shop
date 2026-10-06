/**
 * חנות התוספים (חלק 15) — עזרים טהורים, משותפים לדפדפן ולשרת.
 *
 * המחיר האמיתי מחושב רק במסד (addon_quote_for) — כאן: הטיפוסים, קריאת
 * התשובה מהמסד, נוסחת החיוב היחסי (זהה למסד — לתצוגה ולבדיקות), והטקסטים.
 *
 * חיוב יחסי: תוסף חודשי בחבילה הבסיסית משולם רק על הזמן שנותר עד סוף
 * התקופה של המנוי הראשי (current_period_end):
 *   מחיר חודשי × 12 / 365 × ימים שנותרו (מעוגל למעלה), מעוגל לאגורה.
 * כך התוסף מתחדש יחד עם המנוי — תאריך חידוש אחד לכל החשבון.
 */

import {
  ADDON_NAMES,
  asAddonName,
  asPlan,
  parseSubscriptionState,
  type AddonName,
  type FeatureKey,
  type PlanType,
  type SubscriptionState,
} from "@/lib/subscription";
import { parseBillingProfile, type BillingProfile } from "@/lib/billing-profile";

export type AddonBilling = "monthly" | "one_time";

/** ברירות המחדל של הקטלוג — זהות ל-platform_addons במסד (המסד קובע בפועל) */
export const ADDON_DEFAULTS: Record<
  AddonName,
  { title: string; billing: AddonBilling; price: number; includedInPremium: boolean }
> = {
  google_sso: {
    title: "התחברות מהירה בגוגל (Google SSO)",
    billing: "monthly",
    price: 15,
    includedInPremium: true,
  },
  custom_domain: {
    title: "חיבור דומיין פרטי",
    billing: "monthly",
    price: 20,
    includedInPremium: true,
  },
  digital_products: {
    title: "מכירת מוצרים דיגיטליים",
    billing: "monthly",
    price: 15,
    includedInPremium: true,
  },
  zapier: {
    title: "חיבור לזאפ (Zapier)",
    billing: "one_time",
    price: 250,
    includedInPremium: false,
  },
};

/** התוסף שפותח פיצ'ר נעול (לכפתור "לרכישת תוסף" ליד מנעול) */
export const FEATURE_ADDON: Partial<Record<FeatureKey, AddonName>> = {
  googleLogin: "google_sso",
  customDomain: "custom_domain",
  digital: "digital_products",
  zapFeed: "zapier",
};

/** הטקסט מתחת לכרטיס זאפ */
/** הטקסט בכרטיס זאפ לפני הרכישה (חלק 16 — פתוח לרכישה) */
export const ZAP_ADDON_NOTE =
  "אתר זאפ מאשר חנויות רק לאחר חיבור סליקת אשראי פעילה אצל ספק סליקה. מיד אחרי הרכישה יופיעו כאן הקישור להרשמה לזאפ והקישור לקובץ ה-XML למסירה לתמיכה של זאפ.";

/** כשזאפ סגור לרכישה (platform_addons.available = false) */
export const ZAP_ADDON_NOTE_SOON =
  "אתר זאפ מאשר חנויות רק לאחר חיבור סליקת אשראי פעילה. הפיצ'ר ייפתח לרכישה מיד עם השלמת חיבור הקופה. בינתיים, היכנסו להירשם בזאפ דרך הקישור: https://www.zap.co.il/joinzap.aspx. לאחר שנסדיר את האשראי והפיצ'ר ייפתח, תוכלו להעתיק את קובץ ה-XML לתמיכה של זאפ.";

export const ZAP_COMING_SOON = "בקרוב - ממתין לאישור חברות אשראי";

/** תוסף בחנות התוספים: פרטי הקטלוג + הצעת המחיר לחנות הזו */
export type AddonOffer = {
  addon: AddonName;
  title: string;
  description: string;
  billing: AddonBilling;
  /** מחיר מחירון: לחודש (monthly) או חד-פעמי */
  price: number;
  /** פתוח לרכישה (false = "בקרוב") */
  available: boolean;
  /** כלול בחבילה / בתקופת הניסיון — אין צורך לרכוש */
  included: boolean;
  includedInPremium: boolean;
  /** כבר נרכש ופעיל */
  owned: boolean;
  /** עד מתי התוסף הפעיל בתוקף (null = לתמיד / לא נרכש) */
  expiresAt: string | null;
  canBuy: boolean;
  /** למה אי אפשר לרכוש (או "כלול בחבילה שלך") */
  reason: string | null;
  /** הסכום לתשלום עכשיו (יחסי בתוסף חודשי) */
  amount: number | null;
  daysRemaining: number | null;
  periodEnd: string | null;
  plan: PlanType;
};

export type AddonsStore = {
  subscription: SubscriptionState;
  addons: AddonOffer[];
  /** פרטי העוסק (null = עוד לא מולאו) */
  billingProfile: BillingProfile | null;
};

export type AddonPurchase = {
  id: string;
  addon: AddonName;
  title: string;
  amount: number;
  expiresAt: string | null;
};

type Raw = Record<string, unknown>;
const obj = (value: unknown): Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Raw) : {};
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const strOrNull = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;
const numOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/** addon_quote / שורה מ-addons_store → AddonOffer (null = תוסף לא מוכר) */
export function parseAddonOffer(raw: unknown): AddonOffer | null {
  const row = obj(raw);
  const addon = asAddonName(row["addon"]);
  if (!addon) return null;
  const defaults = ADDON_DEFAULTS[addon];
  const billing =
    row["billing"] === "one_time" || row["billing"] === "monthly"
      ? row["billing"]
      : defaults.billing;
  return {
    addon,
    title: str(row["title"]) || defaults.title,
    description: str(row["description"]),
    billing,
    price: numOrNull(row["price"]) ?? defaults.price,
    available: row["available"] !== false,
    included: row["included"] === true,
    includedInPremium:
      typeof row["included_in_premium"] === "boolean"
        ? row["included_in_premium"]
        : defaults.includedInPremium,
    owned: row["owned"] === true,
    expiresAt: strOrNull(row["expires_at"]),
    canBuy: row["can_buy"] === true,
    reason: strOrNull(row["reason"]),
    amount: numOrNull(row["amount"]),
    daysRemaining: numOrNull(row["days_remaining"]),
    periodEnd: strOrNull(row["period_end"]),
    plan: asPlan(row["plan"]),
  };
}

/** addons_store → AddonsStore (בסדר הקטלוג) */
export function parseAddonsStore(raw: unknown): AddonsStore {
  const root = obj(raw);
  const addons = (Array.isArray(root["addons"]) ? root["addons"] : [])
    .map(parseAddonOffer)
    .filter((offer): offer is AddonOffer => offer !== null);
  return {
    subscription: parseSubscriptionState(root["subscription"]),
    addons,
    billingProfile: root["billing_profile"] ? parseBillingProfile(root["billing_profile"]) : null,
  };
}

export function parseAddonPurchase(raw: unknown): AddonPurchase {
  const row = obj(raw);
  const addon = asAddonName(row["addon"]);
  if (!addon) throw new Error("תשובה לא צפויה מהשרת");
  return {
    id: str(row["id"]),
    addon,
    title: str(row["title"]) || ADDON_DEFAULTS[addon].title,
    amount: numOrNull(row["amount"]) ?? 0,
    expiresAt: strOrNull(row["expires_at"]),
  };
}

export function isAddonName(value: unknown): value is AddonName {
  return asAddonName(value) !== null;
}

export { ADDON_NAMES };

// ------------------------------------------------------------
// חיוב יחסי — זהה ל-addon_quote_for במסד
// ------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

export type Proration = {
  /** ימים שנותרו עד סוף התקופה (מעוגל למעלה, לפחות 1) */
  days: number;
  /** תעריף יומי: מחיר חודשי × 12 / 365 */
  dailyRate: number;
  /** לתשלום עכשיו, מעוגל לאגורה */
  amount: number;
};

/** null = התקופה כבר הסתיימה / תאריך לא תקין */
export function prorateAddon(
  monthlyPrice: number,
  periodEnd: string | Date,
  now: number = Date.now(),
): Proration | null {
  const end = typeof periodEnd === "string" ? Date.parse(periodEnd) : periodEnd.getTime();
  if (!Number.isFinite(end) || end <= now || !Number.isFinite(monthlyPrice) || monthlyPrice < 0) {
    return null;
  }
  const days = Math.max(1, Math.ceil((end - now) / DAY_MS));
  const dailyRate = (monthlyPrice * 12) / 365;
  // עיגול לאגורה כמו round(numeric, 2) במסד (חצי — כלפי מעלה)
  const amount = Math.round(dailyRate * days * 100 + Number.EPSILON) / 100;
  return { days, dailyRate, amount };
}

/** "15 ₪ לחודש" / "250 ₪ חד-פעמי" */
export function addonPriceLabel(offer: Pick<AddonOffer, "billing" | "price">): string {
  const price = offer.price.toLocaleString("he-IL", { maximumFractionDigits: 2 });
  return offer.billing === "monthly" ? `${price} ₪ לחודש` : `${price} ₪ חד-פעמי`;
}

/** מצב הכפתור בכרטיס */
export type AddonButtonState = "included" | "owned" | "buy" | "coming_soon" | "blocked";

export function addonButtonState(offer: AddonOffer): AddonButtonState {
  if (!offer.available) return "coming_soon";
  if (offer.owned) return "owned";
  if (offer.included) return "included";
  if (offer.canBuy) return "buy";
  return "blocked";
}

// ------------------------------------------------------------
// התוספים של חנות (כולל שפגו / בוטלו) — "המנוי שלי" ופאנל הפלטפורמה
// ------------------------------------------------------------

export type PlatformAddonRow = {
  id: string;
  addon: AddonName;
  title: string;
  billing: "monthly" | "one_time";
  price: number;
  status: "active" | "canceled";
  active: boolean;
  expiresAt: string | null;
  amount: number;
  source: "purchase" | "grant";
  purchasedAt: string;
  canceledAt: string | null;
  endedReason: "expired" | "canceled" | null;
};

export function parsePlatformAddons(raw: unknown): PlatformAddonRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: PlatformAddonRow[] = [];
  for (const entry of raw) {
    const row = (entry ?? {}) as Record<string, unknown>;
    const addon = String(row["addon"] ?? "");
    if (!isAddonName(addon)) continue;
    const ended = row["ended_reason"];
    rows.push({
      id: String(row["id"] ?? ""),
      addon,
      title: String(row["title"] ?? addon),
      billing: row["billing"] === "one_time" ? "one_time" : "monthly",
      price: Number(row["price"] ?? 0) || 0,
      status: row["status"] === "canceled" ? "canceled" : "active",
      active: row["active"] === true,
      expiresAt: typeof row["expires_at"] === "string" ? row["expires_at"] : null,
      amount: Number(row["amount"] ?? 0) || 0,
      source: row["source"] === "grant" ? "grant" : "purchase",
      purchasedAt: String(row["purchased_at"] ?? ""),
      canceledAt: typeof row["canceled_at"] === "string" ? row["canceled_at"] : null,
      endedReason: ended === "expired" || ended === "canceled" ? ended : null,
    });
  }
  return rows;
}
