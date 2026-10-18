/**
 * חלק 42: תיק לקוח מרכזי (סופר-אדמין) — צד שרת.
 *
 *  - הסכם שירות עם בעל החנות: טוקן אקראי (מגובב במסד), מייל עם קישור, וחתימה.
 *  - יומן מיילים של הפלטפורמה לבעל החנות (בלי תוכן — רק נושא כללי, סטטוס, מזהה ספק).
 *  - יומן פעולות מנהל-על (בלי סודות).
 * הכל עם service_role ללא סינון חנות — נקרא רק מפונקציות שבדקו מנהל-על, או מהטוקן.
 */

import { createHash, randomBytes } from "node:crypto";
import type { Json } from "@/integrations/supabase/types";
import { supabaseAdminUnscoped } from "@/integrations/supabase/client.server";
import { originForTenant } from "@/integrations/supabase/tenant.server";
import { PORTAL_STORE_SLUG } from "@/lib/portal";
import type { SendResult } from "@/lib/email.server";

export const AGREEMENT_TOKEN_DAYS = 14;

export function hashPlatformToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** הכתובת הקבועה של שער הפלטפורמה — עובדת גם כשהחנות החדשה עוד בלי SSL */
export function portalOrigin(): string {
  return originForTenant({ slug: PORTAL_STORE_SLUG, domain: null, is_default: false });
}

export type AuditActor = { id: string | null; email: string | null };

/** מזהה ואימייל של מי שביצע את הפעולה — מתוך ההקשר של requireSupabaseAuth */
export function actorOf(context: { userId: string; claims?: unknown }): AuditActor {
  const email = (context.claims as { email?: unknown } | undefined)?.email;
  return { id: context.userId, email: typeof email === "string" ? email : null };
}

/** שורה ביומן הפעולות. כשל ברישום לא מפיל את הפעולה עצמה. */
export async function recordPlatformAudit(input: {
  tenantId: string | null;
  actor: AuditActor | null;
  action: string;
  details?: Record<string, Json | undefined>;
}): Promise<void> {
  try {
    const details: Record<string, Json> = {};
    for (const [key, value] of Object.entries(input.details ?? {})) {
      if (value !== undefined) details[key] = value;
    }
    const { error } = await supabaseAdminUnscoped.from("platform_audit_log").insert({
      tenant_id: input.tenantId,
      actor_id: input.actor?.id ?? null,
      actor_email: input.actor?.email ?? null,
      action: input.action,
      details,
    });
    if (error) console.error("[platform-audit] insert failed", error.message);
  } catch (error) {
    console.error("[platform-audit] crashed", error);
  }
}

/** מייל שהפלטפורמה שלחה לבעל חנות — מתועד בתיק (נושא כללי, בלי תוכן וקודים) */
export async function logPlatformEmail(input: {
  tenantId: string;
  to: string;
  subject: string;
  kind: string;
  result: SendResult;
  acceptanceId?: string | null;
}): Promise<void> {
  try {
    const status = input.result.sent ? "sent" : input.result.skipped ? "skipped" : "failed";
    const { error } = await supabaseAdminUnscoped.from("platform_email_log").insert({
      tenant_id: input.tenantId,
      to_email: input.to.slice(0, 1000),
      subject: input.subject.slice(0, 300),
      kind: input.kind,
      status,
      provider_message_id: input.result.id ?? null,
      error: input.result.sent ? null : (input.result.reason ?? "").slice(0, 500) || null,
      acceptance_id: input.acceptanceId ?? null,
    });
    if (error) console.error("[platform-email-log] insert failed", error.message);
  } catch (error) {
    console.error("[platform-email-log] crashed", error);
  }
}

export type IssueOutcome =
  | { issued: true; acceptanceId: string; version: number; emailSent: boolean; reason?: string }
  | { issued: false; reason: "already_signed" | "failed"; message?: string };

/**
 * פותח בקשת חתימה על הגרסה הנוכחית ושולח לבעל החנות מייל עם קישור מאובטח.
 * לא נשלח אם הגרסה הנוכחית כבר נחתמה. הקישור הקודם שעוד ממתין — מוחלף.
 */
export async function issueOwnerAgreement(input: {
  tenantId: string;
  ownerEmail: string;
  ownerUserId?: string | null;
  actor?: AuditActor | null;
}): Promise<IssueOutcome> {
  const email = input.ownerEmail.trim().toLowerCase();
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + AGREEMENT_TOKEN_DAYS * 24 * 60 * 60 * 1000);

  const { data, error } = await supabaseAdminUnscoped.rpc("platform_agreement_issue", {
    _tenant: input.tenantId,
    _email: email,
    _user: input.ownerUserId ?? (null as unknown as string),
    _token_hash: hashPlatformToken(token),
    _expires: expires.toISOString(),
  });
  if (error) return { issued: false, reason: "failed", message: error.message };
  const row = (data ?? {}) as { issued?: boolean; id?: string; version?: number };
  if (row.issued !== true || !row.id) return { issued: false, reason: "already_signed" };

  const { data: tenant } = await supabaseAdminUnscoped
    .from("tenants")
    .select("name")
    .eq("id", input.tenantId)
    .maybeSingle();
  const storeName = tenant?.name ?? "";

  const { escapeHtml, emailActionButton, renderEmailHtml, sendEmail } =
    await import("@/lib/email.server");
  const link = `${portalOrigin()}/owner-agreement/${token}`;
  const subject = "הסכם שירות — אישור וחתימה";
  const result = await sendEmail({
    to: [email],
    subject,
    html: await renderEmailHtml(
      "הסכם שירות לאישור",
      `<p>שלום,</p>
       <p>תודה שפתחת את החנות <strong>${escapeHtml(storeName)}</strong>. כדי להשלים את ההצטרפות יש לעיין בהסכם השירות ולחתום עליו — זה לוקח כדקה, ישירות מהדפדפן.</p>
       ${emailActionButton("לעיון בהסכם ולחתימה", link)}
       <p style="color:#6b7280;font-size:13px;">הקישור אישי, תקף ${AGREEMENT_TOKEN_DAYS} ימים וניתן לשימוש פעם אחת. אם לא ביקשת לפתוח חנות — אפשר להתעלם מהמייל.</p>`,
    ),
    platformSender: { name: "מערכת ניהול אתר אינטרנט" },
  });
  await logPlatformEmail({
    tenantId: input.tenantId,
    to: email,
    subject,
    kind: "agreement",
    result,
    acceptanceId: row.id,
  });
  await recordPlatformAudit({
    tenantId: input.tenantId,
    actor: input.actor ?? null,
    action: "agreement_sent",
    details: { version: row.version ?? null, emailSent: result.sent },
  });
  return {
    issued: true,
    acceptanceId: row.id,
    version: row.version ?? 0,
    emailSent: result.sent,
    ...(result.sent ? {} : { reason: result.reason ?? "השליחה נכשלה" }),
  };
}

/** אחרי הקמת חנות חדשה — לא מפיל את ההקמה אם משהו נכשל */
export async function issueOwnerAgreementSafe(
  input: Parameters<typeof issueOwnerAgreement>[0],
): Promise<void> {
  try {
    const outcome = await issueOwnerAgreement(input);
    if (!outcome.issued && outcome.reason === "failed") {
      console.error("[owner-agreement] issue failed", outcome.message);
    }
  } catch (error) {
    console.error("[owner-agreement] crashed", error);
  }
}
