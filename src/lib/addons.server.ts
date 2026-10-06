/**
 * רכישת תוסף (חלק 15) — צד שרת בלבד: מייל למנהלי הפלטפורמה שיש חיוב
 * "ממתין לתשלום" לגבייה, עם קישור לפאנל הפלטפורמה.
 * כישלון בשליחה לא מבטל את הרכישה (היא כבר נשמרה) — רק נרשם בלוג.
 */

import { supabaseAdminUnscoped } from "@/integrations/supabase/client.server";
import { escapeHtml, emailActionButton, isValidEmail, sendEmail } from "@/lib/email.server";
import type { AddonPurchase } from "@/lib/addons";
import { formatDate, formatShekels } from "@/lib/subscription";

export type Targets = {
  tenant_id: string;
  store_name: string;
  store_slug: string;
  owner_email: string | null;
  platform_emails: string[];
};

export function recipients(targets: Targets): string[] {
  const override = (process.env["SUPPORT_NOTIFY_EMAIL"] ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => isValidEmail(value));
  return override.length > 0 ? override : targets.platform_emails.filter((e) => isValidEmail(e));
}

export function platformUrl(): string | null {
  const host = process.env["PLATFORM_ADMIN_HOST"]?.trim().toLowerCase();
  return host ? `https://${host}/platform` : null;
}

export async function notifyPlatformOfAddonPurchase(input: {
  tenantId: string;
  purchase: AddonPurchase;
  buyerEmail: string | null;
}): Promise<void> {
  try {
    const { data, error } = await supabaseAdminUnscoped.rpc("addon_purchase_notify_targets", {
      _tenant: input.tenantId,
    });
    if (error || !data) {
      console.error("[addons] notify targets failed", error?.message);
      return;
    }
    const targets = data as unknown as Targets;
    const to = recipients(targets);
    if (to.length === 0) {
      console.warn("[addons] no platform admin email to notify");
      return;
    }
    const { purchase } = input;
    const rows = [
      `חנות: ${targets.store_name} (${targets.store_slug})`,
      `תוסף: ${purchase.title}`,
      `לגבייה: ${formatShekels(purchase.amount)}`,
      purchase.expiresAt
        ? `בתוקף עד: ${formatDate(purchase.expiresAt)} (סוף תקופת המנוי)`
        : "תשלום חד-פעמי",
      `נרכש ע"י: ${input.buyerEmail ?? targets.owner_email ?? "—"}`,
    ];
    const url = platformUrl();
    const result = await sendEmail({
      to,
      subject: `רכישת תוסף: ${purchase.title} — ${targets.store_name} (${formatShekels(purchase.amount)})`,
      html: `<!doctype html>
<html lang="he" dir="rtl">
  <body style="margin:0;padding:24px;background:#f3f5f3;font-family:Heebo,Arial,sans-serif;color:#12211F;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;padding:28px;border:1px solid #e2e8e2;">
      <h1 style="font-size:20px;margin:0 0 12px;">נרכש תוסף — ממתין לגבייה</h1>
      <p style="margin:0 0 14px;line-height:1.6;">התוסף כבר פעיל בחנות. החיוב נרשם בהיסטוריית המנוי כ"ממתין לתשלום" — אחרי הגבייה סמנו אותו "שולם" בפאנל הפלטפורמה.</p>
      <p style="margin:0;line-height:1.9;">${rows.map(escapeHtml).join("<br />")}</p>
      ${url ? emailActionButton("לפאנל הפלטפורמה", url) : ""}
      <p style="margin:18px 0 0;color:#9ca3af;font-size:12px;">התראה אוטומטית מחנות התוספים.</p>
    </div>
  </body>
</html>`,
      platformSender: { name: `תוספים · ${targets.store_name}` },
    });
    if (!result.sent) console.error("[addons] platform notify failed", result.reason);
  } catch (error) {
    console.error("[addons] platform notify crashed", error);
  }
}
