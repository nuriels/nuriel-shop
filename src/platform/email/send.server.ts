// מתאם (adapter) לשירות המיילים הקיים של נוריאל (src/lib/email.server — Resend): שליחה בשם
// עסק (שם השולח = שם העסק, מענה = המייל של העסק, הכתובת עצמה על דומיין המערכת), עם
// Idempotency-Key — כך שניסיון חוזר לא שולח פעמיים. בלי שינוי בשירות עצמו.
import { escapeHtml as escape, resendApiKey, sendEmail } from "@/lib/email.server";

export interface BusinessEmail {
  to: string;
  subject: string;
  html: string;
  senderName: string;
  replyTo: string | null;
  /** מזהה יציב (למשל מזהה ההודעה בתור) — אותו מפתח לא נשלח פעמיים */
  idempotencyKey: string;
}

export interface BusinessEmailResult {
  sent: boolean;
  /** לא היה ניסיון שליחה (אין מפתח / נמען לא תקין) */
  skipped: boolean;
  id: string | null;
  reason: string | null;
}

export async function sendBusinessEmail(input: BusinessEmail): Promise<BusinessEmailResult> {
  const r = await sendEmail({
    to: [input.to],
    subject: input.subject,
    html: input.html,
    platformSender: { name: input.senderName, replyTo: input.replyTo },
    headers: { "Idempotency-Key": input.idempotencyKey },
  });
  return { sent: r.sent, skipped: r.skipped === true, id: r.id ?? null, reason: r.reason ?? null };
}

export const escapeHtml = escape;

/** שירות המיילים מוגדר בשרת (יש מפתח Resend) — בלעדיו שום מייל לא יוצא */
export function emailConfigured(): boolean {
  return resendApiKey() !== null;
}
