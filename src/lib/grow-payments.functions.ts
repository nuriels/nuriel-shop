import { createServerFn } from "@tanstack/react-start";

/**
 * חלק 43: תשלום מקוון דרך Grow — הצד של החנות (קופה).
 *
 *  startGrowPayment     — אחרי שההזמנה נשמרה "ממתינה לתשלום": יוצר דף תשלום אצל Grow
 *                         ומחזיר את הכתובת אליה עוברים. הסכום נקבע בשרת מההזמנה.
 *  getGrowPaymentStatus — עמוד החזרה: מצב התשלום (נטען מהמסד; ההתראה מ-Grow היא
 *                         שמסמנת "שולם", לא הדפדפן).
 * מזהה ההזמנה (UUID אקראי) הוא ה"מפתח" לעמוד, כמו בתשלום בביט; לא נחשפים פרטים אישיים.
 */

const TOO_MANY = "יותר מדי ניסיונות מהחיבור הזה. נסו שוב בעוד כמה דקות.";
const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function orderIdOf(value: unknown): string {
  const id = String(value ?? "").trim();
  if (!ORDER_ID.test(id)) throw new Error("ההזמנה לא נמצאה");
  return id.toLowerCase();
}

export type GrowPaymentStatus = {
  orderNumber: string;
  paymentStatus: string;
  paid: boolean;
  amount: number;
  asmachta: string | null;
  storeName: string | null;
};

export const startGrowPayment = createServerFn({ method: "POST" })
  .inputValidator((input: { orderId: string }) => ({ orderId: orderIdOf(input?.orderId) }))
  .handler(async ({ data }): Promise<{ url: string }> => {
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    const ip = await requestIp();
    if (!allowAction(`grow-start:${ip}`, 20, 15 * 60 * 1000)) throw new Error(TOO_MANY);

    const { supabaseAdmin, supabaseAdminUnscoped } =
      await import("@/integrations/supabase/client.server");
    const { currentTenantId, tenantSiteOrigin } =
      await import("@/integrations/supabase/tenant.server");
    const { loadGrowCredentials, createGrowPaymentProcess, sha256Hex } =
      await import("@/lib/grow.server");
    const { portalOrigin } = await import("@/lib/platform-files.server");

    const tenantId = currentTenantId();
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select(
        "id, order_number, status, payment_method, payment_status, total, prices_include_vat, vat_rate, customer_name, customer_phone, customer_email",
      )
      .eq("id", data.orderId)
      .maybeSingle();
    if (!order || order.payment_method !== "grow") throw new Error("ההזמנה לא נמצאה");
    if (order.payment_status === "paid") throw new Error("ההזמנה כבר שולמה");
    if (order.payment_status !== "awaiting" || order.status !== "pending") {
      throw new Error("לא ניתן לשלם על ההזמנה הזו — ייתכן שהזמן לתשלום עבר. בצעו הזמנה חדשה.");
    }

    const creds = await loadGrowCredentials(tenantId);
    if (!creds || !creds.enabled) throw new Error("התשלום המקוון אינו זמין כרגע בחנות");

    const { data: due, error: dueError } = await supabaseAdmin.rpc("order_amount_due", {
      _total: order.total,
      _prices_include_vat: order.prices_include_vat,
      _vat_rate: order.vat_rate,
    });
    const amount = Number(due);
    if (dueError || !Number.isFinite(amount) || amount <= 0) throw new Error("סכום ההזמנה לא תקין");

    const { data: settings } = await supabaseAdmin
      .from("site_settings")
      .select("business_name, site_title")
      .eq("id", true)
      .maybeSingle();
    const storeName = settings?.business_name?.trim() || settings?.site_title?.trim() || "החנות";

    const origin = tenantSiteOrigin();
    const created = await createGrowPaymentProcess({
      creds,
      sum: amount,
      description: `הזמנה ${order.order_number ?? ""} ${storeName}`,
      fullName: order.customer_name ?? "",
      phone: order.customer_phone ?? "",
      email: order.customer_email,
      successUrl: `${origin}/checkout/grow/${order.id}`,
      cancelUrl: `${origin}/checkout/grow/${order.id}?cancelled=1`,
      // כתובת קבועה ותמיד זמינה (שער הפלטפורמה) — לא תלויה בדומיין החנות / ב-SSL שלה
      notifyUrl: `${portalOrigin()}/api/webhooks/grow`,
      orderId: order.id,
    });

    // תהליך ממתין אחד לכל הזמנה: ניסיון חדש מחליף את הקודם
    await supabaseAdminUnscoped
      .from("grow_payment_processes")
      .update({ status: "superseded" })
      .eq("order_id", order.id)
      .eq("status", "pending");
    const { error } = await supabaseAdminUnscoped.from("grow_payment_processes").insert({
      tenant_id: tenantId,
      order_id: order.id,
      process_id: created.processId,
      process_token_hash: sha256Hex(created.processToken),
      amount,
      sandbox: creds.sandbox,
    });
    if (error) {
      console.error("[grow] saving the process failed", error.message);
      throw new Error("פתיחת התשלום נכשלה. נסו שוב.");
    }
    return { url: created.url };
  });

export const getGrowPaymentStatus = createServerFn({ method: "POST" })
  .inputValidator((input: { orderId: string }) => ({ orderId: orderIdOf(input?.orderId) }))
  .handler(async ({ data }): Promise<GrowPaymentStatus | null> => {
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    const ip = await requestIp();
    if (!allowAction(`grow-status:${ip}`, 240, 15 * 60 * 1000)) throw new Error(TOO_MANY);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select(
        "order_number, payment_method, payment_status, total, prices_include_vat, vat_rate, grow_asmachta",
      )
      .eq("id", data.orderId)
      .maybeSingle();
    if (!order || order.payment_method !== "grow") return null;
    const { data: due } = await supabaseAdmin.rpc("order_amount_due", {
      _total: order.total,
      _prices_include_vat: order.prices_include_vat,
      _vat_rate: order.vat_rate,
    });
    const { data: settings } = await supabaseAdmin
      .from("site_settings")
      .select("business_name, site_title")
      .eq("id", true)
      .maybeSingle();
    return {
      orderNumber: order.order_number ?? "",
      paymentStatus: order.payment_status,
      paid: order.payment_status === "paid",
      amount: Number(due ?? 0),
      asmachta: order.grow_asmachta,
      storeName: settings?.business_name?.trim() || settings?.site_title?.trim() || null,
    };
  });

/** האם להציע תשלום מקוון בקופה של החנות (הופעל ע"י מנהל הפלטפורמה + פרטי מסוף קיימים) */
export const getGrowAvailability = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ available: boolean }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { currentTenantId } = await import("@/integrations/supabase/tenant.server");
    const { data } = await supabaseAdmin.rpc("grow_payments_active", {
      _tenant: currentTenantId(),
    });
    return { available: data === true };
  },
);
