import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  couponLabel,
  normalizeCouponCode,
  type AppliedCoupon,
  type CouponType,
} from "@/lib/coupons";

/**
 * שיווק (חלק 14) — פונקציות השרת:
 *  1. checkCoupon — בדיקת קוד קופון מהקופה (הגבלת קצב לפי IP: אי אפשר לנחש קודים)
 *  2. saveAbandonedCart — שמירת העגלה מהקופה ברגע שיש אימייל
 *  3. restoreAbandonedCart — קישור "להשלמת ההזמנה" מהמייל: מה היה בעגלה
 *  4. sendCartReminder — המנהל שולח תזכורת (Resend), עם קופון לבחירה
 * ההנחה עצמה נקבעת במסד בזמן שליחת ההזמנה — כאן רק תצוגה ובדיקה מוקדמת.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function uuidOf(value: unknown, message: string): string {
  const id = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!UUID.test(id)) throw new Error(message);
  return id;
}

// ============================================================
// 1. קופון בקופה
// ============================================================

export const checkCoupon = createServerFn({ method: "POST" })
  .inputValidator((input: { code: string; subtotal: number }) => {
    const code = normalizeCouponCode(input?.code);
    if (code.length < 3 || code.length > 32) throw new Error("קוד הקופון לא תקין");
    const subtotal = Number(input?.subtotal);
    return { code, subtotal: Number.isFinite(subtotal) && subtotal >= 0 ? subtotal : null };
  })
  .handler(async ({ data }): Promise<AppliedCoupon & { label: string }> => {
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    const ip = await requestIp();
    if (!allowAction(`coupon:${ip}`, 20, 10 * 60 * 1000)) {
      throw new Error("יותר מדי ניסיונות — נסו שוב בעוד כמה דקות");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: coupon, error } = await supabaseAdmin.rpc("check_coupon", {
      _code: data.code,
      _subtotal: data.subtotal,
    });
    if (error) throw new Error(error.message);
    const row = (coupon ?? {}) as Record<string, unknown>;
    const discountType: CouponType = row["discount_type"] === "fixed" ? "fixed" : "percent";
    const discountValue = Number(row["discount_value"] ?? 0);
    return {
      code: String(row["code"] ?? data.code),
      discountType,
      discountValue,
      minOrderTotal: row["min_order_total"] == null ? null : Number(row["min_order_total"]),
      description: typeof row["description"] === "string" ? row["description"] : null,
      label: couponLabel(discountType, discountValue),
    };
  });

// ============================================================
// 2-3. עגלות נטושות — מהקופה
// ============================================================

export type AbandonedCartLine = {
  product_id: string;
  variant_id?: string | null;
  quantity: number;
};

export const saveAbandonedCart = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      session: string;
      email: string;
      name?: string;
      phone?: string;
      items: AbandonedCartLine[];
    }) => {
      const session = uuidOf(input?.session, "עגלה לא תקינה");
      const email = String(input?.email ?? "")
        .trim()
        .toLowerCase();
      if (email.length > 254 || !EMAIL.test(email)) throw new Error("אימייל לא תקין");
      if (!Array.isArray(input?.items) || input.items.length > 100)
        throw new Error("עגלה לא תקינה");
      const items = input.items.map((line) => {
        const quantity = Number(line?.quantity);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100_000) {
          throw new Error("כמות לא תקינה");
        }
        return {
          product_id: uuidOf(line?.product_id, "מוצר לא תקין"),
          variant_id: line?.variant_id ? uuidOf(line.variant_id, "אפשרות לא תקינה") : null,
          quantity,
        };
      });
      return {
        session,
        email,
        name: String(input?.name ?? "").slice(0, 120),
        phone: String(input?.phone ?? "").slice(0, 30),
        items,
      };
    },
  )
  .handler(async ({ data }) => {
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    const ip = await requestIp();
    if (!allowAction(`cart-save:${ip}`, 60, 10 * 60 * 1000)) return { saved: false };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: id, error } = await supabaseAdmin.rpc("save_abandoned_cart", {
      _session: data.session,
      _email: data.email,
      _name: data.name,
      _phone: data.phone,
      _items: data.items,
    });
    if (error) {
      console.error("[abandoned-cart] save failed", error.message);
      return { saved: false };
    }
    return { saved: typeof id === "string" };
  });

export type RestoredCart = {
  items: { product_id: string; variant_id: string | null; quantity: number }[];
  email: string;
  name: string;
  phone: string;
  sessionKey: string;
  coupon: string | null;
};

export const restoreAbandonedCart = createServerFn({ method: "POST" })
  .inputValidator((input: { token: string }) => ({
    token: uuidOf(input?.token, "הקישור לא תקין"),
  }))
  .handler(async ({ data }): Promise<RestoredCart> => {
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    const ip = await requestIp();
    if (!allowAction(`cart-restore:${ip}`, 20, 10 * 60 * 1000)) {
      throw new Error("יותר מדי ניסיונות — נסו שוב בעוד כמה דקות");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: restored, error } = await supabaseAdmin.rpc("abandoned_cart_restore", {
      _token: data.token,
    });
    if (error) throw new Error(error.message);
    const row = (restored ?? {}) as Record<string, unknown>;
    const items = Array.isArray(row["items"]) ? (row["items"] as Record<string, unknown>[]) : [];
    return {
      items: items
        .map((item) => ({
          product_id: String(item["product_id"] ?? ""),
          variant_id: typeof item["variant_id"] === "string" ? item["variant_id"] : null,
          quantity: Number(item["quantity"] ?? 0),
        }))
        .filter((item) => UUID.test(item.product_id) && item.quantity > 0),
      email: String(row["email"] ?? ""),
      name: String(row["name"] ?? ""),
      phone: String(row["phone"] ?? ""),
      sessionKey: String(row["session_key"] ?? ""),
      coupon: typeof row["coupon"] === "string" ? row["coupon"] : null,
    };
  });

// ============================================================
// 4. תזכורת לעגלה נטושה — המנהל
// ============================================================

type CartItem = {
  name?: string;
  variant_label?: string | null;
  quantity?: number;
  unit_price?: number;
  image_url?: string | null;
};

export const DEFAULT_REMINDER_MESSAGE =
  "שמנו לב שהשארתם כמה מוצרים בסל — הם עדיין מחכים לכם! אפשר להשלים את ההזמנה בלחיצה אחת, והסל ימולא לבד.";

export const sendCartReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { cartId: string; message: string; couponCode?: string | null }) => {
    const message = String(input?.message ?? "").trim();
    if (message.length < 2 || message.length > 1500)
      throw new Error("נוסח ההודעה: 2 עד 1,500 תווים");
    const coupon = input?.couponCode ? normalizeCouponCode(input.couponCode) : null;
    return { cartId: uuidOf(input?.cartId, "עגלה לא תקינה"), message, couponCode: coupon || null };
  })
  .handler(async ({ data, context }) => {
    const { allowAction } = await import("@/lib/rate-limit.server");
    if (!allowAction(`cart-reminder:${context.userId}`, 40, 60 * 60 * 1000)) {
      throw new Error("נשלחו הרבה תזכורות בשעה האחרונה — נסו שוב מאוחר יותר");
    }

    // ההרשאה: רק מנהל החנות רואה עגלות (RLS)
    const { data: cart, error } = await context.supabase
      .from("abandoned_carts")
      .select("id, email, customer_name, items, total, status, restore_token, reminder_count")
      .eq("id", data.cartId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!cart) throw new Error("העגלה לא נמצאה");
    if (cart.status === "recovered") throw new Error("הלקוח כבר השלים את ההזמנה");

    let couponLine = "";
    if (data.couponCode) {
      const { data: coupon } = await context.supabase
        .from("coupons")
        .select("code, discount_type, discount_value, is_active, expires_at, min_order_total")
        .eq("code", data.couponCode)
        .maybeSingle();
      if (!coupon || !coupon.is_active) throw new Error("הקופון לא נמצא או שאינו פעיל");
      if (coupon.expires_at && Date.parse(coupon.expires_at) <= Date.now()) {
        throw new Error("תוקף הקופון הסתיים — בחרו קופון אחר");
      }
      couponLine = couponLabel(
        coupon.discount_type === "fixed" ? "fixed" : "percent",
        Number(coupon.discount_value),
      );
    }

    const { escapeHtml, emailActionButton, renderEmailHtml, sendEmail, textToEmailHtml } =
      await import("@/lib/email.server");
    const { tenantSiteOrigin } = await import("@/integrations/supabase/tenant.server");
    const restoreUrl = `${tenantSiteOrigin()}/checkout?restore=${cart.restore_token}`;

    const items = (Array.isArray(cart.items) ? cart.items : []) as CartItem[];
    const money = (value: number) => `₪${value.toFixed(2)}`;
    const rows = items
      .map((item) => {
        const name = item.variant_label
          ? `${item.name} — ${item.variant_label}`
          : (item.name ?? "");
        const image =
          item.image_url && /^https?:\/\//i.test(item.image_url)
            ? `<img src="${escapeHtml(item.image_url)}" alt="" width="48" height="48" style="width:48px;height:48px;object-fit:contain;border-radius:6px;background:#f3f5f3;" />`
            : "";
        return `<tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;width:56px;">${image}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(name)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;white-space:nowrap;">× ${Number(item.quantity ?? 1)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;white-space:nowrap;">${money(Number(item.unit_price ?? 0) * Number(item.quantity ?? 1))}</td>
        </tr>`;
      })
      .join("");
    const greeting = cart.customer_name ? `שלום ${escapeHtml(cart.customer_name)},` : "שלום,";
    const couponHtml = data.couponCode
      ? `<div style="margin:18px 0;padding:14px 16px;border:2px dashed #16a34a;border-radius:10px;background:#f0fdf4;text-align:center;">
          <p style="margin:0 0 6px;font-weight:bold;color:#166534;">🎁 מתנה בשבילכם: ${escapeHtml(couponLine)}</p>
          <p style="margin:0;font-size:22px;font-weight:bold;letter-spacing:2px;color:#14532d;" dir="ltr">${escapeHtml(data.couponCode)}</p>
          <p style="margin:6px 0 0;font-size:12px;color:#166534;">הקופון יופעל לבד בקופה דרך הכפתור למטה</p>
        </div>`
      : "";
    const body = `
      <p>${greeting}</p>
      ${textToEmailHtml(data.message)}
      ${couponHtml}
      <table style="width:100%;border-collapse:collapse;margin-top:12px;">
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:10px;"><strong>סה"כ בסל: ${money(Number(cart.total))}</strong></p>
      ${emailActionButton("להשלמת ההזמנה", restoreUrl)}
    `;

    const result = await sendEmail({
      to: [cart.email],
      subject: data.couponCode ? "שכחתם משהו בסל — ומחכה לכם הנחה 🎁" : "שכחתם משהו בסל? 🛒",
      html: await renderEmailHtml("הסל שלכם מחכה לכם", body),
    });
    if (!result.sent) throw new Error(result.reason ?? "שליחת המייל נכשלה");

    const { error: updateError } = await context.supabase
      .from("abandoned_carts")
      .update({
        reminder_count: (cart.reminder_count ?? 0) + 1,
        last_reminder_at: new Date().toISOString(),
        last_reminder_coupon: data.couponCode,
        updated_at: new Date().toISOString(),
      })
      .eq("id", cart.id);
    if (updateError) console.error("[abandoned-cart] reminder log failed", updateError.message);
    return { sent: true, to: cart.email };
  });
