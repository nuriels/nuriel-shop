// ============================================================
// מודול רישיונות דיגיטליים (פיילוט: נוריאל מחשבים) — קוד משותף לדפדפן ולשרת.
// בלי סודות ובלי גישה למסד: קבועים, בדיקות תקינות (אותן בדיקות בטופס ובשרת),
// מיסוך מפתח, סטטוסים, וחתימת קובץ (magic bytes).
// ============================================================

/** דגל הפיילוט במנגנון הדגלים (platform_feature_flags + tenant_feature_flags) */
export const LICENSE_FLAG = "digital_licenses";

export const LICENSE_PRODUCTS = ["office", "windows"] as const;
export type LicenseProduct = (typeof LICENSE_PRODUCTS)[number];
export const LICENSE_PRODUCT_LABEL: Record<LicenseProduct, string> = {
  office: "Microsoft Office",
  windows: "Microsoft Windows",
};

export const LICENSE_FILE_KINDS = ["guide", "installer", "receipt"] as const;
export type LicenseFileKind = (typeof LICENSE_FILE_KINDS)[number];
export const LICENSE_FILE_KIND_LABEL: Record<LicenseFileKind, string> = {
  guide: "הוראות התקנה (PDF)",
  installer: "תוכנת התקנה (EXE)",
  receipt: "קבלה (PDF)",
};

/** ההודעה שמתחת לשדה המפתח ובמייל — נוסח מדויק, לא לשנות */
export const LICENSE_DISCLAIMER =
  "הרישיון אינו אישי ומיועד להתקנה אחת בלבד. המערכת מזהה התקנות כפולות באופן אוטומטי.";

export const LINK_VALID_DAYS = 7;
export const LINK_MAX_DOWNLOADS = 3;
export const MAX_PDF_BYTES = 15 * 1024 * 1024;
/** מגבלת ברירת המחדל של שירות האחסון (FILE_SIZE_LIMIT) — 50MB */
export const MAX_EXE_BYTES = 50 * 1024 * 1024;

export const LICENSE_BUCKET = "license-files";
export const DOWNLOAD_PATH = "/license-download";
/** ה-Token בקישור: 32 בתים אקראיים ב-base64url */
export const DOWNLOAD_TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;
export const UUID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isLicenseProduct(value: unknown): value is LicenseProduct {
  return (LICENSE_PRODUCTS as readonly unknown[]).includes(value);
}
export function isLicenseFileKind(value: unknown): value is LicenseFileKind {
  return (LICENSE_FILE_KINDS as readonly unknown[]).includes(value);
}
export function extensionFor(kind: LicenseFileKind): "exe" | "pdf" {
  return kind === "installer" ? "exe" : "pdf";
}
export function contentTypeFor(kind: LicenseFileKind): string {
  return kind === "installer" ? "application/vnd.microsoft.portable-executable" : "application/pdf";
}
export function maxBytesFor(kind: LicenseFileKind): number {
  return kind === "installer" ? MAX_EXE_BYTES : MAX_PDF_BYTES;
}

// ------------------------------------------------------------
// פרטי הלקוח
// ------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export function cleanCustomerName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}
export function customerNameProblem(name: string): string | null {
  if (name.length < 2) return "נא להזין שם מלא";
  if (name.length > 120) return "השם ארוך מדי (עד 120 תווים)";
  if (CONTROL.test(name) || /[<>"]/.test(name)) return "השם מכיל תווים לא תקינים";
  return null;
}

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
export function emailProblem(email: string): string | null {
  if (email === "") return "נא להזין כתובת אימייל";
  if (email.length > 254 || !EMAIL.test(email)) return "כתובת האימייל אינה תקינה";
  return null;
}

/** טלפון: ספרות בלבד, עם + בהתחלה לחיוג בינלאומי ("050-123-4567" → "0501234567") */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : digits;
}
export function phoneProblem(phone: string): string | null {
  const digits = phone.replace(/^\+/, "");
  if (digits === "") return "נא להזין מספר טלפון";
  if (digits.length < 9 || digits.length > 15) return "מספר הטלפון אינו תקין";
  return null;
}

/** ח.פ. / עוסק מורשה: 9 ספרות (8 ספרות — משלימים 0 בהתחלה) */
export function normalizeBusinessId(raw: string): string {
  const digits = raw.replace(/[\s-]/g, "");
  return /^\d{8}$/.test(digits) ? `0${digits}` : digits;
}
export function businessIdProblem(id: string): string | null {
  if (id === "") return null;
  if (!/^\d{9}$/.test(id)) return "ח.פ. / מספר עוסק — 9 ספרות";
  // ספרת ביקורת (כמו תעודת זהות; גם מספרי חברה עומדים בה)
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = Number(id[i]) * ((i % 2) + 1);
    if (d > 9) d -= 9;
    sum += d;
  }
  return sum % 10 === 0 ? null : "ח.פ. / מספר עוסק אינו תקין (ספרת ביקורת)";
}

export function cleanOrderNumber(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}
export function orderNumberProblem(order: string): string | null {
  if (order === "") return null;
  if (order.length > 40) return "מספר ההזמנה ארוך מדי (עד 40 תווים)";
  if (!/^[\p{L}\p{N} _\-/#.]+$/u.test(order)) return "מספר ההזמנה מכיל תווים לא תקינים";
  return null;
}

// ------------------------------------------------------------
// מפתח הרישיון
// ------------------------------------------------------------

/** אותיות וספרות גדולות, בקבוצות של 5 ("abcde fghij…" → "ABCDE-FGHIJ-…") */
export function normalizeProductKey(raw: string): string {
  const compact = raw.toUpperCase().replace(/[\s-]/g, "");
  if (/^[A-Z0-9]{25}$/.test(compact)) {
    return compact.match(/.{5}/g)!.join("-");
  }
  return raw.trim().toUpperCase();
}
const KEY_FORMAT = /^[A-Z0-9]{5}(?:-[A-Z0-9]{5}){4}$/;
export function productKeyProblem(key: string): string | null {
  if (key === "") return "נא להזין את מפתח הרישיון";
  if (!KEY_FORMAT.test(key)) {
    return "מפתח רישיון תקין בנוי מ-25 תווים, 5 קבוצות של 5: XXXXX-XXXXX-XXXXX-XXXXX-XXXXX";
  }
  return null;
}
/** תווים שלא מופיעים במפתחות Microsoft (תנועות, 0 / 1 / 5) — אזהרה בלבד, לטעויות הקלדה */
export function productKeyWarning(key: string): string | null {
  if (!KEY_FORMAT.test(key)) return null;
  return /[AEILOSU015]/.test(key.replace(/-/g, ""))
    ? "שימו לב: במפתח יש תווים שבדרך כלל לא מופיעים במפתחות Microsoft (כמו O / 0 / I / 1). כדאי לבדוק שאין טעות הקלדה."
    : null;
}
export function keyTail(key: string): string {
  return key.replace(/-/g, "").slice(-5);
}
/** המפתח מוסתר: רק 5 התווים האחרונים */
export function maskedKey(tail: string): string {
  return `•••••-•••••-•••••-•••••-${tail}`;
}

// ------------------------------------------------------------
// סטטוס המייל — רק מה שהספק אישר באמת
// ------------------------------------------------------------

export type EmailStatus = "pending" | "accepted" | "delivered" | "failed" | "unknown";
export const EMAIL_STATUS_LABEL: Record<EmailStatus, string> = {
  pending: "בשליחה",
  accepted: "התקבל לשליחה",
  delivered: "נמסר",
  failed: "נכשל",
  unknown: "לא ידוע",
};
export const EMAIL_STATUS_HINT: Record<EmailStatus, string> = {
  pending: "המייל בתהליך שליחה",
  accepted: "ספק המייל קיבל את המייל לשליחה; עדיין אין אישור מסירה לתיבת הלקוח",
  delivered: "ספק המייל אישר שהמייל נמסר לשרת הדואר של הלקוח",
  failed: "המייל לא נמסר — ניתן לשלוח שוב מההיסטוריה",
  unknown: "אין תשובה ודאית מספק המייל (תקלת תקשורת) — כדאי לרענן סטטוס או לשלוח שוב",
};

/** האירוע האחרון של Resend (GET /emails/:id → last_event) → הסטטוס שלנו; null = לא משנים */
export function statusFromProviderEvent(event: string | null | undefined): EmailStatus | null {
  switch ((event ?? "").toLowerCase()) {
    case "delivered":
    case "opened":
    case "clicked":
    case "complained": // נמסר, והנמען סימן כדואר זבל
      return "delivered";
    case "bounced":
    case "failed":
    case "canceled":
    case "suppressed":
      return "failed";
    case "sent":
    case "queued":
    case "scheduled":
    case "delivery_delayed":
      return "accepted";
    default:
      return null;
  }
}
export const PROVIDER_EVENT_LABEL: Record<string, string> = {
  queued: "בתור לשליחה",
  scheduled: "מתוזמן",
  sent: "נשלח מהספק",
  delivery_delayed: "המסירה מתעכבת",
  delivered: "נמסר",
  opened: "נפתח",
  clicked: "הקישור נלחץ",
  complained: "נמסר — הלקוח סימן כדואר זבל",
  bounced: "נדחה (bounce)",
  failed: "נכשל",
  canceled: "בוטל",
  suppressed: "נחסם (הכתובת ברשימת חסימה)",
};

// ------------------------------------------------------------
// קישור ההורדה
// ------------------------------------------------------------

export type LinkState = "active" | "expired" | "exhausted" | "revoked";
export const LINK_STATE_LABEL: Record<LinkState, string> = {
  active: "פעיל",
  expired: "פג תוקף",
  exhausted: "נוצלו כל ההורדות",
  revoked: "בוטל",
};
export function linkState(
  link: {
    expires_at: string;
    download_count: number;
    max_downloads: number;
    revoked_at: string | null;
  },
  now: number = Date.now(),
): LinkState {
  if (link.revoked_at) return "revoked";
  if (new Date(link.expires_at).getTime() <= now) return "expired";
  if (link.download_count >= link.max_downloads) return "exhausted";
  return "active";
}
export function downloadUrl(origin: string, token: string): string {
  // ה-Token אחרי # — הדפדפן לא שולח אותו לשרת: לא נרשם ביומני השרת, וסורקי קישורים במיילים
  // (Outlook / Gmail) לא "מנצלים" הורדות. ההורדה עצמה — POST מהעמוד.
  return `${origin.replace(/\/$/, "")}${DOWNLOAD_PATH}#${token}`;
}

// ------------------------------------------------------------
// קבצים
// ------------------------------------------------------------

/**
 * חתימת הקובץ האמיתית (לא הסיומת): PDF מתחיל ב-"%PDF-"; EXE הוא קובץ PE —
 * "MZ" בהתחלה, ו-"PE\0\0" במיקום שכתוב בכותרת (e_lfanew ב-0x3C).
 * null = תקין.
 */
export function fileSignatureProblem(kind: LicenseFileKind, bytes: Uint8Array): string | null {
  if (kind !== "installer") {
    const pdf = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
    return pdf.every((b, i) => bytes[i] === b) ? null : "הקובץ אינו PDF תקין";
  }
  if (bytes.length < 0x40 || bytes[0] !== 0x4d || bytes[1] !== 0x5a)
    return "הקובץ אינו תוכנת Windows (EXE) תקינה";
  const peOffset = bytes[0x3c]! | (bytes[0x3d]! << 8) | (bytes[0x3e]! << 16) | (bytes[0x3f]! << 24);
  if (peOffset < 0x40 || peOffset + 4 > bytes.length) return "הקובץ אינו תוכנת Windows (EXE) תקינה";
  const pe = [0x50, 0x45, 0x00, 0x00];
  return pe.every((b, i) => bytes[peOffset + i] === b)
    ? null
    : "הקובץ אינו תוכנת Windows (EXE) תקינה";
}

/** שם קובץ בטוח לתצוגה ולהורדה (בלי נתיב / תווי בקרה / מרכאות), עם הסיומת הנכונה */
export function cleanFileName(name: string, kind: LicenseFileKind): string {
  const base = (name.split(/[\\/]/).pop() ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>"*?|:]/g, "")
    .trim();
  const ext = extensionFor(kind);
  const stem =
    base.replace(/\.[^.]*$/, "").slice(0, 110) || (kind === "installer" ? "installer" : kind);
  return `${stem}.${ext}`;
}
export function fileExtensionProblem(name: string, kind: LicenseFileKind): string | null {
  const ext = name.toLowerCase().split(".").pop();
  if (ext !== extensionFor(kind)) {
    return kind === "installer" ? "תוכנת ההתקנה חייבת להיות קובץ ‎.exe" : "הקובץ חייב להיות PDF";
  }
  return null;
}
export function fileSizeProblem(size: number, kind: LicenseFileKind): string | null {
  if (!Number.isFinite(size) || size <= 0) return "הקובץ ריק";
  if (size > maxBytesFor(kind)) {
    return `הקובץ גדול מדי (עד ${Math.round(maxBytesFor(kind) / 1024 / 1024)}MB)`;
  }
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
export function formatDateTimeHe(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
