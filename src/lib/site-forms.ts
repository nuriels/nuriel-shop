/**
 * טפסי האתר (חלק 16א) — "צור קשר" ו"ביטול עסקה": בדיקות קלט, סוגי קבצים
 * מותרים, וטיפוסים משותפים לדפדפן ולשרת. אותן בדיקות רצות בטופס (הודעה
 * מיידית ללקוח) ובשרת (לפני השמירה) — והמסד בודק שוב (CHECK).
 */

export const CONTACT_LIMITS = {
  name: { min: 2, max: 120 },
  message: { min: 2, max: 5000 },
  orderNumber: 40,
} as const;

export const CANCELLATION_LIMITS = {
  name: { min: 1, max: 60 },
  message: 5000,
  orderNumber: 40,
} as const;

/** קובץ מצורף לפנייה: עד 5MB */
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * הסיומות המותרות וסוג התוכן שנשמר לכל אחת. הסוג נקבע לפי הסיומת (לא לפי
 * מה שהדפדפן שלח), והשרת בודק גם את "חתימת" הקובץ (הבתים הראשונים).
 */
export const ATTACHMENT_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
} as const;

export type AttachmentExtension = keyof typeof ATTACHMENT_TYPES;

/** לשדה accept של בחירת הקובץ */
export const ATTACHMENT_ACCEPT = Object.keys(ATTACHMENT_TYPES)
  .map((ext) => `.${ext}`)
  .join(",");

export const ATTACHMENT_HINT = "תמונה, PDF, Word, Excel או טקסט — עד 5MB";

export function attachmentExtension(fileName: string): AttachmentExtension | null {
  const match = /\.([a-z0-9]{1,5})$/i.exec(fileName.trim());
  const ext = match?.[1]?.toLowerCase();
  return ext && ext in ATTACHMENT_TYPES ? (ext as AttachmentExtension) : null;
}

/** null = תקין; אחרת — הסיבה */
export function attachmentProblem(file: { name: string; size: number }): string | null {
  if (file.size <= 0) return "הקובץ ריק";
  if (file.size > ATTACHMENT_MAX_BYTES) return "הקובץ גדול מדי — עד 5MB";
  if (!attachmentExtension(file.name)) return `סוג הקובץ אינו נתמך (${ATTACHMENT_HINT})`;
  return null;
}

/**
 * חתימת הקובץ (magic bytes) תואמת לסיומת? — כדי שקובץ HTML / הרצה לא
 * יעלה בשם "תמונה.jpg". טקסט: בלי תווי NUL.
 */
export function attachmentBytesMatch(ext: AttachmentExtension, bytes: Uint8Array): boolean {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  const ascii = (offset: number, text: string) =>
    [...text].every((ch, i) => bytes[offset + i] === ch.charCodeAt(0));
  switch (ext) {
    case "jpg":
    case "jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "png":
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "gif":
      return ascii(0, "GIF87a") || ascii(0, "GIF89a");
    case "webp":
      return ascii(0, "RIFF") && ascii(8, "WEBP");
    case "heic":
      return ascii(4, "ftyp");
    case "pdf":
      return ascii(0, "%PDF-");
    case "docx":
    case "xlsx":
      return starts(0x50, 0x4b, 0x03, 0x04);
    case "doc":
    case "xls":
      return starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
    case "txt":
      return bytes.length > 0 && !bytes.subarray(0, 4096).includes(0);
  }
}

/** שם תצוגה בטוח לקובץ (בלי נתיב ותווי בקרה) */
export function cleanAttachmentName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>"]/g, "").trim();
  return (cleaned || "attachment").slice(-200);
}

// ------------------------------------------------------------
// שדות משותפים
// ------------------------------------------------------------

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export function normalizePhone(value: string): string {
  return value.trim().replace(/[^0-9+]/g, "");
}

/** טלפון: 9 עד 15 ספרות (+ אופציונלי בהתחלה) — כמו במסד */
export function phoneValid(value: string): boolean {
  return /^\+?[0-9]{9,15}$/.test(normalizePhone(value));
}

export function emailValid(value: string): boolean {
  const email = value.trim();
  return email.length <= 254 && EMAIL.test(email);
}

/** מספר הזמנה: בלי רווחים ו-#, באותיות גדולות */
export function normalizeOrderNumber(value: string): string {
  return value.replace(/[\s#]/g, "").toUpperCase();
}

export function orderNumberValid(value: string): boolean {
  return /^[A-Z0-9_/-]{1,40}$/.test(normalizeOrderNumber(value));
}

// ------------------------------------------------------------
// צור קשר
// ------------------------------------------------------------

export type ContactInput = {
  fullName: string;
  phone: string;
  email: string;
  message: string;
  orderNumber: string;
};

export type ContactField = keyof ContactInput | "attachment";

/** {} = תקין; אחרת — הודעה לכל שדה בעייתי */
export function contactProblems(input: ContactInput): Partial<Record<ContactField, string>> {
  const problems: Partial<Record<ContactField, string>> = {};
  const name = input.fullName.trim();
  if (name.length < CONTACT_LIMITS.name.min) problems.fullName = "נא למלא שם מלא";
  else if (name.length > CONTACT_LIMITS.name.max) problems.fullName = "השם ארוך מדי";
  if (!phoneValid(input.phone)) problems.phone = "מספר הטלפון אינו תקין";
  if (!emailValid(input.email)) problems.email = "כתובת האימייל אינה תקינה";
  const message = input.message.trim();
  if (message.length < CONTACT_LIMITS.message.min) problems.message = "נא לכתוב את תוכן הפנייה";
  else if (message.length > CONTACT_LIMITS.message.max) {
    problems.message = `ההודעה ארוכה מדי (עד ${CONTACT_LIMITS.message.max.toLocaleString("he-IL")} תווים)`;
  }
  if (input.orderNumber.trim() !== "" && !orderNumberValid(input.orderNumber)) {
    problems.orderNumber = "מספר ההזמנה אינו תקין";
  }
  return problems;
}

// ------------------------------------------------------------
// ביטול עסקה
// ------------------------------------------------------------

export type CancellationInput = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  message: string;
  orderNumber: string;
};

export type CancellationField = keyof CancellationInput | "captcha";

export function cancellationProblems(
  input: CancellationInput,
): Partial<Record<CancellationField, string>> {
  const problems: Partial<Record<CancellationField, string>> = {};
  const first = input.firstName.trim();
  const last = input.lastName.trim();
  if (first.length < CANCELLATION_LIMITS.name.min) problems.firstName = "נא למלא שם פרטי";
  else if (first.length > CANCELLATION_LIMITS.name.max) problems.firstName = "השם ארוך מדי";
  if (last.length < CANCELLATION_LIMITS.name.min) problems.lastName = "נא למלא שם משפחה";
  else if (last.length > CANCELLATION_LIMITS.name.max) problems.lastName = "השם ארוך מדי";
  if (!phoneValid(input.phone)) problems.phone = "מספר הטלפון אינו תקין";
  if (!emailValid(input.email)) problems.email = "כתובת האימייל אינה תקינה";
  if (input.message.trim().length > CANCELLATION_LIMITS.message) {
    problems.message = `ההודעה ארוכה מדי (עד ${CANCELLATION_LIMITS.message.toLocaleString("he-IL")} תווים)`;
  }
  if (input.orderNumber.trim() === "") problems.orderNumber = "מספר הזמנה הוא שדה חובה";
  else if (!orderNumberValid(input.orderNumber)) problems.orderNumber = "מספר ההזמנה אינו תקין";
  return problems;
}

// ------------------------------------------------------------
// אימות אנושי (Captcha) לטופס הביטול
// ------------------------------------------------------------

export type Captcha = {
  /** "7 + 5" */
  question: string;
  /** אסימון חתום מהשרת — חוזר עם התשובה */
  token: string;
};

// ------------------------------------------------------------
// תיבת הפניות בפאנל הניהול
// ------------------------------------------------------------

export type ContactStatus = "new" | "handled";
export type CancellationStatus = "new" | "in_progress" | "completed" | "rejected";

export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  new: "חדשה",
  handled: "טופלה",
};

export const CANCELLATION_STATUS_LABELS: Record<CancellationStatus, string> = {
  new: "חדשה",
  in_progress: "בטיפול",
  completed: "בוצע — העסקה בוטלה",
  rejected: "נדחתה",
};

export const CANCELLATION_STATUSES: CancellationStatus[] = [
  "new",
  "in_progress",
  "completed",
  "rejected",
];

export type ContactMessage = {
  id: string;
  full_name: string;
  phone: string;
  email: string;
  message: string;
  order_number: string | null;
  order_id: string | null;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_type: string | null;
  attachment_size: number | null;
  status: ContactStatus;
  admin_note: string | null;
  handled_at: string | null;
  created_at: string;
};

export type CancellationRequest = {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  message: string | null;
  order_number: string;
  order_id: string | null;
  order_contact_match: boolean;
  status: CancellationStatus;
  admin_note: string | null;
  handled_at: string | null;
  confirmation_sent_at: string | null;
  created_at: string;
};

/** 14 ימים מקבלת הודעת הביטול — המועד האחרון להחזר הכספי לפי החוק */
export const REFUND_DAYS = 14;

export function refundDeadline(receivedAt: string): Date {
  const date = new Date(receivedAt);
  date.setDate(date.getDate() + REFUND_DAYS);
  return date;
}

/** קיצור למספר הפנייה שמוצג ללקוח ("אסמכתה") */
export function referenceCode(id: string): string {
  return id.replace(/-/g, "").slice(0, 8).toUpperCase();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
