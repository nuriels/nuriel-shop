/**
 * צד השרת של טופס תנאי השירות: יצירת טוקן, שליחת המייל ללקוח והודעה
 * למנהלים כשהטופס נחתם.
 */

import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendEmail, renderEmailHtml, escapeHtml } from "@/lib/email.server";
import { tenantSiteOrigin } from "@/integrations/supabase/tenant.server";

export function hashAgreementToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function resolveSiteOrigin(): Promise<string> {
  // חשוב: לא נגזר מכותרות הבקשה. כותרת Origin/Host נשלטת ע"י הפונה,
  // ולכן קודם אפשר היה לבקש איפוס סיסמה עם Origin מזויף ולקבל קישור
  // שמצביע לדומיין של התוקף — עם טוקן תקף. הכתובת נבנית מרשומת החנות במסד.
  return tenantSiteOrigin();
}

/**
 * יוצר (או מרענן) טוקן חתימה ושולח את הקישור ללקוח.
 * אם הטופס כבר נחתם — לא נשלח שוב, כדי לא לבקש חתימה כפולה.
 */
export async function sendAgreementEmail(
  userId: string,
): Promise<{ sent: boolean; reason?: string }> {
  const { data: user } = await supabaseAdmin
    .from("user_roles")
    .select("email")
    .eq("user_id", userId)
    .maybeSingle();
  if (!user) return { sent: false, reason: "המשתמש לא נמצא" };

  const { data: existing } = await supabaseAdmin
    .from("service_agreements")
    .select("signed_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing?.signed_at) return { sent: false, reason: "הלקוח כבר חתם על תנאי השירות" };

  const token = randomBytes(32).toString("base64url");
  const { error } = await supabaseAdmin.from("service_agreements").upsert(
    {
      user_id: userId,
      token_hash: hashAgreementToken(token),
      sent_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) return { sent: false, reason: error.message };

  const [{ data: emailSettings }, { data: settings }] = await Promise.all([
    supabaseAdmin.from("email_settings").select("sender_email").eq("id", true).maybeSingle(),
    supabaseAdmin
      .from("site_settings")
      .select("business_name, site_title")
      .eq("id", true)
      .maybeSingle(),
  ]);
  const company = settings?.business_name?.trim() || settings?.site_title || "סוכנות המשקאות";
  const origin = await resolveSiteOrigin();
  const link = `${origin}/agreement?token=${encodeURIComponent(token)}`;

  return sendEmail({
    from: emailSettings?.sender_email?.trim() || "",
    to: [user.email],
    subject: `טופס הצטרפות ותנאי שירות — ${company}`,
    logFor: { userId, kind: "agreement" },
    html: await renderEmailHtml(
      "טופס הצטרפות לחתימה",
      `
        <p>שלום,</p>
        <p>תודה על פתיחת החשבון ב${escapeHtml(company)}. כדי להשלים את ההצטרפות נשאר רק לחתום
        על תנאי השירות — זה לוקח פחות מדקה, ישירות מהדפדפן.</p>
        <p style="margin:20px 0;">
          <a href="${link}" style="background:#12211F;color:#ffffff;padding:12px 22px;border-radius:8px;text-decoration:none;display:inline-block;">
            מעבר לטופס החתימה
          </a>
        </p>
        <p style="color:#6b7280;font-size:13px;">הטופס החתום יישמר בתיק הלקוח שלכם ויהיה זמין גם אצלנו וגם אצלכם.</p>
      `,
    ),
  });
}

/** הודעה למנהלים שהטופס נחתם */
export async function notifyAgreementSigned(userId: string, signerName: string): Promise<void> {
  const [{ data: emailSettings }, { data: profile }, { data: user }] = await Promise.all([
    supabaseAdmin
      .from("email_settings")
      .select("sender_email, notify_admin_user_ids")
      .eq("id", true)
      .maybeSingle(),
    supabaseAdmin
      .from("customer_profiles")
      .select("business_name")
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin.from("user_roles").select("email").eq("user_id", userId).maybeSingle(),
  ]);

  const recipients = new Set<string>();
  if (emailSettings?.notify_admin_user_ids?.length) {
    const { data: admins } = await supabaseAdmin
      .from("user_roles")
      .select("email")
      .in("user_id", emailSettings.notify_admin_user_ids);
    for (const admin of admins ?? []) if (admin.email) recipients.add(admin.email);
  }
  if (recipients.size === 0) return;

  await sendEmail({
    from: emailSettings?.sender_email?.trim() || "",
    to: [...recipients],
    subject: "תנאי שירות נחתמו",
    html: await renderEmailHtml(
      "לקוח חתם על תנאי השירות",
      `
        <p><strong>עסק:</strong> ${escapeHtml(profile?.business_name ?? "")}</p>
        <p><strong>אימייל:</strong> ${escapeHtml(user?.email ?? "")}</p>
        <p><strong>שם החותם:</strong> ${escapeHtml(signerName)}</p>
        <p>הטופס החתום נשמר בתיק הלקוח בפאנל הניהול.</p>
      `,
    ),
  });
}
