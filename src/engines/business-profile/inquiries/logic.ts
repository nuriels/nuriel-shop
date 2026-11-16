// פניות מלקוחות (מיגרציה 196) — הלוגיקה המשותפת לדפדפן ולשרת: בדיקת הטופס (עם הודעות שגיאה בעברית לכל
// שדה), התוויות בממשק, ותוכן מייל ההתראה. טהור — בלי קריאות רשת (נבדק ביחידה).

export const INQUIRY_KINDS = ["contact", "consultation", "quote", "other"] as const;
export type InquiryKind = (typeof INQUIRY_KINDS)[number];
export const KIND_LABELS: Record<InquiryKind, string> = {
  contact: "יצירת קשר",
  consultation: "שיחת ייעוץ",
  quote: "הצעת מחיר",
  other: "אחר",
};

export const INQUIRY_STATUSES = ["new", "in_progress", "done"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];
export const STATUS_LABELS: Record<InquiryStatus, string> = {
  new: "חדשה",
  in_progress: "בטיפול",
  done: "טופלה",
};

export type NotifyStatus = "pending" | "sending" | "sent" | "failed" | "skipped";
export const NOTIFY_LABELS: Record<NotifyStatus, string> = {
  pending: "ממתינה לשליחה",
  sending: "בשליחה",
  sent: "נשלחה",
  failed: "השליחה נכשלה",
  skipped: "לא נשלחה",
};

export const NAME_MAX = 120;
export const MESSAGE_MAX = 4000;
export const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

/** הודעות השגיאה לכל שדה — בניסוח ניטרלי, עם דוגמה לתיקון */
export const FIELD_ERRORS = {
  name: "נא למלא שם (לפחות 2 תווים)",
  nameLong: `השם ארוך מדי (עד ${NAME_MAX} תווים)`,
  phone: "מספר הטלפון לא תקין. לדוגמה: 050-1234567",
  email: "כתובת האימייל לא תקינה. לדוגמה: name@example.com",
  contact: "נא להשאיר טלפון או אימייל, כדי שאפשר יהיה לחזור אליכם",
  message: `ההודעה ארוכה מדי (עד ${MESSAGE_MAX} תווים)`,
} as const;

export type InquiryField = "name" | "phone" | "email" | "message";
export type FieldErrors = Partial<Record<InquiryField, string>>;

export interface InquiryFields {
  name: string;
  phone: string;
  email: string;
  message: string;
}

/** טלפון: ספרות בלבד (ו-+ בהתחלה); רווחים, מקפים וסוגריים נמחקים */
export function normalizePhone(raw: string): string {
  const v = raw.trim();
  const plus = v.startsWith("+");
  const digits = v.replace(/[^0-9]/g, "");
  return digits ? (plus ? `+${digits}` : digits) : "";
}

export function validateInquiry(
  input: InquiryFields,
): { ok: true; value: InquiryFields } | { ok: false; errors: FieldErrors } {
  const name = input.name.replace(/\s+/g, " ").trim();
  const phone = normalizePhone(input.phone);
  const email = input.email.trim().toLowerCase();
  const message = input.message.trim();
  const errors: FieldErrors = {};
  if (name.length < 2) errors.name = FIELD_ERRORS.name;
  else if (name.length > NAME_MAX) errors.name = FIELD_ERRORS.nameLong;
  if (phone && !/^\+?[0-9]{9,15}$/.test(phone)) errors.phone = FIELD_ERRORS.phone;
  if (email && (email.length > 254 || !EMAIL_RE.test(email))) errors.email = FIELD_ERRORS.email;
  if (!phone && !email) errors.phone = FIELD_ERRORS.contact;
  if (message.length > MESSAGE_MAX) errors.message = FIELD_ERRORS.message;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { name, phone, email, message } };
}

/** סדר השדות בטופס — אליו עובר הפוקוס כשיש שגיאה (הראשון שנכשל) */
export const FIELD_ORDER: InquiryField[] = ["name", "email", "phone", "message"];
export function firstInvalid(errors: FieldErrors): InquiryField | null {
  return FIELD_ORDER.find((f) => errors[f]) ?? null;
}

// ---------- מייל ההתראה לבעל העסק ----------
const escape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export function formatInquiryDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export interface InquiryEmailData {
  siteName: string;
  reference: string;
  kind: InquiryKind | string;
  formTitle: string | null;
  fullName: string;
  phone: string | null;
  email: string | null;
  message: string | null;
  createdAt: string;
  isTest: boolean;
  /** הקישור לאזור הפניות בממשק הניהול (דורש כניסה — הקישור עצמו לא נותן גישה) */
  link: string | null;
}

/** כתובות מייל לא נשמרות בהודעת השגיאה (היא מוצגת בממשק וביומן) */
export function scrubError(reason: string | null | undefined): string {
  const text = String(reason ?? "")
    .replace(/[^\s@<>"']+@[^\s@<>"']+/g, "[כתובת]")
    .replace(/\s+/g, " ")
    .trim();
  return (text || "השליחה נכשלה").slice(0, 300);
}

export function inquiryEmail(d: InquiryEmailData): { subject: string; html: string } {
  const kind = KIND_LABELS[d.kind as InquiryKind] ?? KIND_LABELS.other;
  const subject = `${d.isTest ? "[בדיקה] " : ""}פנייה חדשה מהאתר — ${d.fullName}`.slice(0, 200);
  const row = (label: string, value: string) =>
    `<tr><th scope="row" style="text-align:right;padding:6px 0 6px 16px;color:#5b5b5b;font-weight:600;white-space:nowrap;vertical-align:top">${escape(label)}</th><td style="padding:6px 0;color:#1d1d1d">${value}</td></tr>`;
  const rows = [
    row("שם", escape(d.fullName)),
    d.phone
      ? row(
          "טלפון",
          `<a href="tel:${escape(d.phone)}" style="color:#1d4ed8" dir="ltr">${escape(d.phone)}</a>`,
        )
      : "",
    d.email
      ? row(
          "אימייל",
          `<a href="mailto:${escape(d.email)}" style="color:#1d4ed8" dir="ltr">${escape(d.email)}</a>`,
        )
      : "",
    row("סוג הפנייה", escape(d.formTitle ? `${kind} — ${d.formTitle}` : kind)),
    row("התקבלה", escape(formatInquiryDate(d.createdAt))),
    row("מספר פנייה", escape(d.reference)),
  ].join("");
  const message = d.message
    ? `<h2 style="font-size:16px;margin:20px 0 6px">ההודעה</h2><p style="margin:0;white-space:pre-wrap;line-height:1.6">${escape(d.message)}</p>`
    : "";
  const button = d.link
    ? `<p style="margin:24px 0 8px"><a href="${escape(d.link)}" style="display:inline-block;background:#1d1d1d;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">לצפייה בפנייה בממשק הניהול</a></p><p style="margin:0;color:#5b5b5b;font-size:13px">הקישור מוביל לאזור "פניות מלקוחות" — הכניסה בחשבון שלכם ב-Nuriel (הקישור עצמו לא נותן גישה).</p>`
    : "";
  const test = d.isTest
    ? `<p style="margin:0 0 16px;padding:10px 12px;background:#fff7e6;border-radius:8px;color:#7a4b00">פניית בדיקה — נשלחה מהתצוגה המקדימה של האתר (לפני הפרסום).</p>`
    : "";
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${escape(subject)}</title></head><body style="margin:0;padding:24px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;direction:rtl;text-align:right"><div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px"><h1 style="font-size:20px;margin:0 0 4px">פנייה חדשה מהאתר</h1><p style="margin:0 0 16px;color:#5b5b5b">${escape(d.siteName)}</p>${test}<table role="presentation" style="border-collapse:collapse;width:100%">${rows}</table>${message}${button}<p style="margin:24px 0 0;color:#8a8a8a;font-size:12px">אפשר להשיב למייל הזה כדי לענות ישירות לפונה (כשצוין אימייל).</p></div></body></html>`;
  return { subject, html };
}
