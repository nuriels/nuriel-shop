import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  billingProfileProblem,
  isAddonOrPlanToken,
  parseBillingProfile,
  parsePaymentSettings,
  type BillingProfile,
  type BillingProfileInput,
  type PaymentResult,
  type PaymentSettings,
  type PlanQuote,
  parsePlanQuote,
} from "@/lib/payments";
import { isAddonName } from "@/lib/addons";

/**
 * סליקה (חלק 16) — פונקציות השרת. כל קריאה ל-Hyp יוצאת מהשרת בלבד
 * (src/server/services/hyp.ts); הדפדפן מקבל רק קישור חתום לדף התשלום.
 * ההרשאות והסכומים — במסד: מנהל החנות / מנהל-על / בעל ההזמנה.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** הכתובת שממנה יצאה הבקשה — כדי להחזיר את הלקוח לאותו דומיין אחרי התשלום */
async function currentOrigin(): Promise<string | null> {
  const { getRequest } = await import("@tanstack/react-start/server");
  const request = getRequest();
  if (!request) return null;
  const { requestOrigin } = await import("@/lib/feeds.server");
  const origin = requestOrigin(request).toLowerCase();
  return /^https?:\/\/[a-z0-9.:-]+$/.test(origin) ? origin : null;
}

function terminalOf(value: unknown): string {
  const terminal = String(value ?? "").replace(/\s/g, "");
  if (!/^[0-9]{4,12}$/.test(terminal)) throw new Error("מספר המסוף: ספרות בלבד (4 עד 12)");
  return terminal;
}

function secretOf(value: unknown): string {
  return String(value ?? "")
    .trim()
    .slice(0, 200);
}

// ------------------------------------------------------------
// הגדרות סליקה — חנות
// ------------------------------------------------------------

export const getStorePaymentSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PaymentSettings> => {
    const { data, error } = await context.supabase.rpc("store_payment_settings");
    if (error) throw new Error(error.message);
    return parsePaymentSettings(data);
  });

export type SaveStorePaymentInput = {
  terminal: string;
  password: string;
  apiKey: string;
  enabled: boolean;
  maxPayments: number;
  clear?: boolean;
};

export const saveStorePaymentSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SaveStorePaymentInput) => {
    if (input?.clear === true) return { clear: true as const };
    const maxPayments = Math.floor(Number(input?.maxPayments ?? 1));
    if (!Number.isFinite(maxPayments) || maxPayments < 1 || maxPayments > 36) {
      throw new Error("מספר התשלומים: 1 עד 36");
    }
    return {
      clear: false as const,
      terminal: terminalOf(input?.terminal),
      password: secretOf(input?.password),
      apiKey: secretOf(input?.apiKey),
      enabled: input?.enabled === true,
      maxPayments,
    };
  })
  .handler(async ({ data, context }): Promise<PaymentSettings> => {
    const { data: saved, error } = data.clear
      ? await context.supabase.rpc("store_save_payment_settings", { _terminal: null, _clear: true })
      : await context.supabase.rpc("store_save_payment_settings", {
          _terminal: data.terminal,
          _password: data.password || null,
          _key: data.apiKey || null,
          _enabled: data.enabled,
          _max_payments: data.maxPayments,
        });
    if (error) throw new Error(error.message);
    // מצב "סליקה פעילה" נקרא גם בקופה — מנקים את המטמון של החנות
    const { currentTenantId, invalidateTenantCache } =
      await import("@/integrations/supabase/tenant.server");
    invalidateTenantCache(currentTenantId());
    return parsePaymentSettings(saved);
  });

// ------------------------------------------------------------
// הגדרות סליקה — פלטפורמה (מנהל-על; נבדק במסד)
// ------------------------------------------------------------

export const getPlatformPaymentSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PaymentSettings> => {
    const { data, error } = await context.supabase.rpc("platform_payment_settings");
    if (error) throw new Error(error.message);
    return parsePaymentSettings(data);
  });

export const savePlatformPaymentSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Omit<SaveStorePaymentInput, "enabled">) => {
    if (input?.clear === true) return { clear: true as const };
    const maxPayments = Math.floor(Number(input?.maxPayments ?? 12));
    if (!Number.isFinite(maxPayments) || maxPayments < 1 || maxPayments > 36) {
      throw new Error("מספר התשלומים: 1 עד 36");
    }
    return {
      clear: false as const,
      terminal: terminalOf(input?.terminal),
      password: secretOf(input?.password),
      apiKey: secretOf(input?.apiKey),
      maxPayments,
    };
  })
  .handler(async ({ data, context }): Promise<PaymentSettings> => {
    const { data: saved, error } = data.clear
      ? await context.supabase.rpc("platform_save_payment_settings", {
          _terminal: null,
          _clear: true,
        })
      : await context.supabase.rpc("platform_save_payment_settings", {
          _terminal: data.terminal,
          _password: data.password || null,
          _key: data.apiKey || null,
          _max_payments: data.maxPayments,
        });
    if (error) throw new Error(error.message);
    return parsePaymentSettings(saved);
  });

// ------------------------------------------------------------
// בדיקת סליקה — חיוב של ₪1 בכרטיס של המנהל
// ------------------------------------------------------------

/**
 * "בדיקת סליקה": קישור לתשלום של ₪1 במסוף של החנות (store) או של הפלטפורמה
 * (platform) — כדי לוודא שפרטי המסוף נכונים ושהכסף עובר. ההרשאה (מנהל החנות /
 * מנהל-על) והסכום (₪1 בדיוק) — במסד.
 */
export const startPaymentTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { scope: "store" | "platform" }) => {
    if (input?.scope !== "store" && input?.scope !== "platform") throw new Error("בדיקה לא מוכרת");
    return { scope: input.scope };
  })
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    const { data: start, error } = await context.supabase.rpc("payment_test_start", {
      _scope: data.scope,
      _origin: await currentOrigin(),
    });
    if (error) throw new Error(error.message);
    const { intentPaymentLink } = await import("@/server/services/payments");
    let tenantId: string | null = null;
    if (data.scope === "store") {
      const { currentTenantId } = await import("@/integrations/supabase/tenant.server");
      tenantId = currentTenantId();
    }
    return { url: await intentPaymentLink(data.scope, tenantId, start) };
  });

// ------------------------------------------------------------
// פרטי העוסק של בעל החנות
// ------------------------------------------------------------

export const getBillingProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BillingProfile | null> => {
    const { data, error } = await context.supabase
      .from("tenant_billing_profile")
      .select("business_type, company_name, tax_id, address, billing_email")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? parseBillingProfile(data) : null;
  });

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

// ------------------------------------------------------------
// רכישת תוסף / מנוי — תשלום לחשבון הפלטפורמה
// ------------------------------------------------------------

/** קישור לתשלום מאובטח על תוסף. המחיר נקבע במסד (חיוב יחסי) */
export const startAddonCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { addon: string; expectedAmount: number }) => {
    const addon = String(input?.addon ?? "")
      .trim()
      .toLowerCase();
    if (!isAddonName(addon)) throw new Error("תוסף לא מוכר");
    const expected = Math.round(Number(input?.expectedAmount) * 100) / 100;
    if (!Number.isFinite(expected) || expected <= 0) throw new Error("סכום לא תקין");
    return { addon, expectedAmount: expected };
  })
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    const { data: start, error } = await context.supabase.rpc("addon_checkout_start", {
      _addon: data.addon,
      _expected: data.expectedAmount,
      _origin: await currentOrigin(),
    });
    if (error) throw new Error(error.message);
    const { platformPaymentLink } = await import("@/server/services/payments");
    return { url: await platformPaymentLink(start) };
  });

/** הצעת מחיר למנוי שנתי (כולל התוספים החודשיים הפעילים בחידוש) */
export const getPlanQuote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { plan: string }) => {
    if (input?.plan !== "basic" && input?.plan !== "premium") throw new Error("חבילה לא מוכרת");
    return { plan: input.plan };
  })
  .handler(async ({ data, context }): Promise<PlanQuote> => {
    const { data: quote, error } = await context.supabase.rpc("plan_quote", { _plan: data.plan });
    if (error) throw new Error(error.message);
    return parsePlanQuote(quote);
  });

export const startPlanCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { plan: string; expectedAmount: number }) => {
    if (input?.plan !== "basic" && input?.plan !== "premium") throw new Error("חבילה לא מוכרת");
    const expected = Math.round(Number(input?.expectedAmount) * 100) / 100;
    if (!Number.isFinite(expected) || expected <= 0) throw new Error("סכום לא תקין");
    return { plan: input.plan, expectedAmount: expected };
  })
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    const { data: start, error } = await context.supabase.rpc("plan_checkout_start", {
      _plan: data.plan,
      _expected: data.expectedAmount,
      _origin: await currentOrigin(),
    });
    if (error) throw new Error(error.message);
    const { platformPaymentLink } = await import("@/server/services/payments");
    return { url: await platformPaymentLink(start) };
  });

// ------------------------------------------------------------
// הזמנה בחנות — תשלום לבעל החנות
// ------------------------------------------------------------

export type OrderPaymentResponse = {
  /** לאן להעביר את הלקוח: דף התשלום של Hyp, או דף התוצאה */
  redirectTo: string;
  status: "awaiting" | "paid" | "not_required" | "error";
  message?: string;
};

function resultPath(token: string | null, status?: string): string {
  if (!token) return "/payment/result?status=unknown";
  return `/payment/result?token=${token}${status ? `&status=${status}` : ""}`;
}

/** לקוח מחובר: קישור תשלום להזמנה שלו שממתינה לתשלום */
export const payForOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => {
    const orderId = String(input?.orderId ?? "").trim();
    if (!UUID.test(orderId)) throw new Error("הזמנה לא תקינה");
    return { orderId };
  })
  .handler(async ({ data, context }): Promise<OrderPaymentResponse> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("id, customer_id")
      .eq("id", data.orderId)
      .maybeSingle();
    if (!order || order.customer_id !== context.userId) throw new Error("ההזמנה לא נמצאה");
    const { startOrderPayment } = await import("@/server/services/payments");
    const started = await startOrderPayment(order.id, await currentOrigin());
    return started.status === "awaiting"
      ? { status: "awaiting", redirectTo: started.url }
      : started.status === "error"
        ? {
            status: "error",
            redirectTo: resultPath(started.token, "failed"),
            message: started.message,
          }
        : { status: started.status, redirectTo: "/orders" };
  });

/** "לנסות שוב" מדף התוצאה — לפי הטוקן של הניסיון הקודם (גם לאורחים) */
export const retryOrderPayment = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => {
    const token = String(input?.token ?? "").trim();
    if (!/^[0-9a-f]{32}$/.test(token)) throw new Error("קישור לא תקין");
    return { token };
  })
  .handler(async ({ data }): Promise<OrderPaymentResponse> => {
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    if (!allowAction(`pay-retry:${await requestIp()}`, 10, 15 * 60 * 1000)) {
      throw new Error("יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.");
    }
    const { supabaseAdminUnscoped } = await import("@/integrations/supabase/client.server");
    const { currentTenantId } = await import("@/integrations/supabase/tenant.server");
    const { data: raw } = await supabaseAdminUnscoped.rpc("payment_intent_lookup", {
      _token: data.token,
    });
    const intent = (raw ?? null) as { kind?: string; tenant_id?: string; order_id?: string } | null;
    if (
      !intent ||
      intent.kind !== "order" ||
      intent.tenant_id !== currentTenantId() ||
      !intent.order_id
    ) {
      throw new Error("התשלום לא נמצא");
    }
    const { startOrderPayment } = await import("@/server/services/payments");
    const started = await startOrderPayment(intent.order_id, await currentOrigin());
    return started.status === "awaiting"
      ? { status: "awaiting", redirectTo: started.url }
      : started.status === "error"
        ? {
            status: "error",
            redirectTo: resultPath(started.token, "failed"),
            message: started.message,
          }
        : { status: started.status, redirectTo: resultPath(data.token) };
  });

/** דף התוצאה אחרי Hyp: האם שולם, מספר ההזמנה והסכום — לפי הטוקן */
export const getPaymentResult = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => {
    const token = String(input?.token ?? "").trim();
    if (!isAddonOrPlanToken(token)) throw new Error("קישור לא תקין");
    return { token };
  })
  .handler(async ({ data }): Promise<PaymentResult> => {
    const { supabaseAdminUnscoped } = await import("@/integrations/supabase/client.server");
    const { currentTenantId } = await import("@/integrations/supabase/tenant.server");
    const { data: raw } = await supabaseAdminUnscoped.rpc("payment_intent_lookup", {
      _token: data.token,
    });
    const intent = (raw ?? null) as Record<string, unknown> | null;
    if (!intent || intent["tenant_id"] !== currentTenantId()) {
      return { status: "unknown", orderNumber: null, amount: null, orderPaid: false };
    }
    const status = String(intent["status"]);
    return {
      status: status === "paid" || status === "failed" || status === "expired" ? status : "pending",
      orderNumber: typeof intent["order_number"] === "string" ? intent["order_number"] : null,
      amount: Number(intent["amount"] ?? 0) || null,
      orderPaid: intent["order_payment_status"] === "paid",
    };
  });
