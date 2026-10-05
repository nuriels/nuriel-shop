import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  digitsOnly,
  normalizePhone,
  validateMyDetails,
  type CheckoutPayload,
  type MyDetails,
  type OrderLineInput,
} from "@/lib/checkout";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PAYLOAD_KEYS: (keyof CheckoutPayload)[] = [
  "customer_name",
  "customer_tax_id",
  "customer_phone",
  "customer_email",
  "billing_city",
  "billing_address",
  "billing_zip",
  "ship_to_different",
  "shipping_name",
  "shipping_phone",
  "shipping_city",
  "shipping_address",
  "shipping_zip",
  "note",
  "accepted_terms",
  "shipping_method_id",
  "coupon_code",
  "payment_method",
];
const BOOLEAN_KEYS = new Set<keyof CheckoutPayload>(["ship_to_different", "accepted_terms"]);

/** רק השדות המוכרים, רק מחרוזות/בוליאנים, באורך סביר — הבדיקה המלאה במסד */
function cleanPayload(input: unknown): CheckoutPayload {
  if (!input || typeof input !== "object") throw new Error("חסרים פרטי ההזמנה");
  const source = input as Record<string, unknown>;
  const result: Record<string, string | boolean> = {};
  for (const key of PAYLOAD_KEYS) {
    const value = source[key];
    if (BOOLEAN_KEYS.has(key)) {
      result[key] = value === true;
    } else if (key === "shipping_method_id") {
      // מזהה בלבד — השיטה עצמה (פעילה, של החנות) נבדקת במסד
      result[key] = typeof value === "string" && UUID.test(value) ? value : "";
    } else if (key === "payment_method") {
      // חלק 16ב / 17ב: בקשה בלבד — המסד מחליט לפי מה שזמין בחנות
      result[key] = value === "credit_card" ? "credit_card" : value === "bit" ? "bit" : "offline";
    } else if (key === "coupon_code") {
      // קוד הקופון — רק התווים המותרים; התנאים וההנחה נקבעים במסד
      result[key] =
        typeof value === "string"
          ? value
              .trim()
              .toUpperCase()
              .replace(/[^A-Z0-9_-]/g, "")
              .slice(0, 32)
          : "";
    } else {
      result[key] = typeof value === "string" ? value.slice(0, key === "note" ? 1000 : 254) : "";
    }
  }
  return result as CheckoutPayload;
}

function cleanLines(input: unknown): OrderLineInput[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error("הסל ריק");
  if (input.length > 400) throw new Error("יותר מדי שורות בהזמנה אחת");
  return input.map((raw) => {
    const line = (raw ?? {}) as Record<string, unknown>;
    const productId = String(line["product_id"] ?? "");
    const variantId = line["variant_id"] === undefined ? "" : String(line["variant_id"] ?? "");
    const quantity = Number(line["quantity"]);
    if (!UUID.test(productId)) throw new Error("מוצר לא תקין בסל");
    if (variantId !== "" && !UUID.test(variantId)) throw new Error("אפשרות לא תקינה בסל");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000) {
      throw new Error("כמות לא תקינה בסל");
    }
    return {
      product_id: productId,
      ...(variantId !== "" ? { variant_id: variantId } : {}),
      quantity,
      // המחיר נקבע במסד בלבד — מה שנשלח מהדפדפן לא משנה
      unit_price: 0,
      ...(line["is_deposit"] === true ? { is_deposit: true } : {}),
    };
  });
}

/**
 * הזמנת אורח (בלי חשבון ובלי סיסמה) מהקופה.
 * ההזמנה נוצרת במסד (place_guest_order, service_role בלבד): המחירים לפי
 * המחירון הרגיל, מלאי קשיח, מתנות, נעילה בשבת / בחנות מוקפאת, ובדיקת כל
 * פרטי הקופה. כאן: הגבלת קצב לפי IP, ומיילים (לאורח ולמנהלים).
 */
export const placeGuestOrder = createServerFn({ method: "POST" })
  .inputValidator((input: { kind: "order" | "quote"; items: unknown; details: unknown }) => ({
    kind: input?.kind === "quote" ? ("quote" as const) : ("order" as const),
    items: cleanLines(input?.items),
    details: cleanPayload(input?.details),
  }))
  .handler(async ({ data }) => {
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    const ip = await requestIp();
    if (!allowAction(`guest-order:${ip}`, 8, 15 * 60 * 1000)) {
      throw new Error(
        "נשלחו יותר מדי הזמנות מהכתובת הזו בזמן קצר. נסו שוב בעוד כמה דקות, או צרו איתנו קשר בטלפון.",
      );
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("place_guest_order", {
      _kind: data.kind,
      _items: data.items,
      _details: data.details,
    });
    if (error) throw new Error(error.message);
    const created = rows?.[0];
    if (!created) throw new Error("שליחת ההזמנה נכשלה");

    const { data: giftRows } = await supabaseAdmin
      .from("order_items")
      .select("product_name, quantity")
      .eq("order_id", created.id)
      .eq("is_gift", true);

    // חלק 16: חנות עם סליקה — ההזמנה ממתינה לתשלום, והאורח עובר לדף התשלום
    // של Hyp. המיילים יוצאים רק אחרי אישור התשלום.
    // חלק 17ב: ביט — ההזמנה כבר נשמרה ("ממתינה לתשלום"), והאורח עובר לעמוד
    // התשלום בביט; המיילים יוצאים כשהוא שולח אסמכתא / צילום מסך.
    const { data: paymentRow } = await supabaseAdmin
      .from("orders")
      .select("payment_method, payment_status")
      .eq("id", created.id)
      .maybeSingle();
    const bit = paymentRow?.payment_method === "bit" && paymentRow.payment_status === "awaiting";
    let payment: { redirectTo: string; message?: string } | null = null;
    if (paymentRow?.payment_method === "credit_card" && paymentRow.payment_status === "awaiting") {
      const { startOrderPayment } = await import("@/server/services/payments");
      const { getRequest } = await import("@tanstack/react-start/server");
      const { requestOrigin } = await import("@/lib/feeds.server");
      const request = getRequest();
      const started = await startOrderPayment(created.id, request ? requestOrigin(request) : null);
      if (started.status === "awaiting") payment = { redirectTo: started.url };
      else if (started.status === "error") {
        payment = {
          redirectTo: `/payment/result?token=${started.token}&status=failed`,
          message: started.message,
        };
      }
    }

    // מיילים ברקע — האורח מקבל את מסך האישור מיד, בלי לחכות להפקת ה-PDF
    if (!payment && !bit) {
      const { sendOrderEmailsInternal } = await import("@/lib/order-emails.server");
      void sendOrderEmailsInternal(created.id, null).catch((emailError: unknown) => {
        console.error("[checkout] guest order emails failed", created.order_number, emailError);
      });
    }

    return {
      payment,
      /** חלק 17ב: ההזמנה ממתינה לתשלום בביט → /checkout/bit/<orderId> */
      bit,
      orderId: created.id,
      orderNumber: created.order_number,
      kind: created.kind as "order" | "quote",
      total: Number(created.total),
      gifts: (giftRows ?? []).map((row) =>
        row.quantity > 1 ? `${row.product_name} × ${row.quantity}` : (row.product_name ?? ""),
      ),
    };
  });

/**
 * "הפרטים שלי" — עדכון פרטי הלקוח (גם מתוך הקופה: "לשמור לפעם הבאה").
 * נשמר בפרופיל ומשמש כברירת מחדל בקופה. קבוצת המחיר והסוכן — רק מנהל.
 */
export const updateMyDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: MyDetails) => {
    const details: MyDetails = {
      businessName: String(input?.businessName ?? "").trim(),
      contactName: String(input?.contactName ?? "").trim(),
      taxId: String(input?.taxId ?? "").trim(),
      phone: String(input?.phone ?? "").trim(),
      city: String(input?.city ?? "").trim(),
      address: String(input?.address ?? "").trim(),
      zipCode: String(input?.zipCode ?? "").trim(),
    };
    const errors = validateMyDetails(details);
    const first = Object.values(errors)[0];
    if (first) throw new Error(first);
    return details;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadCaller } = await import("@/lib/caller.server");
    const caller = await loadCaller(context.userId);
    if (caller.role !== "customer") throw new Error("האזור האישי מיועד ללקוחות");

    const values = {
      business_name: data.businessName,
      contact_name: data.contactName || null,
      tax_id: data.taxId ? digitsOnly(data.taxId) : null,
      phone: data.phone ? normalizePhone(data.phone) : null,
      business_address: data.address || null,
      city: data.city || null,
      zip_code: data.zipCode ? digitsOnly(data.zipCode) : null,
      profile_completed: true,
    };

    const { data: existing } = await supabaseAdmin
      .from("customer_profiles")
      .select("user_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    const { error } = existing
      ? await supabaseAdmin.from("customer_profiles").update(values).eq("user_id", context.userId)
      : // לקוח בלי פרופיל (למשל נרשם עם Google): שורה חדשה, בלי קבוצת מחיר —
        // עד שמנהל יקצה (בינתיים המחירון הרגיל, כמו לכולם)
        await supabaseAdmin.from("customer_profiles").insert({
          user_id: context.userId,
          ...values,
          price_tier: null,
          age_confirmed: true,
        });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
