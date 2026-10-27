import { createServerFn } from "@tanstack/react-start";
import { couponLabel, type CouponType } from "@/lib/coupons";

/**
 * קופון להזמנה ראשונה (first_order_mode): ההצעה ללקוח בסל ובקופה.
 * הבדיקה והאכיפה במסד (first_order_offer / coupon_customer_problem) — כאן רק זיהוי
 * הקונה (חשבון לפי הטוקן, או האימייל שהוזן) והצגה. לקוח שכבר הזמין לא מקבל הצעה.
 */
export type FirstOrderOffer = {
  code: string;
  mode: "offer" | "auto";
  label: string;
  conditions: string;
  minOrderTotal: number | null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const getFirstOrderOffer = createServerFn({ method: "POST" })
  .inputValidator((input: { email?: string | null }) => {
    const email = String(input?.email ?? "")
      .trim()
      .toLowerCase()
      .slice(0, 254);
    return { email: EMAIL.test(email) ? email : null };
  })
  .handler(async ({ data }): Promise<FirstOrderOffer | null> => {
    const { allowAction, requestIp } = await import("@/lib/rate-limit.server");
    if (!allowAction(`first-order:${await requestIp()}`, 60, 10 * 60 * 1000)) return null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let customerId: string | null = null;
    let email = data.email;
    try {
      const { getRequest } = await import("@tanstack/react-start/server");
      const auth = getRequest()?.headers.get("authorization") ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (token.split(".").length === 3) {
        const { data: user } = await supabaseAdmin.auth.getUser(token);
        customerId = user?.user?.id ?? null;
        // לקוח מחובר: הכתובת של החשבון (לא מה שהדפדפן אומר)
        if (customerId) email = user?.user?.email?.toLowerCase() ?? email;
      }
    } catch {
      customerId = null;
    }
    const { data: row, error } = await supabaseAdmin.rpc("first_order_offer", {
      _customer: customerId,
      _email: email,
      _is_guest: customerId === null,
    });
    if (error || !row || typeof row !== "object") return null;
    const o = row as Record<string, unknown>;
    const type: CouponType =
      o["discount_type"] === "fixed" || o["discount_type"] === "free_shipping"
        ? o["discount_type"]
        : "percent";
    const min = o["min_order_total"] == null ? null : Number(o["min_order_total"]);
    const expires = typeof o["expires_at"] === "string" ? o["expires_at"] : null;
    const conditions = [
      min ? `בהזמנה מעל ₪${min.toFixed(0)}` : "",
      expires
        ? `בתוקף עד ${new Date(expires).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem" })}`
        : "",
      o["exclude_sale_items"] === true ? "לא חל על מוצרים שכבר במבצע" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      code: String(o["code"] ?? ""),
      mode: o["mode"] === "auto" ? "auto" : "offer",
      label: couponLabel(type, Number(o["discount_value"] ?? 0)),
      conditions,
      minOrderTotal: min,
    };
  });
