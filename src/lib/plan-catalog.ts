import { supabase } from "@/integrations/supabase/client";
import { PLAN_MARKETING, PLAN_MONTHLY_PRICE, type PlanType } from "@/lib/subscription";

/**
 * חבילות ומחירים לתצוגה (חלק 14) — מה שכתוב בכרטיסי המחירים ב"המנוי שלי":
 * שם, משפט, מחיר חודשי, רשימת פיצ'רים, תווית, והערות התשלום / מע"מ.
 * נערך ע"י מנהל הפלטפורמה ("חבילות ומחירים" בפאנל) ונשמר במסד
 * (platform_plans). ההרשאות עצמן (מה פתוח בכל חבילה) — plan_features במסד
 * ו-PLAN_FEATURES בקוד, ולא משתנות מהעורך.
 */

export type PaidPlan = Exclude<PlanType, "trial">;
export const PAID_PLANS: PaidPlan[] = ["basic", "premium"];

export type PlanCard = {
  plan: PaidPlan;
  title: string;
  tagline: string;
  monthlyPrice: number;
  features: string[];
  /** תווית על הכרטיס ("הכי משתלם"); null = בלי */
  badge: string | null;
};

export type PlanCatalog = {
  plans: Record<PaidPlan, PlanCard>;
  paymentNote: string;
  vatNote: string;
};

/** ברירת המחדל — עד שהקטלוג נטען מהמסד (וגם אם הטעינה נכשלה) */
export const DEFAULT_PLAN_CATALOG: PlanCatalog = {
  plans: {
    basic: {
      plan: "basic",
      title: PLAN_MARKETING.basic.title,
      tagline: PLAN_MARKETING.basic.tagline,
      monthlyPrice: PLAN_MONTHLY_PRICE.basic,
      features: PLAN_MARKETING.basic.features,
      badge: null,
    },
    premium: {
      plan: "premium",
      title: PLAN_MARKETING.premium.title,
      tagline: PLAN_MARKETING.premium.tagline,
      monthlyPrice: PLAN_MONTHLY_PRICE.premium,
      features: PLAN_MARKETING.premium.features,
      badge: "הכי משתלם",
    },
  },
  paymentNote: "התשלום הינו מראש לשנה, או בפריסה ל-12 תשלומים חודשיים שווים.",
  vatNote: "* המחירים אינם כוללים מע״מ (עוסק פטור)",
};

/** מגבלות העורך (כמו בפונקציה platform_save_pricing במסד) */
export const PLAN_LIMITS = {
  title: 60,
  tagline: 160,
  feature: 120,
  features: 20,
  badge: 40,
  note: 200,
  price: 100_000,
} as const;

type PlanRow = {
  plan_type: string;
  title: string;
  tagline: string;
  monthly_price: number | string;
  features: string[] | null;
  badge: string | null;
};

export function catalogFromRows(
  rows: PlanRow[] | null | undefined,
  notes: { payment_note: string; vat_note: string } | null | undefined,
): PlanCatalog {
  const plans = { ...DEFAULT_PLAN_CATALOG.plans };
  for (const row of rows ?? []) {
    if (row.plan_type !== "basic" && row.plan_type !== "premium") continue;
    const price = Number(row.monthly_price);
    plans[row.plan_type] = {
      plan: row.plan_type,
      title: row.title,
      tagline: row.tagline ?? "",
      monthlyPrice: Number.isFinite(price)
        ? price
        : DEFAULT_PLAN_CATALOG.plans[row.plan_type].monthlyPrice,
      features: Array.isArray(row.features) ? row.features : [],
      badge: row.badge?.trim() ? row.badge : null,
    };
  }
  return {
    plans,
    paymentNote: notes ? notes.payment_note : DEFAULT_PLAN_CATALOG.paymentNote,
    vatNote: notes ? notes.vat_note : DEFAULT_PLAN_CATALOG.vatNote,
  };
}

/** טעינה מהמסד (קריאה פתוחה לכולם) */
export async function loadPlanCatalog(): Promise<PlanCatalog> {
  const [{ data: rows, error }, { data: notes }] = await Promise.all([
    supabase
      .from("platform_plans")
      .select("plan_type, title, tagline, monthly_price, features, badge"),
    supabase.from("platform_pricing_settings").select("payment_note, vat_note").maybeSingle(),
  ]);
  if (error) throw error;
  return catalogFromRows(rows, notes);
}

/** בדיקה לפני שמירה בעורך; null = תקין */
export function planCardProblem(card: PlanCard): string | null {
  const name = card.plan === "premium" ? "פרימיום" : "בסיסית";
  if (card.title.trim().length < 1 || card.title.trim().length > PLAN_LIMITS.title) {
    return `חבילה ${name}: שם החבילה — 1 עד ${PLAN_LIMITS.title} תווים`;
  }
  if (card.tagline.length > PLAN_LIMITS.tagline) {
    return `חבילה ${name}: המשפט מתחת לשם — עד ${PLAN_LIMITS.tagline} תווים`;
  }
  if (
    !Number.isFinite(card.monthlyPrice) ||
    card.monthlyPrice < 0 ||
    card.monthlyPrice > PLAN_LIMITS.price
  ) {
    return `חבילה ${name}: מחיר חודשי לא תקין`;
  }
  const features = card.features.map((f) => f.trim()).filter(Boolean);
  if (features.length === 0) return `חבילה ${name}: לפחות פיצ'ר אחד ברשימה`;
  if (features.length > PLAN_LIMITS.features) {
    return `חבילה ${name}: עד ${PLAN_LIMITS.features} פיצ'רים`;
  }
  const long = features.find((f) => f.length > PLAN_LIMITS.feature);
  if (long) return `חבילה ${name}: פיצ'ר ארוך מדי (עד ${PLAN_LIMITS.feature} תווים)`;
  if ((card.badge ?? "").length > PLAN_LIMITS.badge) {
    return `חבילה ${name}: התווית — עד ${PLAN_LIMITS.badge} תווים`;
  }
  return null;
}

/** "התשלום ל-12 חודשים": כמה עולה שנה */
export function yearlyPrice(card: Pick<PlanCard, "monthlyPrice">): number {
  return Math.round(card.monthlyPrice * 12 * 100) / 100;
}
