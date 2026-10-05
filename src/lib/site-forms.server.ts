/**
 * טפסי האתר (חלק 16א) — צד שרת בלבד: שמירת הקובץ המצורף בדלי הפרטי,
 * והמיילים — התראה למנהלי החנות על כל פנייה / הודעת ביטול, ואישור קבלה
 * ללקוח על הודעת ביטול (אסמכתה עם מועד הקבלה).
 */

import { supabaseAdminUnscoped } from "@/integrations/supabase/client.server";
import {
  emailActionButton,
  escapeHtml,
  renderEmailHtml,
  sendEmail,
  textToEmailHtml,
} from "@/lib/email.server";
import { storeAdminRecipients } from "@/lib/stock-alerts.server";
import {
  ATTACHMENT_TYPES,
  formatBytes,
  referenceCode,
  refundDeadline,
  REFUND_DAYS,
  type AttachmentExtension,
} from "@/lib/site-forms";

export const CONTACT_ATTACHMENTS_BUCKET = "contact-attachments";

/** הכתובת של האתר של החנות (לקישורים במייל); null אם לא ידועה */
async function siteOrigin(): Promise<string | null> {
  try {
    const { tenantSiteOrigin } = await import("@/integrations/supabase/tenant.server");
    return tenantSiteOrigin();
  } catch {
    return null;
  }
}

const israelTime = (iso: string | Date) =>
  new Date(iso).toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    dateStyle: "short",
    timeStyle: "short",
  });

const israelDate = (date: Date) =>
  date.toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", dateStyle: "short" });

function row(label: string, valueHtml: string): string {
  return `<tr>
    <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#6b7280;white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #eee;">${valueHtml}</td>
  </tr>`;
}

function table(rows: string[]): string {
  return `<table style="width:100%;border-collapse:collapse;margin:8px 0 14px;">${rows.join("")}</table>`;
}

const ltr = (value: string) => `<span dir="ltr">${escapeHtml(value)}</span>`;

/** טקסט מהלקוח בשורת הנושא — שורה אחת, בלי תווי בקרה, עד 80 תווים */
const subjectText = (value: string) =>
  value
    .replace(/[\p{Cc}\s]+/gu, " ")
    .trim()
    .slice(0, 80);

// ------------------------------------------------------------
// קובץ מצורף
// ------------------------------------------------------------

/** <tenant_id>/<message_id>/attachment.<ext> — השם המקורי נשמר רק לתצוגה */
export function attachmentPath(tenantId: string, messageId: string, ext: AttachmentExtension) {
  return `${tenantId}/${messageId}/attachment.${ext}`;
}

export async function uploadContactAttachment(
  path: string,
  ext: AttachmentExtension,
  bytes: Uint8Array,
): Promise<void> {
  const { error } = await supabaseAdminUnscoped.storage
    .from(CONTACT_ATTACHMENTS_BUCKET)
    .upload(path, bytes, { contentType: ATTACHMENT_TYPES[ext], upsert: false });
  if (error) throw new Error(error.message);
}

export async function removeContactAttachment(path: string): Promise<void> {
  try {
    await supabaseAdminUnscoped.storage.from(CONTACT_ATTACHMENTS_BUCKET).remove([path]);
  } catch (error) {
    console.error("[site-forms] failed to remove an orphan attachment", path, error);
  }
}

/** קישור הורדה זמני (5 דקות) — תמיד כהורדה, לא נפתח בתוך האתר */
export async function contactAttachmentUrl(path: string, downloadName: string): Promise<string> {
  const { data, error } = await supabaseAdminUnscoped.storage
    .from(CONTACT_ATTACHMENTS_BUCKET)
    .createSignedUrl(path, 300, { download: downloadName });
  if (error || !data?.signedUrl) throw new Error("יצירת קישור ההורדה נכשלה");
  return data.signedUrl;
}

// ------------------------------------------------------------
// מיילים — צור קשר
// ------------------------------------------------------------

export type ContactNotice = {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  message: string;
  orderNumber: string | null;
  orderFound: boolean;
  attachment: { name: string; size: number } | null;
};

export async function notifyContactMessage(notice: ContactNotice): Promise<boolean> {
  const to = await storeAdminRecipients();
  if (to.length === 0) return false;
  const origin = await siteOrigin();
  const rows = [
    row("שם", escapeHtml(notice.fullName)),
    row("טלפון", ltr(notice.phone)),
    row("אימייל", ltr(notice.email)),
  ];
  if (notice.orderNumber) {
    rows.push(
      row(
        "מספר הזמנה",
        `${ltr(notice.orderNumber)} ${notice.orderFound ? "" : '<span style="color:#b45309;">(לא נמצאה הזמנה עם המספר הזה)</span>'}`,
      ),
    );
  }
  if (notice.attachment) {
    rows.push(
      row(
        "קובץ מצורף",
        `${escapeHtml(notice.attachment.name)} (${formatBytes(notice.attachment.size)}) — להורדה מפאנל הניהול`,
      ),
    );
  }
  const body = `
    <p>התקבלה פנייה חדשה מטופס "צור קשר" באתר:</p>
    ${table(rows)}
    <div style="background:#f9fafb;border-radius:8px;padding:12px 14px;">${textToEmailHtml(notice.message)}</div>
    <p style="color:#6b7280;font-size:12px;margin-top:12px;">אפשר להשיב למייל הזה — התשובה תגיע ישירות ל-${escapeHtml(notice.email)}.</p>
    ${origin ? emailActionButton("לפנייה בפאנל הניהול", `${origin}/admin?tab=inbox`) : ""}
  `;
  const result = await sendEmail({
    to,
    subject: `פנייה חדשה מהאתר — ${subjectText(notice.fullName)}`,
    html: await renderEmailHtml("פנייה חדשה מהאתר", body),
    replyTo: notice.email,
  });
  return result.sent;
}

// ------------------------------------------------------------
// מיילים — ביטול עסקה
// ------------------------------------------------------------

export type CancellationNotice = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  message: string | null;
  orderNumber: string;
  orderFound: boolean;
  contactMatch: boolean;
  receivedAt: string;
};

export async function notifyCancellationRequest(notice: CancellationNotice): Promise<boolean> {
  const to = await storeAdminRecipients();
  if (to.length === 0) return false;
  const origin = await siteOrigin();
  const match = !notice.orderFound
    ? '<span style="color:#b91c1c;">לא נמצאה הזמנה עם המספר הזה — כדאי לוודא מול הלקוח</span>'
    : notice.contactMatch
      ? '<span style="color:#047857;">ההזמנה נמצאה, והפרטים תואמים להזמנה</span>'
      : '<span style="color:#b45309;">ההזמנה נמצאה, אבל האימייל והטלפון שונים מאלה שבהזמנה — כדאי לוודא מול הלקוח</span>';
  const body = `
    <p>התקבלה הודעת ביטול עסקה מהאתר:</p>
    ${table([
      row("מספר הזמנה", `${ltr(notice.orderNumber)}<br>${match}`),
      row("שם", escapeHtml(`${notice.firstName} ${notice.lastName}`)),
      row("טלפון", ltr(notice.phone)),
      row("אימייל", ltr(notice.email)),
      row("התקבלה", escapeHtml(israelTime(notice.receivedAt))),
      row("אסמכתה", ltr(referenceCode(notice.id))),
    ])}
    ${
      notice.message
        ? `<p style="margin-bottom:4px;"><strong>סיבת הביטול:</strong></p><div style="background:#f9fafb;border-radius:8px;padding:12px 14px;">${textToEmailHtml(notice.message)}</div>`
        : '<p style="color:#6b7280;">הלקוח לא פירט סיבה (לפי החוק אין חובה לנמק).</p>'
    }
    <p style="background:#fef3c7;border-radius:8px;padding:10px 12px;color:#78350f;">
      לפי חוק הגנת הצרכן, ההחזר הכספי (אם מגיע) צריך להתבצע תוך ${REFUND_DAYS} ימים מקבלת הודעת הביטול —
      עד <strong>${escapeHtml(israelDate(refundDeadline(notice.receivedAt)))}</strong>.
    </p>
    ${origin ? emailActionButton("לטיפול בבקשה", `${origin}/admin?tab=inbox&inbox=cancellations`) : ""}
  `;
  const result = await sendEmail({
    to,
    subject: `הודעת ביטול עסקה — הזמנה ${notice.orderNumber}`,
    html: await renderEmailHtml("הודעת ביטול עסקה", body),
    replyTo: notice.email,
  });
  return result.sent;
}

/** אישור קבלה ללקוח — הוא שומר אותו כאסמכתה למועד ההודעה */
export async function confirmCancellationToCustomer(notice: CancellationNotice): Promise<boolean> {
  const origin = await siteOrigin();
  const body = `
    <p>שלום ${escapeHtml(notice.firstName)},</p>
    <p>הודעת ביטול העסקה שלך התקבלה אצלנו. אלה הפרטים שנרשמו:</p>
    ${table([
      row("מספר הזמנה", ltr(notice.orderNumber)),
      row("מועד קבלת ההודעה", escapeHtml(israelTime(notice.receivedAt))),
      row("אסמכתה", ltr(referenceCode(notice.id))),
    ])}
    <p>נבדוק את הבקשה ונחזור אליך בהקדם. הטיפול בביטול ובהחזר הכספי ייעשה בהתאם למדיניות הביטולים של האתר ולחוק הגנת הצרכן.</p>
    ${origin ? `<p><a href="${escapeHtml(`${origin}/cancellations`)}" style="color:#9C6F22;">למדיניות הביטולים</a></p>` : ""}
    <p style="color:#6b7280;font-size:12px;">כדאי לשמור את המייל הזה — הוא האישור שהודעת הביטול נמסרה.</p>
  `;
  const result = await sendEmail({
    to: [notice.email],
    subject: `קיבלנו את הודעת ביטול העסקה — הזמנה ${notice.orderNumber}`,
    html: await renderEmailHtml("הודעת הביטול התקבלה", body),
  });
  return result.sent;
}
