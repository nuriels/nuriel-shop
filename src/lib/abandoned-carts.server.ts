import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createSupabaseFetch } from "@/integrations/supabase/auth-middleware";
import { maybeCurrentTenant } from "@/integrations/supabase/tenant.server";
import type { SendResult } from "@/lib/email.server";

/**
 * חלק 27: סלים נטושים — מייל התזכורת ("שכחת משהו בעגלה?": המוצרים, הלוגו וכפתור שמשחזר
 * את הסל בקופה) משותף לשליחה הידנית מהניהול ולשליחה האוטומטית; והשליחה האוטומטית עצמה
 * (POST /api/admin/trigger-abandoned-carts): הסלים מעל 4 שעות בלי תזכורת — עד 25 בפעם.
 */
type ReminderItem = {
  name?: string | null;
  variant_label?: string | null;
  image_url?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
};

export async function sendCartReminderEmail(input: {
  cart: {
    email: string;
    customer_name: string | null;
    items: unknown;
    total: number | string;
    restore_token: string;
  };
  message: string;
  couponCode: string | null;
  couponLine: string;
}): Promise<SendResult> {
  const { escapeHtml, emailActionButton, renderEmailHtml, sendEmail, textToEmailHtml } =
    await import("@/lib/email.server");
  const { tenantSiteOrigin } = await import("@/integrations/supabase/tenant.server");
  const restoreUrl = `${tenantSiteOrigin()}/checkout?restore=${input.cart.restore_token}`;

  const items = (Array.isArray(input.cart.items) ? input.cart.items : []) as ReminderItem[];
  const money = (value: number) => `₪${value.toFixed(2)}`;
  const rows = items
    .map((item) => {
      const name = item.variant_label ? `${item.name} — ${item.variant_label}` : (item.name ?? "");
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
  const greeting = input.cart.customer_name
    ? `שלום ${escapeHtml(input.cart.customer_name)},`
    : "שלום,";
  const couponHtml = input.couponCode
    ? `<div style="margin:18px 0;padding:14px 16px;border:2px dashed #16a34a;border-radius:10px;background:#f0fdf4;text-align:center;">
          <p style="margin:0 0 6px;font-weight:bold;color:#166534;">🎁 מתנה בשבילכם: ${escapeHtml(input.couponLine)}</p>
          <p style="margin:0;font-size:22px;font-weight:bold;letter-spacing:2px;color:#14532d;" dir="ltr">${escapeHtml(input.couponCode)}</p>
          <p style="margin:6px 0 0;font-size:12px;color:#166534;">הקופון יופעל לבד בקופה דרך הכפתור למטה</p>
        </div>`
    : "";
  const body = `
      <p>${greeting}</p>
      ${textToEmailHtml(input.message)}
      ${couponHtml}
      <table style="width:100%;border-collapse:collapse;margin-top:12px;">
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:10px;"><strong>סה"כ בסל: ${money(Number(input.cart.total))}</strong></p>
      ${emailActionButton("לחץ כאן כדי להשלים את ההזמנה", restoreUrl)}
    `;

  return sendEmail({
    to: [input.cart.email],
    subject: input.couponCode ? "שכחתם משהו בסל — ומחכה לכם הנחה 🎁" : "שכחת משהו בעגלה? 🛒",
    html: await renderEmailHtml("הסל שלכם מחכה לכם", body),
  });
}

const MIN_AGE_HOURS = 4;
const BATCH_LIMIT = 25;
const SPACING_MS = 600;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function runAbandonedCartReminders(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (token.split(".").length !== 3) return json(401, { error: "נדרשת התחברות" });
  const tenant = maybeCurrentTenant();
  if (!tenant) return json(404, { error: "החנות לא זוהתה" });
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) return json(500, { error: "השרת לא מוגדר" });
  const supabase = createClient<Database>(url, key, {
    global: {
      fetch: createSupabaseFetch(key),
      headers: { Authorization: `Bearer ${token}`, "x-tenant-id": tenant.id },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { allowAction } = await import("@/lib/rate-limit.server");
  if (!allowAction(`cart-batch:${tenant.id}:${token.slice(-16)}`, 6, 60 * 60 * 1000)) {
    return json(429, { error: "הפעלתם את השליחה הרבה בשעה האחרונה — נסו שוב מאוחר יותר" });
  }
  // ההרשאה במסד: רק מנהל החנות, רק הסלים של החנות הזו
  const { data: due, error } = await supabase.rpc("abandoned_carts_due", {
    _min_age_hours: MIN_AGE_HOURS,
    _limit: BATCH_LIMIT,
  });
  if (error) {
    return json(/אין הרשאה|permission denied|JWT/i.test(error.message) ? 403 : 400, {
      error: error.message,
    });
  }
  const ids = (due ?? []) as string[];
  const { DEFAULT_REMINDER_MESSAGE } = await import("@/lib/marketing.functions");
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const [index, id] of ids.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, SPACING_MS));
    const { data: cart } = await supabase
      .from("abandoned_carts")
      .select("id, email, customer_name, items, total, status, restore_token, reminder_count")
      .eq("id", id)
      .maybeSingle();
    if (!cart || cart.status !== "open" || (cart.reminder_count ?? 0) > 0) continue;
    try {
      const result = await sendCartReminderEmail({
        cart,
        message: DEFAULT_REMINDER_MESSAGE,
        couponCode: null,
        couponLine: "",
      });
      if (!result.sent) {
        failed += 1;
        errors.push(`${cart.email}: ${result.reason ?? "השליחה נכשלה"}`);
        continue;
      }
      // "נשלחה תזכורת" — בלי לשנות את זמן הנטישה
      await supabase
        .from("abandoned_carts")
        .update({ reminder_count: 1, last_reminder_at: new Date().toISOString() })
        .eq("id", cart.id)
        .eq("reminder_count", 0);
      sent += 1;
    } catch (sendError) {
      failed += 1;
      errors.push(
        `${cart.email}: ${sendError instanceof Error ? sendError.message : "השליחה נכשלה"}`,
      );
    }
  }
  return json(200, { due: ids.length, sent, failed, errors: errors.slice(0, 5) });
}
