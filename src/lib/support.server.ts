/**
 * התראות מייל של מערכת התמיכה (חלק 13) — צד שרת בלבד.
 *
 *  - הודעה מבעל החנות → מייל למנהלי הפלטפורמה (או לכתובות ב-
 *    SUPPORT_NOTIFY_EMAIL, מופרדות בפסיק), עם קישור ישר לפנייה ב-
 *    /platform/support.
 *  - תשובה של הנהלת הפלטפורמה → מייל למנהלי החנות, עם קישור ללשונית
 *    "תמיכה ועזרה" בפאנל הניהול שלהם.
 * המסד מחליט מתי לשלוח (support_post_message → notify): בתחילת כל סבב או
 * אם עברו 10 דקות — כדי לא להציף בכל הודעה בצ'אט. כישלון בשליחה לא מפיל
 * את ההודעה עצמה (היא כבר נשמרה) — רק נרשם בלוג.
 */

import { supabaseAdminUnscoped } from "@/integrations/supabase/client.server";
import { originForTenant } from "@/integrations/supabase/tenant.server";
import { emailActionButton, escapeHtml, isValidEmail, sendEmail } from "@/lib/email.server";
import { isVip } from "@/lib/support";
import { asPlan, PLAN_LABELS } from "@/lib/subscription";

type Targets = {
  ticket_id: string;
  subject: string;
  tenant_id: string;
  store_name: string;
  store_slug: string;
  store_domain: string | null;
  store_is_default: boolean;
  store_custom_domain: string | null;
  store_custom_domain_status: string | null;
  plan: string;
  platform_emails: string[];
  tenant_emails: string[];
};

async function loadTargets(ticketId: string): Promise<Targets | null> {
  const { data, error } = await supabaseAdminUnscoped.rpc("support_notify_targets", {
    _ticket: ticketId,
  });
  if (error || !data) {
    console.error("[support] notify targets failed", error?.message);
    return null;
  }
  return data as unknown as Targets;
}

/** כתובת פאנל הפלטפורמה (PLATFORM_ADMIN_HOST) */
function platformSupportUrl(ticketId: string): string | null {
  const host = process.env["PLATFORM_ADMIN_HOST"]?.trim().toLowerCase();
  return host ? `https://${host}/platform/support?ticket=${encodeURIComponent(ticketId)}` : null;
}

function platformRecipients(targets: Targets): string[] {
  const override = (process.env["SUPPORT_NOTIFY_EMAIL"] ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => isValidEmail(value));
  return override.length > 0 ? override : targets.platform_emails.filter((e) => isValidEmail(e));
}

/** מייל פשוט ומעוצב (RTL) — בלי מיתוג של חנות מסוימת */
function supportEmailHtml(input: {
  heading: string;
  intro: string;
  quote: string;
  meta: string[];
  button: { label: string; url: string | null };
  footer: string;
}): string {
  const quote = escapeHtml(
    input.quote.length > 1200 ? `${input.quote.slice(0, 1200)}…` : input.quote,
  ).replace(/\n/g, "<br />");
  return `<!doctype html>
<html lang="he" dir="rtl">
  <body style="margin:0;padding:24px;background:#f3f5f3;font-family:Heebo,Arial,sans-serif;color:#12211F;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;padding:28px;border:1px solid #e2e8e2;">
      <h1 style="font-size:20px;margin:0 0 12px;">${escapeHtml(input.heading)}</h1>
      <p style="margin:0 0 14px;line-height:1.6;">${escapeHtml(input.intro)}</p>
      <div style="background:#f7f8f7;border-right:4px solid #b08a3e;border-radius:8px;padding:14px 16px;line-height:1.7;white-space:normal;">${quote}</div>
      <p style="margin:14px 0 0;color:#6b7280;font-size:13px;line-height:1.7;">${input.meta.map(escapeHtml).join("<br />")}</p>
      ${input.button.url ? emailActionButton(input.button.label, input.button.url) : ""}
      <p style="margin:18px 0 0;color:#9ca3af;font-size:12px;">${escapeHtml(input.footer)}</p>
    </div>
  </body>
</html>`;
}

/** הודעה (או פנייה חדשה) מבעל החנות → מנהלי הפלטפורמה */
export async function notifyPlatformOfTenantMessage(input: {
  ticketId: string;
  message: string;
  isNewTicket: boolean;
}): Promise<void> {
  try {
    const targets = await loadTargets(input.ticketId);
    if (!targets) return;
    const to = platformRecipients(targets);
    if (to.length === 0) {
      console.warn("[support] no platform admin email to notify");
      return;
    }
    const plan = asPlan(targets.plan);
    const vip = isVip(plan) ? " · VIP" : "";
    const result = await sendEmail({
      to,
      subject: `${input.isNewTicket ? "פנייה חדשה" : "הודעה חדשה"} מ${targets.store_name}${vip}: ${targets.subject}`,
      html: supportEmailHtml({
        heading: input.isNewTicket ? "פנייה חדשה לתמיכה" : "הודעה חדשה בפנייה",
        intro: `${targets.store_name} כתבו בנושא "${targets.subject}":`,
        quote: input.message,
        meta: [
          `חנות: ${targets.store_name} (${targets.store_slug})`,
          `חבילה: ${PLAN_LABELS[plan]}${vip}`,
          "התחייבות למענה: תוך 3 שעות (07:00–22:00)",
        ],
        button: { label: "לפנייה בפאנל הפלטפורמה", url: platformSupportUrl(targets.ticket_id) },
        footer: "התראה אוטומטית ממערכת התמיכה. עונים בצ'אט בפאנל — לא במענה למייל הזה.",
      }),
      platformSender: { name: `תמיכה · ${targets.store_name}` },
    });
    if (!result.sent) console.error("[support] platform notify failed", result.reason);
  } catch (error) {
    console.error("[support] platform notify crashed", error);
  }
}

/** תשובה של הנהלת הפלטפורמה → מנהלי החנות */
export async function notifyTenantOfAdminReply(input: {
  ticketId: string;
  message: string;
}): Promise<void> {
  try {
    const targets = await loadTargets(input.ticketId);
    if (!targets) return;
    const to = targets.tenant_emails.filter((e) => isValidEmail(e));
    if (to.length === 0) return;
    let url: string | null = null;
    try {
      const origin = originForTenant({
        slug: targets.store_slug,
        domain: targets.store_domain,
        is_default: targets.store_is_default,
        custom_domain: targets.store_custom_domain,
        custom_domain_status: targets.store_custom_domain_status,
      });
      url = `${origin}/admin?tab=support&ticket=${encodeURIComponent(targets.ticket_id)}`;
    } catch {
      url = null;
    }
    const result = await sendEmail({
      to,
      subject: `התקבלה תשובה לפנייה שלך: ${targets.subject}`,
      html: supportEmailHtml({
        heading: "קיבלת תשובה מצוות התמיכה",
        intro: `בנושא "${targets.subject}" כתבנו לך:`,
        quote: input.message,
        meta: ['אפשר להמשיך את השיחה בלשונית "תמיכה ועזרה" בפאנל הניהול של החנות.'],
        button: { label: "לצפייה ולמענה", url },
        footer: "זמני פעילות: 07:00 עד 22:00 | התחייבות למענה תוך 3 שעות",
      }),
      platformSender: { name: "צוות התמיכה" },
    });
    if (!result.sent) console.error("[support] tenant notify failed", result.reason);
  } catch (error) {
    console.error("[support] tenant notify crashed", error);
  }
}
