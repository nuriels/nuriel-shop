/**
 * חלק 25: בקשת שדרוג (מנהל נוסף) — מייל למנהלי הפלטפורמה, פעם אחת לכל בקשה.
 * אותם נמענים כמו ברכישת תוסף (addon_purchase_notify_targets / SUPPORT_NOTIFY_EMAIL).
 * כישלון בשליחה לא מבטל את הבקשה — רק נרשם בלוג, והסימון מוחזר.
 */
import { supabaseAdminUnscoped } from "@/integrations/supabase/client.server";
import { platformUrl, recipients, type Targets } from "@/lib/addons.server";
import { emailActionButton, escapeHtml, sendEmail } from "@/lib/email.server";
import { EXTRA_ADMIN_YEARLY_PRICE } from "@/lib/admin-seats";

export function upgradeRequestEmailHtml(input: {
  storeName: string;
  storeSlug: string;
  ownerEmail: string | null;
  requestedBy: string | null;
  link: string | null;
}): string {
  const rows = [
    `חנות: ${input.storeName} (${input.storeSlug})`,
    `בקשה: מנהל נוסף — ${EXTRA_ADMIN_YEARLY_PRICE}₪ לשנה`,
    `נשלחה ע"י: ${input.requestedBy ?? input.ownerEmail ?? "—"}`,
  ];
  return `<!doctype html>
<html lang="he" dir="rtl">
<body style="margin:0;padding:24px;background:#f3f5f3;font-family:Heebo,Arial,sans-serif;color:#12211F;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;padding:28px;border:1px solid #e2e8e2;">
    <h1 style="font-size:20px;margin:0 0 12px;">בקשת שדרוג ממתינה לקישור תשלום</h1>
    <p style="margin:0 0 14px;line-height:1.6;">בעל החנות ביקש להוסיף מנהל. הכינו קישור תשלום ב"בקשות שדרוג" ושלחו אותו ללקוח; אחרי התשלום — "אשר שדרוג".</p>
    <p style="margin:0;line-height:1.9;">${rows.map(escapeHtml).join("<br />")}</p>
    ${input.link ? emailActionButton("לבקשות השדרוג", input.link) : ""}
    <p style="margin:18px 0 0;color:#9ca3af;font-size:12px;">התראה אוטומטית ממנגנון השדרוגים.</p>
  </div>
</body>
</html>`;
}

/** true = נשלח עכשיו; false = כבר נשלח / אין נמען / נכשל */
export async function notifyPlatformOfUpgradeRequest(input: {
  requestId: string;
  tenantId: string;
  requestedBy: string | null;
}): Promise<boolean> {
  const { data: claimed, error: claimError } = await supabaseAdminUnscoped.rpc(
    "upgrade_request_claim_notification",
    { _request_id: input.requestId },
  );
  if (claimError) {
    console.error("[upgrades] claim failed", claimError.message);
    return false;
  }
  if (!claimed) return false;
  const release = () =>
    supabaseAdminUnscoped.rpc("upgrade_request_release_notification", {
      _request_id: input.requestId,
    });
  try {
    const { data, error } = await supabaseAdminUnscoped.rpc("addon_purchase_notify_targets", {
      _tenant: input.tenantId,
    });
    if (error || !data) throw new Error(error?.message ?? "no targets");
    const targets = data as unknown as Targets;
    const to = recipients(targets);
    if (to.length === 0) {
      console.warn("[upgrades] no platform admin email to notify");
      await release();
      return false;
    }
    const base = platformUrl();
    const result = await sendEmail({
      to,
      subject: `בקשת שדרוג: מנהל נוסף — ${targets.store_name}`,
      html: upgradeRequestEmailHtml({
        storeName: targets.store_name,
        storeSlug: targets.store_slug,
        ownerEmail: targets.owner_email,
        requestedBy: input.requestedBy,
        link: base ? `${base}/upgrades` : null,
      }),
      platformSender: { name: `שדרוגים · ${targets.store_name}` },
    });
    if (!result.sent) {
      console.error("[upgrades] platform notify failed", result.reason);
      await release();
      return false;
    }
    return true;
  } catch (notifyError) {
    console.error("[upgrades] platform notify failed", notifyError);
    await release();
    return false;
  }
}
