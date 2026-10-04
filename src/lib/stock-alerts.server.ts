/**
 * התראת מלאי נמוך (חלק 14) — צד שרת בלבד.
 *
 * אחרי כל הזמנה (sendOrderEmailsInternal): המוצרים / הוריאציות שההזמנה
 * הורידה להם מלאי ונשארו עם 3 יחידות או פחות. כל מוצר מתריע פעם אחת — עד
 * שהמלאי עולה שוב מעל הסף (claim_low_stock_alerts במסד מסמן ומאפס).
 * הנמענים: המנהלים שנבחרו בהגדרות המייל (כמו מיילי ההזמנות), ואם לא נבחר
 * אף אחד — כל מנהלי החנות.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { emailActionButton, escapeHtml, renderEmailHtml, sendEmail } from "@/lib/email.server";

export const LOW_STOCK_THRESHOLD = 3;

type Alert = {
  alert_product_id: string;
  alert_name: string;
  alert_variant: string | null;
  alert_sku: string | null;
  alert_stock: number;
};

async function alertRecipients(): Promise<string[]> {
  const emails = new Set<string>();
  const { data: emailSettings } = await supabaseAdmin
    .from("email_settings")
    .select("notify_admin_user_ids")
    .eq("id", true)
    .maybeSingle();
  const chosen = emailSettings?.notify_admin_user_ids ?? [];
  const query = supabaseAdmin
    .from("user_roles")
    .select("email")
    .eq("role", "admin")
    .eq("is_blocked", false);
  const { data: admins } = chosen.length > 0 ? await query.in("user_id", chosen) : await query;
  for (const admin of admins ?? []) {
    const email = admin.email?.trim().toLowerCase();
    if (email) emails.add(email);
  }
  return [...emails];
}

export async function sendLowStockAlerts(
  orderId: string,
): Promise<{ sent: boolean; count: number }> {
  const { data, error } = await supabaseAdmin.rpc("claim_low_stock_alerts", {
    _order: orderId,
    _threshold: LOW_STOCK_THRESHOLD,
  });
  if (error) throw new Error(error.message);
  const alerts = (data ?? []) as Alert[];
  if (alerts.length === 0) return { sent: false, count: 0 };

  const to = await alertRecipients();
  if (to.length === 0) return { sent: false, count: alerts.length };

  let productsUrl: string | null = null;
  try {
    const { tenantSiteOrigin } = await import("@/integrations/supabase/tenant.server");
    productsUrl = `${tenantSiteOrigin()}/admin?tab=products`;
  } catch {
    productsUrl = null;
  }

  const rows = alerts
    .map((alert) => {
      const name = alert.alert_variant
        ? `${alert.alert_name} — ${alert.alert_variant}`
        : alert.alert_name;
      const stock =
        alert.alert_stock <= 0
          ? `<strong style="color:#b91c1c;">אזל</strong>`
          : `<strong style="color:#b45309;">${alert.alert_stock}</strong>`;
      return `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;">${escapeHtml(name)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;" dir="ltr">${escapeHtml(alert.alert_sku ?? "—")}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">${stock}</td>
      </tr>`;
    })
    .join("");

  const body = `
    <p>אחרי ההזמנה האחרונה, ${alerts.length === 1 ? "מוצר אחד ירד" : `${alerts.length} מוצרים ירדו`} ל-${LOW_STOCK_THRESHOLD} יחידות או פחות במלאי:</p>
    <table style="width:100%;border-collapse:collapse;margin-top:8px;">
      <thead><tr>
        <th style="text-align:right;padding:6px 8px;">מוצר</th>
        <th style="text-align:right;padding:6px 8px;">מק"ט</th>
        <th style="text-align:center;padding:6px 8px;">נשארו</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin-top:12px;">כדאי להזמין מהספק או לעדכן את המלאי — מוצר שאוזל לא זמין להזמנה באתר.</p>
    ${productsUrl ? emailActionButton("לניהול המוצרים", productsUrl) : ""}
    <p style="color:#6b7280;font-size:12px;">התראה אחת לכל מוצר — עד שהמלאי שלו יעלה שוב מעל ${LOW_STOCK_THRESHOLD}.</p>
  `;

  const result = await sendEmail({
    to,
    subject:
      alerts.length === 1
        ? `מלאי נמוך: ${alerts[0]!.alert_name}`
        : `מלאי נמוך: ${alerts.length} מוצרים`,
    html: await renderEmailHtml("התראת מלאי נמוך", body),
  });
  return { sent: result.sent, count: alerts.length };
}
