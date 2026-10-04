/**
 * מנויים (חלק 13) — חבילות, מחירים, פיצ'רים ומצב המנוי. עזרים טהורים,
 * משותפים לדפדפן ולשרת. האכיפה עצמה גם במסד (plan_features, טריגרים) —
 * הטבלה כאן חייבת להתאים לפונקציה plan_features במיגרציה.
 */

export type PlanType = "trial" | "basic" | "premium";
export type SubscriptionStatus = "trialing" | "active" | "canceled";

export const PLAN_TYPES: PlanType[] = ["trial", "basic", "premium"];

export const PLAN_LABELS: Record<PlanType, string> = {
  trial: "ניסיון",
  basic: "בסיסי",
  premium: "פרימיום",
};

export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: "בתקופת ניסיון",
  active: "פעיל",
  canceled: "בוטל",
};

/** ימי הניסיון של חנות חדשה (זהה למסד: tenants_seed_settings) */
export const TRIAL_DAYS = 14;

/** מחיר חודשי (₪, לפני מע"מ — עוסק פטור); התשלום מראש לשנה או ב-12 תשלומים */
export const PLAN_MONTHLY_PRICE: Record<Exclude<PlanType, "trial">, number> = {
  basic: 450,
  premium: 700,
};

export type PlanFeatures = {
  /** null = ללא הגבלה */
  maxProducts: number | null;
  customDomain: boolean;
  variants: boolean;
  digital: boolean;
  googleLogin: boolean;
  vipSupport: boolean;
};

const ALL_FEATURES: PlanFeatures = {
  maxProducts: null,
  customDomain: true,
  variants: true,
  digital: true,
  googleLogin: true,
  vipSupport: true,
};

/** הפיצ'רים של כל חבילה — זהה ל-plan_features במסד */
export const PLAN_FEATURES: Record<PlanType, PlanFeatures> = {
  trial: ALL_FEATURES,
  premium: ALL_FEATURES,
  basic: {
    maxProducts: 1000,
    customDomain: false,
    variants: false,
    digital: false,
    googleLogin: false,
    vipSupport: false,
  },
};

export type FeatureKey = Exclude<keyof PlanFeatures, "maxProducts">;

/** ההודעה ליד פיצ'ר נעול */
export const PREMIUM_ONLY_MESSAGE = "זמין בחבילת פרימיום";

/** מה כתוב בכרטיסי המחירים בעמוד "המנוי שלי" */
export const PLAN_MARKETING: Record<
  Exclude<PlanType, "trial">,
  { title: string; tagline: string; features: string[] }
> = {
  basic: {
    title: "חבילה בסיסית",
    tagline: "כל מה שצריך כדי למכור באונליין — מהיום הראשון",
    features: [
      "עד 1,000 מוצרים",
      "סאב-דומיין יוקרתי",
      "קופה חכמה ללא נטישות",
      "מערכת הזדהות בקוד למייל",
      "דשבורד סטטיסטיקות",
      "מצב שבת אוטומטי",
      "ניהול הזמנות ושליחים",
      "הדפסת מדבקות משלוח",
      "מנוע מבצעים",
    ],
  },
  premium: {
    title: "חבילת פרימיום",
    tagline: "לחנויות שגדלות — בלי מגבלות ועם כל הכלים",
    features: [
      "מוצרים ללא הגבלה!",
      "חיבור דומיין אישי משלך",
      "מכירת מוצרים דיגיטליים",
      "ניהול וריאציות (צבעים / מידות)",
      "התחברות לקוחות דרך Google",
      "צ'אט תמיכה VIP",
      "כולל כל פיצ'רי הבסיס",
    ],
  },
};

export type PaymentMethod = "annual" | "installments" | "monthly" | "other";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  annual: "מראש לשנה",
  installments: "12 תשלומים חודשיים",
  monthly: "חודשי",
  other: "אחר",
};

// ------------------------------------------------------------
// מצב המנוי
// ------------------------------------------------------------

/** השורה מהמסד (tenant_subscriptions) */
export type SubscriptionRow = {
  plan_type: string | null;
  status: string | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
};

export type SubscriptionState = {
  plan: PlanType;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  /** הסוף של התקופה הנוכחית (ניסיון / תשלום); null = ללא תפוגה */
  endsAt: string | null;
  active: boolean;
  /** ימים שנותרו (מעוגל למעלה); null = ללא תפוגה */
  daysLeft: number | null;
  features: PlanFeatures;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function asPlan(value: unknown): PlanType {
  return value === "basic" || value === "premium" ? value : "trial";
}

function asStatus(value: unknown): SubscriptionStatus {
  return value === "active" || value === "canceled" ? value : "trialing";
}

/**
 * אותו חישוב כמו tenant_subscription_state במסד: פעיל = לא בוטל ותאריך
 * הסיום לא עבר; חבילה בתשלום בלי תאריך סיום = ללא תפוגה; החנות הראשית
 * (isDefault) תמיד פעילה; אין שורת מנוי = פעיל (ניסיון).
 */
export function subscriptionStateFrom(
  row: SubscriptionRow | null,
  isDefault: boolean,
  now: number = Date.now(),
): SubscriptionState {
  const plan = asPlan(row?.plan_type);
  const status = asStatus(row?.status);
  const trialEndsAt = row?.trial_ends_at ?? null;
  const currentPeriodEnd = row?.current_period_end ?? null;
  const endsAt = row ? (plan === "trial" ? trialEndsAt : currentPeriodEnd) : null;
  const endMs = endsAt ? Date.parse(endsAt) : NaN;
  const notExpired = endsAt === null || (Number.isFinite(endMs) && endMs > now);
  const active = isDefault || row === null || (status !== "canceled" && notExpired);
  return {
    plan,
    status,
    trialEndsAt,
    currentPeriodEnd,
    endsAt,
    active,
    daysLeft:
      endsAt === null || !Number.isFinite(endMs)
        ? null
        : Math.max(0, Math.ceil((endMs - now) / DAY_MS)),
    features: PLAN_FEATURES[plan],
  };
}

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

/** tenant_subscription_state (jsonb מהמסד) → SubscriptionState */
export function parseSubscriptionState(raw: unknown): SubscriptionState {
  const root = obj(raw);
  const plan = asPlan(root["plan"]);
  return {
    plan,
    status: asStatus(root["status"]),
    trialEndsAt: strOrNull(root["trial_ends_at"]),
    currentPeriodEnd: strOrNull(root["current_period_end"]),
    endsAt: strOrNull(root["ends_at"]),
    active: root["active"] !== false,
    daysLeft: numOrNull(root["days_left"]),
    features: PLAN_FEATURES[plan],
  };
}

export type BillingEntry = {
  id: string;
  kind: "payment" | "trial_extension" | "plan_change";
  plan: PlanType;
  amount: number;
  months: number | null;
  days: number | null;
  method: PaymentMethod | null;
  periodStart: string | null;
  periodEnd: string | null;
  reference: string | null;
  note: string | null;
  createdAt: string;
  recordedBy: string | null;
};

export function parseBillingHistory(raw: unknown): BillingEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const row = obj(entry);
    const kind = row["kind"];
    const method = row["payment_method"];
    return {
      id: String(row["id"] ?? ""),
      kind: kind === "trial_extension" || kind === "plan_change" ? kind : "payment",
      plan: asPlan(row["plan_type"]),
      amount: numOrNull(row["amount"]) ?? 0,
      months: numOrNull(row["months"]),
      days: numOrNull(row["days"]),
      method:
        method === "annual" ||
        method === "installments" ||
        method === "monthly" ||
        method === "other"
          ? method
          : null,
      periodStart: strOrNull(row["period_start"]),
      periodEnd: strOrNull(row["period_end"]),
      reference: strOrNull(row["reference"]),
      note: strOrNull(row["note"]),
      createdAt: String(row["created_at"] ?? ""),
      recordedBy: strOrNull(row["recorded_by_email"]),
    };
  });
}

export const BILLING_KIND_LABELS: Record<BillingEntry["kind"], string> = {
  payment: "תשלום",
  trial_extension: "הארכה",
  plan_change: "שינוי חבילה",
};

// ------------------------------------------------------------
// תצוגה
// ------------------------------------------------------------

export function formatShekels(value: number): string {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

export function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jerusalem",
  });
}

/** "נותרו 5 ימים" / "מסתיים היום" / "הסתיים" / "ללא תפוגה" */
export function remainingLabel(state: Pick<SubscriptionState, "daysLeft" | "active">): string {
  if (!state.active) return "הסתיים";
  if (state.daysLeft === null) return "ללא תפוגה";
  if (state.daysLeft <= 0) return "מסתיים היום";
  if (state.daysLeft === 1) return "נותר יום אחד";
  return `נותרו ${state.daysLeft} ימים`;
}

/** תג המנוי (ניסיון / בסיסי / פרימיום + פג) — לפאנל הפלטפורמה ולניהול החנות */
export function planBadge(state: Pick<SubscriptionState, "plan" | "active">): {
  label: string;
  tone: "trial" | "basic" | "premium" | "expired";
} {
  if (!state.active) return { label: `${PLAN_LABELS[state.plan]} · פג תוקף`, tone: "expired" };
  return { label: PLAN_LABELS[state.plan], tone: state.plan };
}

/** כמה כדאי להתריע: פחות מ-4 ימים לסיום */
export function endingSoon(state: Pick<SubscriptionState, "daysLeft" | "active">): boolean {
  return state.active && state.daysLeft !== null && state.daysLeft <= 3;
}
