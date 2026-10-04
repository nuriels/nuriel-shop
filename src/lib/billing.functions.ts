import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  parseBillingHistory,
  parseSubscriptionState,
  type BillingEntry,
  type PaymentMethod,
  type SubscriptionState,
} from "@/lib/subscription";

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
    };
  });
