/**
 * אמצעי תשלום חלופיים (חלק 17ב) — "תשלום טלפוני מול נציג" ו"תשלום בביט".
 * משותף לדפדפן ולשרת: בדיקות קלט, תוויות, וסימון ההזמנה שממתינה לתשלום
 * בביט בדפדפן (localStorage) — כדי שלקוח שחוזר לקופה אחרי המעבר לאפליקציה
 * יוחזר לעמוד אימות התשלום.
 *
 * כל הבדיקות רצות שוב בשרת ובמסד (טריגרים ו-CHECK).
 */

import { attachmentBytesMatch, attachmentExtension, cleanAttachmentName } from "@/lib/site-forms";

// ------------------------------------------------------------
// אמצעי תשלום ומצבי תשלום
// ------------------------------------------------------------

/** offline = תשלום טלפוני מול נציג | bit = העברה בביט | credit_card = הזמנות ישנות (Hyp הוסר בחלק 28) */
export type PaymentMethod = "offline" | "credit_card" | "bit";

/**
 * awaiting = ממתינה לתשלום (pending_payment) · awaiting_verification = ממתינה
 * לאישור תשלום (הלקוח שלח אסמכתא) · rejected = בעל החנות דחה את התשלום
 */
export type PaymentStatus =
  "not_required" | "awaiting" | "awaiting_verification" | "paid" | "expired" | "rejected";

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  offline: "תשלום טלפוני מול נציג",
  credit_card: "תשלום באשראי",
  bit: "תשלום בביט",
};

/** כמה זמן יש ללקוח להעביר בביט ולשלוח אסמכתא (כמו במסד) */
export const BIT_PAYMENT_WINDOW_HOURS = 24;

/** תווית מצב התשלום (null = בלי תג — הזמנה בלי תשלום באתר) */
export function paymentStatusLabel(
  method: PaymentMethod | null | undefined,
  status: PaymentStatus | null | undefined,
): string | null {
  const bit = method === "bit";
  switch (status) {
    case "awaiting":
      return bit ? "ממתינה לתשלום בביט" : "ממתינה לתשלום";
    case "awaiting_verification":
      return "ממתינה לאישור תשלום (ביט)";
    case "paid":
      return bit ? "שולמה בביט" : method === "credit_card" ? "שולמה באשראי" : "שולמה";
    case "expired":
      return "לא שולמה בזמן";
    case "rejected":
      return "התשלום נדחה";
    default:
      return null;
  }
}

// ------------------------------------------------------------
// מספר הטלפון לביט (של בעל החנות)
// ------------------------------------------------------------

/** 050-123 4567 / +972 50-1234567 → 0501234567 ("" אם ריק) */
export function normalizeBitPhone(raw: string | null | undefined): string {
  let digits = (raw ?? "").replace(/\D/g, "");
  if (digits.startsWith("972")) digits = `0${digits.slice(3)}`;
  return digits;
}

/** null = תקין (או ריק) */
export function bitPhoneProblem(raw: string | null | undefined): string | null {
  const phone = normalizeBitPhone(raw);
  if (phone === "") return null;
  return /^05\d{8}$/.test(phone)
    ? null
    : "מספר הטלפון לביט צריך להיות מספר נייד ישראלי (למשל 050-1234567)";
}

/** 0521234567 → 052-123-4567 */
export function formatBitPhone(raw: string | null | undefined): string {
  const phone = normalizeBitPhone(raw);
  return /^05\d{8}$/.test(phone)
    ? `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}`
    : phone;
}

export type OfflinePaymentSettings = {
  phoneEnabled: boolean;
  bitEnabled: boolean;
  bitPhone: string;
};

/** בדיקת ההגדרות לפני שמירה (כמו הטריגר במסד); null = תקין */
export function offlinePaymentSettingsProblem(settings: OfflinePaymentSettings): string | null {
  const phoneProblem = bitPhoneProblem(settings.bitPhone);
  if (phoneProblem) return phoneProblem;
  if (settings.bitEnabled && normalizeBitPhone(settings.bitPhone) === "") {
    return "כדי להפעיל תשלום בביט יש להזין מספר טלפון לקבלת תשלום בביט";
  }
  if (!settings.phoneEnabled && !settings.bitEnabled) {
    return "יש להשאיר לפחות אמצעי תשלום אחד פעיל בקופה";
  }
  return null;
}

// ------------------------------------------------------------
// אימות התשלום: מספר אסמכתא / צילום מסך
// ------------------------------------------------------------

export const BIT_REFERENCE_LIMITS = { min: 2, max: 64 } as const;

/** רווחים מיותרים יוצאים (כמו במסד) */
export function cleanBitReference(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\s+/g, " ").trim();
}

/** null = תקין (או ריק) */
export function bitReferenceProblem(raw: string | null | undefined): string | null {
  const reference = cleanBitReference(raw);
  if (reference === "") return null;
  if (
    reference.length < BIT_REFERENCE_LIMITS.min ||
    reference.length > BIT_REFERENCE_LIMITS.max ||
    /\p{Cc}/u.test(reference)
  ) {
    return "מספר האסמכתא אינו תקין";
  }
  return null;
}

/** צילום מסך: תמונה או PDF, עד 5MB */
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

export const RECEIPT_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  pdf: "application/pdf",
} as const;

export type ReceiptExtension = keyof typeof RECEIPT_TYPES;

export const RECEIPT_ACCEPT = Object.keys(RECEIPT_TYPES)
  .map((ext) => `.${ext}`)
  .join(",");

export const RECEIPT_HINT = "צילום מסך (תמונה) או PDF — עד 5MB";

export function receiptExtension(fileName: string): ReceiptExtension | null {
  const ext = attachmentExtension(fileName);
  return ext && ext in RECEIPT_TYPES ? (ext as ReceiptExtension) : null;
}

/** null = תקין */
export function receiptProblem(file: { name: string; size: number }): string | null {
  if (file.size <= 0) return "הקובץ ריק";
  if (file.size > RECEIPT_MAX_BYTES) return "הקובץ גדול מדי — עד 5MB";
  if (!receiptExtension(file.name)) return `סוג הקובץ אינו נתמך (${RECEIPT_HINT})`;
  return null;
}

/** "חתימת" הקובץ תואמת לסיומת (קובץ HTML / הרצה לא עולה בשם "צילום.png") */
export function receiptBytesMatch(ext: ReceiptExtension, bytes: Uint8Array): boolean {
  return attachmentBytesMatch(ext, bytes);
}

export function cleanReceiptName(name: string): string {
  return cleanAttachmentName(name);
}

/** האם לפחות אחד מהשניים: אסמכתא או קובץ */
export function bitProofProblem(reference: string, hasFile: boolean): string | null {
  const referenceProblem = bitReferenceProblem(reference);
  if (referenceProblem) return referenceProblem;
  if (cleanBitReference(reference) === "" && !hasFile) {
    return "יש להזין מספר אסמכתא או לצרף צילום מסך של ההעברה";
  }
  return null;
}

// ------------------------------------------------------------
// מה שעמוד התשלום בביט מקבל מהשרת
// ------------------------------------------------------------

export type BitPaymentInfo = {
  orderId: string;
  orderNumber: string;
  /** הסכום לתשלום (כולל מע"מ) */
  amount: number;
  /** סטטוס ההזמנה (pending / cancelled / ...) */
  status: string;
  paymentStatus: PaymentStatus;
  dueAt: string | null;
  reportedAt: string | null;
  paidAt: string | null;
  hasReference: boolean;
  hasReceipt: boolean;
  /** המספר בביט של בעל החנות (0521234567); null = ביט כובה בינתיים */
  bitPhone: string | null;
  storeName: string | null;
  storePhone: string | null;
  /** ההזמנה של לקוח רשום (יש לו "ההזמנות שלי") */
  registered: boolean;
  /** חלק 22: איסוף עצמי — עם כתובת החנות ושעות הפעילות */
  pickup: boolean;
  storeAddress: string | null;
  storeHours: string | null;
};

/** איפה העמוד עומד: לשלם / נשלח, ממתין לאישור / שולם / בוטל */
export type BitPageStage = "pay" | "submitted" | "paid" | "closed";

export function bitPageStage(info: Pick<BitPaymentInfo, "status" | "paymentStatus">): BitPageStage {
  if (info.paymentStatus === "paid") return "paid";
  if (
    info.status === "cancelled" ||
    info.paymentStatus === "expired" ||
    info.paymentStatus === "rejected"
  ) {
    return "closed";
  }
  if (info.paymentStatus === "awaiting_verification") return "submitted";
  return "pay";
}

// ------------------------------------------------------------
// סימון בדפדפן: הזמנה שממתינה לתשלום בביט
// ------------------------------------------------------------

export const BIT_PENDING_STORAGE_KEY = "bit-pending-order:v1";

export type PendingBitOrder = { orderId: string; orderNumber: string; createdAt: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isOrderId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function readPendingBitOrder(): PendingBitOrder | null {
  try {
    const raw = window.localStorage.getItem(BIT_PENDING_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingBitOrder>;
    if (!isOrderId(parsed.orderId)) return null;
    // סימון ישן מ-3 ימים ומעלה — ההזמנה כבר בוטלה ממילא
    const created = Date.parse(String(parsed.createdAt ?? ""));
    if (Number.isFinite(created) && Date.now() - created > 3 * 24 * 60 * 60 * 1000) {
      window.localStorage.removeItem(BIT_PENDING_STORAGE_KEY);
      return null;
    }
    return {
      orderId: parsed.orderId,
      orderNumber: String(parsed.orderNumber ?? ""),
      createdAt: String(parsed.createdAt ?? ""),
    };
  } catch {
    return null;
  }
}

export function writePendingBitOrder(order: { orderId: string; orderNumber: string }): void {
  try {
    window.localStorage.setItem(
      BIT_PENDING_STORAGE_KEY,
      JSON.stringify({ ...order, createdAt: new Date().toISOString() }),
    );
  } catch {
    // אחסון חסום — הכתובת עצמה (/checkout/bit/<id>) עדיין שומרת את ההזמנה
  }
}

export function clearPendingBitOrder(orderId?: string): void {
  try {
    if (orderId) {
      const current = readPendingBitOrder();
      if (current && current.orderId !== orderId) return;
    }
    window.localStorage.removeItem(BIT_PENDING_STORAGE_KEY);
  } catch {
    // אין מה לנקות
  }
}

/** הכתובת של עמוד התשלום בביט */
export function bitPaymentPath(orderId: string): string {
  return `/checkout/bit/${orderId}`;
}
