/**
 * הזמנות לקוחות — צד שרת בלבד.
 *
 * טוקן אקראי נשלח ללקוח בקישור; במסד נשמר רק ה-hash שלו. כל הזמנה
 * לשימוש אחד: ההרשמה "תופסת" את ההזמנה אטומית לפני יצירת החשבון,
 * ומשחררת אותה אם ההרשמה נכשלה באמצע.
 */

import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { emailActionButton, renderEmailHtml, sendEmail } from "@/lib/email.server";
import { hashResetToken } from "@/lib/reset-link.server";
import { tenantSiteOrigin } from "@/integrations/supabase/tenant.server";

/** תוקף הזמנה: 7 ימים */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function siteOrigin(): string {
  // לא נגזר מכותרות הבקשה — ראו resolveSiteOrigin ב-reset-link.server
  return tenantSiteOrigin();
}

export type InviteRow = {
  id: string;
  email: string | null;
  price_tier: number | null;
  agent_id: string | null;
  expires_at: string;
};

export async function createInvite(input: {
  email: string | null;
  priceTier: 1 | 2 | 3 | null;
  agentId: string | null;
  /** null = נוצר ע"י מנהל-על שאינו רשום בחנות */
  createdBy: string | null;
}): Promise<{ link: string; expiresAt: string }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  const { error } = await supabaseAdmin.from("customer_invites").insert({
    token_hash: hashResetToken(token),
    email: input.email,
    price_tier: input.priceTier,
    agent_id: input.agentId,
    created_by: input.createdBy,
    expires_at: expiresAt,
  });
  if (error) throw new Error(error.message);
  return { link: `${siteOrigin()}/register?invite=${token}`, expiresAt };
}

/** הזמנה בתוקף (לא נוצלה, לא בוטלה, לא פגה) — או סיבה ברורה למה לא */
export async function findValidInvite(
  token: string,
): Promise<{ invite: InviteRow } | { reason: string }> {
  const { data } = await supabaseAdmin
    .from("customer_invites")
    .select("id, email, price_tier, agent_id, expires_at, used_at, revoked_at")
    .eq("token_hash", hashResetToken(token))
    .maybeSingle();
  if (!data) return { reason: "קישור ההזמנה לא תקין." };
  if (data.used_at) return { reason: "קישור ההזמנה כבר נוצל. אם כבר נרשמתם — אפשר פשוט להתחבר." };
  if (data.revoked_at) return { reason: "קישור ההזמנה בוטל." };
  if (new Date(data.expires_at).getTime() <= Date.now()) {
    return { reason: "תוקף קישור ההזמנה פג. בקשו מאיתנו קישור חדש." };
  }
  return { invite: data };
}

/** תפיסה אטומית: רק הרשמה אחת יכולה להשתמש בהזמנה */
export async function claimInvite(inviteId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("customer_invites")
    .update({ used_at: new Date().toISOString() })
    .eq("id", inviteId)
    .is("used_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id");
  return (data?.length ?? 0) === 1;
}

/** שחרור הזמנה שנתפסה אם ההרשמה נכשלה אחרי התפיסה */
export async function releaseInvite(inviteId: string): Promise<void> {
  await supabaseAdmin.from("customer_invites").update({ used_at: null }).eq("id", inviteId);
}

export async function markInviteUser(inviteId: string, userId: string): Promise<void> {
  await supabaseAdmin.from("customer_invites").update({ used_by: userId }).eq("id", inviteId);
}

export async function sendInviteEmail(
  email: string,
  link: string,
  expiresAt: string,
): Promise<{ sent: boolean; reason?: string }> {
  const { data: emailSettings } = await supabaseAdmin
    .from("email_settings")
    .select("sender_email")
    .eq("id", true)
    .maybeSingle();

  const until = new Date(expiresAt).toLocaleDateString("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "numeric",
    month: "long",
  });

  return sendEmail({
    from: emailSettings?.sender_email?.trim() || "",
    to: [email],
    subject: "הזמנה לפתיחת חשבון במערכת ההזמנות",
    html: await renderEmailHtml(
      "הזמנה לפתיחת חשבון",
      `
      <p>שלום,</p>
      <p>הוזמנתם לפתוח חשבון עסקי במערכת ההזמנות שלנו. בקישור ממלאים את פרטי העסק ובוחרים סיסמה — והחשבון פעיל מיד, אפשר להתחיל להזמין.</p>
      ${emailActionButton("פתיחת חשבון", link)}
      <p style="color:#6b7280;font-size:13px;">הקישור תקף עד ${until} ולשימוש אחד בלבד. אם לא ציפיתם להודעה הזו, אפשר להתעלם ממנה.</p>
    `,
    ),
  });
}
