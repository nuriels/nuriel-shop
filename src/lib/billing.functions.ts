import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  parseBillingHistory,
  parseSubscriptionState,
  type BillingEntry,
  type PaymentMethod,
  type SubscriptionState,
} from "@/lib/subscription";
import { parsePlatformAddons, type PlatformAddonRow } from "@/lib/addons";
import {
  billingProfileProblem,
  parseBillingProfile,
  type BillingProfile,
  type BillingProfileInput,
} from "@/lib/billing-profile";

/**
 * מנויים (חלק 13) — פונקציות השרת.
 *
 * כל פעולה רצה עם החיבור של המשתמש עצמו (requireSupabaseAuth), והבדיקה מי
 * מורשה — במסד: store_billing למנהל החנות, platform_* למנהל-על בלבד.
 * אין כאן סליקה: התשלום נגבה מחוץ למערכת, ומנהל הפלטפורמה מתעד אותו
 * ("תעד תשלום") — החבילה ותאריך הסיום מתעדכנים מיד.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tenantIdOf(value: unknown): string {
  const id = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!UUID.test(id)) throw new Error("חנות לא תקינה");
  return id;
}

export type StoreBilling = {
  subscription: SubscriptionState;
  productCount: number;
  history: BillingEntry[];
  /** התוספים של החנות (חלק 15) — כולל שפגו / בוטלו */
  addons: PlatformAddonRow[];
  billingProfile: BillingProfile | null;
};

/** "המנוי שלי": המנוי, מספר המוצרים (מול מגבלת החבילה) והיסטוריית התשלומים */
export const getStoreBilling = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StoreBilling> => {
    const { data, error } = await context.supabase.rpc("store_billing");
    if (error) throw new Error(error.message);
    const root = (data ?? {}) as Record<string, unknown>;
    return {
      subscription: parseSubscriptionState(root["subscription"]),
      productCount: Number(root["product_count"] ?? 0) || 0,
      history: parseBillingHistory(root["history"]),
      addons: parsePlatformAddons(root["addons"]),
      billingProfile: root["billing_profile"] ? parseBillingProfile(root["billing_profile"]) : null,
    };
  });

/** הארכת ניסיון (או התקופה הנוכחית) ב-N ימים — מנהל-על */
export const platformExtendTrial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId: string; days: number }) => {
    const days = Math.floor(Number(input?.days));
    if (!Number.isFinite(days) || days < 1 || days > 365) throw new Error("מספר הימים: 1 עד 365");
    return { tenantId: tenantIdOf(input?.tenantId), days };
  })
  .handler(async ({ data, context }) => {
    const { data: state, error } = await context.supabase.rpc("platform_extend_trial", {
      _tenant: data.tenantId,
      _days: data.days,
    });
    if (error) throw new Error(error.message);
    return parseSubscriptionState(state);
  });

export type RecordPaymentInput = {
  tenantId: string;
  plan: "basic" | "premium";
  amount: number;
  months: number;
  method: PaymentMethod;
  reference?: string;
  note?: string;
};

const METHODS: PaymentMethod[] = ["annual", "installments", "monthly", "other"];

/** תיעוד תשלום: נשמר בהיסטוריה, מעדכן חבילה ותאריך סיום — מנהל-על */
export const platformRecordPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: RecordPaymentInput) => {
    const plan = input?.plan;
    if (plan !== "basic" && plan !== "premium") throw new Error("בחרו חבילה: בסיסית או פרימיום");
    const amount = Math.round(Number(input?.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) {
      throw new Error("סכום לא תקין");
    }
    const months = Math.floor(Number(input?.months));
    if (!Number.isFinite(months) || months < 1 || months > 36) {
      throw new Error("מספר החודשים: 1 עד 36");
    }
    const method = input?.method;
    if (!METHODS.includes(method)) throw new Error("אמצעי תשלום לא מוכר");
    return {
      tenantId: tenantIdOf(input?.tenantId),
      plan,
      amount,
      months,
      method,
      reference: String(input?.reference ?? "")
        .trim()
        .slice(0, 120),
      note: String(input?.note ?? "")
        .trim()
        .slice(0, 500),
    };
  })
  .handler(async ({ data, context }) => {
    const { data: state, error } = await context.supabase.rpc("platform_record_payment", {
      _tenant: data.tenantId,
      _plan: data.plan,
      _amount: data.amount,
      _months: data.months,
      _method: data.method,
      _reference: data.reference || null,
      _note: data.note || null,
    });
    if (error) throw new Error(error.message);
    return parseSubscriptionState(state);
  });

/** היסטוריית המנוי של חנות — מנהל-על */
export const platformBillingHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { tenantId: string }) => ({ tenantId: tenantIdOf(input?.tenantId) }))
  .handler(async ({ data, context }) => {
    const { data: raw, error } = await context.supabase.rpc("platform_billing_history", {
      _tenant: data.tenantId,
    });
    if (error) throw new Error(error.message);
    const root = (raw ?? {}) as Record<string, unknown>;
    return {
      subscription: parseSubscriptionState(root["subscription"]),
      history: parseBillingHistory(root["history"]),
      addons: parsePlatformAddons(root["addons"]),
    };
  });

export type SavePricingInput = {
  plans: {
    plan: "basic" | "premium";
    title: string;
    tagline: string;
    monthlyPrice: number;
    features: string[];
    badge: string | null;
  }[];
  paymentNote: string;
  vatNote: string;
};

/**
 * עורך החבילות (חלק 14): שם, משפט, מחיר חודשי, פיצ'רים ותווית לכל חבילה,
 * והערות התשלום / מע"מ מתחת לטבלת המחירים — מנהל-על בלבד (נבדק במסד).
 */
export const platformSavePricing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SavePricingInput) => {
    if (!Array.isArray(input?.plans) || input.plans.length === 0 || input.plans.length > 2) {
      throw new Error("נתוני החבילות לא תקינים");
    }
    const plans = input.plans.map((plan) => {
      if (plan?.plan !== "basic" && plan?.plan !== "premium") throw new Error("חבילה לא מוכרת");
      const price = Math.round(Number(plan.monthlyPrice) * 100) / 100;
      if (!Number.isFinite(price) || price < 0 || price > 100_000) {
        throw new Error("מחיר חודשי לא תקין");
      }
      return {
        plan_type: plan.plan,
        title: String(plan.title ?? "")
          .trim()
          .slice(0, 60),
        tagline: String(plan.tagline ?? "")
          .trim()
          .slice(0, 160),
        monthly_price: price.toFixed(2),
        features: (Array.isArray(plan.features) ? plan.features : [])
          .map((feature) => String(feature ?? "").trim())
          .filter(Boolean)
          .slice(0, 20),
        badge: String(plan.badge ?? "")
          .trim()
          .slice(0, 40),
      };
    });
    return {
      plans,
      notes: {
        payment_note: String(input?.paymentNote ?? "")
          .trim()
          .slice(0, 200),
        vat_note: String(input?.vatNote ?? "")
          .trim()
          .slice(0, 200),
      },
    };
  })
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("platform_save_pricing", {
      _plans: data.plans,
      _notes: data.notes,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ------------------------------------------------------------
// פרטי העוסק של בעל החנות (לחיוב המנוי והתוספים — תשלום ידני)
// ------------------------------------------------------------

export const saveBillingProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: BillingProfileInput) => {
    const profile: BillingProfileInput = {
      businessType: input?.businessType,
      companyName: String(input?.companyName ?? "").trim(),
      taxId: String(input?.taxId ?? "").replace(/\D/g, ""),
      address: String(input?.address ?? "").trim(),
      billingEmail: String(input?.billingEmail ?? "")
        .trim()
        .toLowerCase(),
    };
    const problem = billingProfileProblem(profile);
    if (problem || !profile.businessType) throw new Error(problem ?? "בחרו סוג עוסק");
    return { ...profile, businessType: profile.businessType };
  })
  .handler(async ({ data, context }): Promise<BillingProfile> => {
    // חלק 33: פרטי החיוב של המנוי — בעל החנות בלבד (גם המסד אוכף)
    const { requireStaffPermission } = await import("@/lib/caller.server");
    await requireStaffPermission(
      context.userId,
      "billing.manage",
      "רק בעל החנות יכול לעדכן את פרטי החיוב",
    );
    const { currentTenantId } = await import("@/integrations/supabase/tenant.server");
    const { data: saved, error } = await context.supabase
      .from("tenant_billing_profile")
      .upsert(
        {
          tenant_id: currentTenantId(),
          business_type: data.businessType,
          company_name: data.companyName,
          tax_id: data.taxId.padStart(9, "0"),
          address: data.address,
          billing_email: data.billingEmail || null,
        },
        { onConflict: "tenant_id" },
      )
      .select("business_type, company_name, tax_id, address, billing_email")
      .single();
    if (error) {
      if (/tax_id_check/.test(error.message)) throw new Error("מספר ח.פ / ע.מ / ת.ז אינו תקין");
      throw new Error(error.message);
    }
    return parseBillingProfile(saved);
  });
