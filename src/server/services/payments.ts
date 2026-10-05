/**
 * תשלומים (חלק 16) — התזמור בצד השרת: כוונת תשלום במסד → קישור חתום ב-Hyp →
 * חזרה מ-Hyp, אימות החתימה, והפעלת התוצאה.
 *
 *  - store:    הזמנה בחנות — במסוף של החנות (הכסף לבעל החנות).
 *  - platform: תוסף / מנוי — במסוף של הפלטפורמה (הכסף לנו).
 *
 * הסכומים נקבעים במסד בלבד (order_payment_intent / addon_checkout_start /
 * plan_checkout_start). הדפדפן לא שולח סכום ולא מסמן "שולם": רק
 * handleHypReturn, אחרי VERIFY מוצלח מול Hyp, קורא ל-payment_intent_complete.
 */

import { supabaseAdmin, supabaseAdminUnscoped } from "@/integrations/supabase/client.server";
import {
  currentTenantId,
  invalidateTenantCache,
  isUnknownStoreHost,
  loadTenantById,
  originForTenant,
  resolveTenant,
  runWithTenant,
  type Tenant,
} from "@/integrations/supabase/tenant.server";
import {
  HypError,
  createPaymentLink,
  hypDeclineMessage,
  parseHypReturn,
  verifyHypReturn,
  type HypCredentials,
} from "@/server/services/hyp";

export type PaymentScope = "platform" | "store";

export async function hypCredentialsFor(
  scope: PaymentScope,
  tenantId: string | null,
): Promise<HypCredentials | null> {
  const { data, error } = await supabaseAdminUnscoped.rpc("hyp_credentials", {
    _scope: scope,
    _tenant: tenantId,
  });
  if (error) {
    console.error("[payments] credentials lookup failed", error.message);
    return null;
  }
  const row = data?.[0];
  if (!row?.terminal || !row.api_password || !row.api_key) return null;
  return { terminal: row.terminal, apiPassword: row.api_password, apiKey: row.api_key };
}

export type ConnectionCheck = {
  ok: boolean;
  /** מה לכתוב למנהל */
  message: string;
  /** CCode ש-Hyp החזיר בסירוב (null = לא הגענו ל-Hyp / לא רלוונטי) */
  code: string | null;
  terminal: string | null;
};

/**
 * "בדיקת חיבור (בלי חיוב)": בקשת חתימה אחת ל-Hyp (APISign / SIGN) עם פרטי
 * המסוף השמורים. אם Hyp חותם — מספר המסוף, סיסמת ה-API ומפתח ה-API נכונים
 * והשרת מצליח לדבר עם Hyp. לא נפתח דף תשלום ולא נוצרת עסקה, ולכן גם אין חיוב.
 */
export async function checkTerminalConnection(
  scope: PaymentScope,
  tenantId: string | null,
): Promise<ConnectionCheck> {
  const creds = await hypCredentialsFor(scope, tenantId);
  if (!creds) {
    return {
      ok: false,
      code: null,
      terminal: null,
      message: "עוד לא נשמרו כל שלושת הפרטים (מספר מסוף, סיסמת API ומפתח API).",
    };
  }
  try {
    await createPaymentLink(creds, {
      // מזהה חד-פעמי שלא שייך לשום תשלום — הקישור לא נשלח לאף אחד
      order: crypto.randomUUID().replace(/-/g, ""),
      amount: 1,
      description: "בדיקת חיבור",
    });
    return {
      ok: true,
      code: null,
      terminal: creds.terminal,
      message: `החיבור תקין — Hyp אישר את מסוף ${creds.terminal}, את סיסמת ה-API ואת מפתח ה-API.`,
    };
  } catch (thrown) {
    return {
      ok: false,
      code: thrown instanceof HypError ? thrown.code : null,
      terminal: creds.terminal,
      message: thrown instanceof HypError ? thrown.message : "הבדיקה נכשלה. נסו שוב בעוד רגע.",
    };
  }
}

type Raw = Record<string, unknown>;
const str = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

// ------------------------------------------------------------
// הזמנה בחנות
// ------------------------------------------------------------

export type OrderPaymentStart =
  | { status: "awaiting"; url: string; token: string; orderNumber: string }
  | { status: "paid" | "not_required"; url: null; token: null; orderNumber: string }
  /** דף התשלום לא נוצר (תקלה מול Hyp) — אפשר לנסות שוב עם הטוקן */
  | { status: "error"; url: null; token: string; orderNumber: string; message: string };

/**
 * קישור תשלום להזמנה שממתינה לתשלום — בחנות של הבקשה הנוכחית.
 * מי שקורא לזה כבר בדק שההזמנה שייכת לפונה (לקוח מחובר / אורח שיצר אותה /
 * בעל הטוקן של ניסיון קודם).
 */
export async function startOrderPayment(
  orderId: string,
  origin: string | null,
): Promise<OrderPaymentStart> {
  const { data, error } = await supabaseAdmin.rpc("order_payment_intent", {
    _order: orderId,
    _origin: origin,
  });
  if (error) throw new Error(error.message);
  const intent = (data ?? {}) as Raw;
  const orderNumber = String(intent["order_number"] ?? "");
  if (intent["status"] !== "awaiting") {
    return {
      status: intent["status"] === "paid" ? "paid" : "not_required",
      url: null,
      token: null,
      orderNumber,
    };
  }
  const token = String(intent["token"]);
  const creds = await hypCredentialsFor("store", currentTenantId());
  if (!creds) {
    await supabaseAdmin.rpc("payment_intent_fail", { _token: token, _error: "אין מסוף" });
    throw new Error("התשלום באשראי לא זמין כרגע בחנות. צרו קשר עם החנות.");
  }
  try {
    const url = await createPaymentLink(creds, {
      order: token,
      amount: Number(intent["amount"]),
      description: String(intent["description"] ?? `הזמנה ${orderNumber}`),
      maxPayments: Number(intent["max_payments"] ?? 1),
      customer: {
        name: str(intent["customer_name"]),
        email: str(intent["customer_email"]),
        phone: str(intent["customer_phone"]),
        taxId: str(intent["customer_tax_id"]),
        street: str(intent["billing_address"]),
        city: str(intent["billing_city"]),
        zip: str(intent["billing_zip"]),
      },
    });
    return { status: "awaiting", url, token, orderNumber };
  } catch (thrown) {
    const message =
      thrown instanceof HypError ? thrown.message : "יצירת דף התשלום נכשלה. נסו שוב בעוד רגע.";
    if (!(thrown instanceof HypError)) console.error("[payments] start failed", thrown);
    await supabaseAdmin.rpc("payment_intent_fail", { _token: token, _error: message });
    return { status: "error", url: null, token, orderNumber, message };
  }
}

// ------------------------------------------------------------
// תוסף / מנוי — במסוף של הפלטפורמה
// ------------------------------------------------------------

/** התשובה של addon_checkout_start / plan_checkout_start → קישור תשלום */
export async function platformPaymentLink(start: unknown): Promise<string> {
  return intentPaymentLink("platform", null, start);
}

/**
 * קישור תשלום לכוונה שכבר נוצרה במסד (תוסף / מנוי / חיוב בדיקה) — במסוף של
 * הפלטפורמה או של החנות (tenantId)
 */
export async function intentPaymentLink(
  scope: PaymentScope,
  tenantId: string | null,
  start: unknown,
): Promise<string> {
  const row = (start ?? {}) as Raw;
  const profile = (row["profile"] ?? {}) as Raw;
  const token = String(row["token"] ?? "");
  const creds = await hypCredentialsFor(scope, tenantId);
  if (!creds) {
    await supabaseAdminUnscoped.rpc("payment_intent_fail", { _token: token, _error: "אין מסוף" });
    throw new Error("התשלום באשראי עדיין לא זמין — נסו שוב מאוחר יותר.");
  }
  try {
    return await createPaymentLink(creds, {
      order: token,
      amount: Number(row["amount"]),
      description: String(row["description"] ?? "תשלום"),
      maxPayments: Number(row["max_payments"] ?? 1),
      customer: {
        name: str(profile["company_name"]),
        email: str(profile["billing_email"]) ?? str(row["email"]),
        taxId: str(profile["tax_id"]),
        street: str(profile["address"]),
      },
    });
  } catch (thrown) {
    await supabaseAdminUnscoped.rpc("payment_intent_fail", {
      _token: token,
      _error: thrown instanceof Error ? thrown.message : "SIGN failed",
    });
    throw thrown instanceof HypError ? new Error(thrown.message) : thrown;
  }
}

// ------------------------------------------------------------
// החזרה מ-Hyp
// ------------------------------------------------------------

type Intent = {
  token: string;
  scope: PaymentScope;
  /** test = חיוב בדיקה של ₪1 ("בדיקת סליקה") */
  kind: "order" | "addon" | "plan" | "test";
  /** null רק בבדיקה של מסוף הפלטפורמה */
  tenant_id: string | null;
  order_id: string | null;
  amount: number;
  status: "pending" | "paid" | "failed" | "expired";
  return_origin: string | null;
};

async function lookupIntent(token: string): Promise<Intent | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const { data, error } = await supabaseAdminUnscoped.rpc("payment_intent_lookup", {
    _token: token,
  });
  if (error || !data) return null;
  return data as unknown as Intent;
}

/** הכתובת של פאנל הפלטפורמה (PLATFORM_ADMIN_HOST) */
function platformOrigin(fallback: string): string {
  const host = process.env["PLATFORM_ADMIN_HOST"]?.trim().toLowerCase();
  return host ? `https://${host}` : fallback;
}

/** לאן להחזיר: הדומיין שממנו יצא התשלום — רק אם הוא באמת של אותה חנות */
async function returnOrigin(
  intent: Intent,
  tenant: Tenant | null,
  fallback: string,
): Promise<string> {
  // בדיקה של מסוף הפלטפורמה — חוזרים רק לדומיין של פאנל הפלטפורמה
  if (!intent.tenant_id) {
    const adminHost = process.env["PLATFORM_ADMIN_HOST"]?.trim().toLowerCase();
    try {
      if (intent.return_origin && new URL(intent.return_origin).hostname === adminHost) {
        return intent.return_origin;
      }
    } catch {
      // כתובת לא תקינה
    }
    return platformOrigin(fallback);
  }
  if (intent.return_origin) {
    try {
      const host = new URL(intent.return_origin).hostname.toLowerCase();
      const owner = await resolveTenant(host);
      if (owner && owner.id === intent.tenant_id && !isUnknownStoreHost(host, owner)) {
        return intent.return_origin;
      }
    } catch {
      // כתובת לא תקינה — נופלים לכתובת החנות מהמסד
    }
  }
  return originForTenant(tenant);
}

function destination(
  origin: string,
  intent: Intent | null,
  outcome: "success" | "failed" | "unverified",
): string {
  if (!intent) return `${origin}/payment/result?status=unknown`;
  if (intent.kind === "order") {
    return `${origin}/payment/result?token=${intent.token}${outcome === "success" ? "" : `&status=${outcome}`}`;
  }
  // חיוב בדיקה — חזרה למסך הגדרות הסליקה, עם התוצאה
  if (intent.kind === "test") {
    return intent.scope === "platform"
      ? `${origin}/platform?payment=${outcome}`
      : `${origin}/admin?tab=payments&payment=${outcome}`;
  }
  const tab = intent.kind === "plan" ? "billing" : "addons";
  return `${origin}/admin?tab=${tab}&payment=${outcome}`;
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: location, "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}

/**
 * הנתיב שאליו Hyp מחזיר את הלקוח (דף הצלחה וגם דף כישלון במסוף).
 * GET או POST. מאמתים מול Hyp ורק אז מסמנים שולם — פעם אחת בלבד.
 */
export async function handleHypReturn(request: Request, fallbackOrigin: string): Promise<Response> {
  const raw =
    request.method === "POST"
      ? await request.text()
      : new URL(request.url).search.replace(/^\?/, "");
  const ret = parseHypReturn(raw);
  const intent = ret?.order ? await lookupIntent(ret.order) : null;
  if (!ret || !intent) {
    console.warn("[payments] return without a known intent");
    return redirect(destination(fallbackOrigin, null, "failed"));
  }
  const tenant = intent.tenant_id ? await loadTenantById(intent.tenant_id) : null;
  const origin = await returnOrigin(intent, tenant, fallbackOrigin);

  // רענון של דף החזרה אחרי שכבר שולם
  if (intent.status === "paid") return redirect(destination(origin, intent, "success"));

  if (ret.code !== "0") {
    await supabaseAdminUnscoped.rpc("payment_intent_fail", {
      _token: intent.token,
      _error: hypDeclineMessage(ret.code),
    });
    return redirect(destination(origin, intent, "failed"));
  }

  const creds = await hypCredentialsFor(intent.scope, intent.tenant_id);
  let verified = false;
  try {
    verified = creds !== null && (await verifyHypReturn(creds, ret));
  } catch (error) {
    console.error("[payments] verify crashed", error);
  }
  if (!verified || !ret.transactionId || ret.amount === null) {
    console.error("[payments] unverified return", intent.token);
    return redirect(destination(origin, intent, "unverified"));
  }

  const { data, error } = await supabaseAdminUnscoped.rpc("payment_intent_complete", {
    _token: intent.token,
    _transaction_id: ret.transactionId,
    _amount: ret.amount,
    _payments: ret.payments,
    _card_last4: ret.cardLast4,
  });
  if (error) {
    console.error("[payments] complete failed", intent.token, error.message);
    return redirect(destination(origin, intent, "unverified"));
  }
  const result = (data ?? {}) as Raw;
  if (result["already"] !== true) await afterPaid(intent, tenant);
  return redirect(destination(origin, intent, "success"));
}

/** אחרי תשלום חדש: מיילי ההזמנה + התראת מלאי, או רענון המנוי / התוספים */
async function afterPaid(intent: Intent, tenant: Tenant | null): Promise<void> {
  if (intent.tenant_id) invalidateTenantCache(intent.tenant_id);
  if (intent.kind !== "order" || !intent.order_id || !tenant) return;
  const host = new URL(originForTenant(tenant)).hostname;
  const orderId = intent.order_id;
  // ברקע — הלקוח מגיע לדף האישור מיד, בלי לחכות להפקת ה-PDF
  void runWithTenant(host, tenant, async () => {
    const { sendOrderEmailsInternal } = await import("@/lib/order-emails.server");
    await sendOrderEmailsInternal(orderId, null);
  }).catch((error: unknown) => console.error("[payments] order emails failed", orderId, error));
}

// ------------------------------------------------------------
// הזמנות שלא שולמו בזמן
// ------------------------------------------------------------

let expiryTimer: ReturnType<typeof setInterval> | null = null;

export async function expireUnpaidOrders(): Promise<number> {
  const { data, error } = await supabaseAdminUnscoped.rpc("expire_unpaid_orders");
  if (error) {
    console.error("[payments] expire failed", error.message);
    return 0;
  }
  const count = Number(data ?? 0);
  if (count > 0) console.log(`[payments] ${count} unpaid order(s) expired`);
  return count;
}

/** פעם ב-5 דקות: ביטול הזמנות שלא שולמו תוך 30 דקות (המלאי חוזר) */
export function startPaymentExpiryJob(): void {
  if (expiryTimer || process.env["NODE_ENV"] === "test") return;
  expiryTimer = setInterval(() => void expireUnpaidOrders(), 5 * 60 * 1000);
  expiryTimer.unref?.();
}
