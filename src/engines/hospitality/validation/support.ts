// מערכת התמיכה (שלב E4) — בדיקת הקלט של פונקציות השרת, משותפת לדפדפן ולשרת. המסד נשאר הסמכות
// הסופית (הרשאה, בידוד בין עסקים, מגבלות). הקבצים: סוג לפי התוכן עצמו (לא לפי הסיומת או מה שהדפדפן
// הצהיר), עד 5MB, עד 5 להודעה; PDF עם תוכן פעיל (JavaScript / הפעלת תוכנה) נדחה.
import type { SupportPriority, SupportStatus, SupportTopic } from "../types/support";
import { InputError, isoDate, oneOf, uuid } from "./input";

export const SUPPORT_TOPICS = [
  "bookings",
  "payments",
  "website",
  "calendar",
  "account",
  "technical",
  "other",
] as const satisfies readonly SupportTopic[];
export const SUPPORT_PRIORITIES = [
  "low",
  "normal",
  "high",
  "urgent",
] as const satisfies readonly SupportPriority[];
export const SUPPORT_STATUSES = [
  "new",
  "in_progress",
  "waiting_customer",
  "resolved",
  "closed",
] as const satisfies readonly SupportStatus[];

export const SUPPORT_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type SupportMime = (typeof SUPPORT_MIME)[number];
export const SUPPORT_MAX_BYTES = 5 * 1024 * 1024;
export const SUPPORT_MAX_FILES = 5;
/** לשדה הקובץ בדפדפן (סינון ראשוני בלבד — השרת בודק את התוכן) */
export const SUPPORT_ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf";
const EXT = /\.(jpe?g|png|webp|pdf)$/i;

const startsWith = (b: Uint8Array, sig: number[], at = 0) =>
  b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);

/** סוג הקובץ לפי הבייטים הראשונים (JPEG / PNG / WebP / PDF); אחר — null */
export function sniffSupportFile(bytes: Uint8Array): SupportMime | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return "image/webp";
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
  return null;
}

/** PDF עם JavaScript או פעולת "הפעלה" (Launch) — לא מקבלים */
export function pdfHasActiveContent(bytes: Uint8Array): boolean {
  let s = "";
  // latin1 — מספיק לחיפוש שמות האובייקטים של PDF
  for (let i = 0; i < bytes.length; i += 65536)
    s += String.fromCharCode(...bytes.subarray(i, Math.min(i + 65536, bytes.length)));
  return /\/(JavaScript|JS|Launch)(?![A-Za-z0-9])/.test(s);
}

/** בדיקה מוקדמת בדפדפן (לפני השליחה): כמות, גודל, סיומת. הודעה למשתמש, או null */
export function checkSupportFiles(files: readonly { name: string; size: number }[]): string | null {
  if (files.length > SUPPORT_MAX_FILES) return `אפשר לצרף עד ${SUPPORT_MAX_FILES} קבצים להודעה`;
  for (const f of files) {
    if (!EXT.test(f.name)) return `הקובץ "${f.name}" לא נתמך — תמונה (JPG / PNG / WebP) או PDF`;
    if (f.size === 0) return `הקובץ "${f.name}" ריק`;
    if (f.size > SUPPORT_MAX_BYTES) return `הקובץ "${f.name}" גדול מדי (עד 5MB)`;
  }
  return null;
}

type Raw = Record<string, unknown> | null | undefined;

function subject(value: unknown): string {
  const s = String(value ?? "").trim();
  if (s.length < 3 || s.length > 120) throw new InputError("נושא הפנייה: 3 עד 120 תווים");
  return s;
}

function body(value: unknown): string {
  const s = String(value ?? "").trim();
  if (s.length < 1) throw new InputError("כתבו הודעה");
  if (s.length > 5000) throw new InputError("ההודעה ארוכה מדי (עד 5,000 תווים)");
  return s;
}

function formOf(data: unknown): FormData {
  if (!(data instanceof FormData)) throw new InputError("בקשה לא תקינה");
  return data;
}

function str(data: FormData, key: string): string | undefined {
  const v = data.get(key);
  return typeof v === "string" ? v : undefined;
}

function formFiles(data: FormData): File[] {
  const files = data.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const problem = checkSupportFiles(files);
  if (problem) throw new InputError(problem);
  return files;
}

export function parseSupportOpenForm(data: unknown) {
  const form = formOf(data);
  return {
    subject: subject(str(form, "subject")),
    topic: oneOf(str(form, "topic"), SUPPORT_TOPICS, "התחום"),
    priority: oneOf(str(form, "priority"), SUPPORT_PRIORITIES, "הדחיפות", "normal"),
    body: body(str(form, "body")),
    files: formFiles(form),
  };
}

export function parseSupportReplyForm(data: unknown) {
  const form = formOf(data);
  return {
    ticketId: uuid(str(form, "ticketId"), "הפנייה"),
    body: body(str(form, "body")),
    files: formFiles(form),
  };
}

/** מענה של צוות הפלטפורמה: לעסק או הערה פנימית, ואפשר גם סטטוס חדש */
export function parseAdminSupportReplyForm(data: unknown) {
  const form = formOf(data);
  const status = str(form, "status");
  return {
    ticketId: uuid(str(form, "ticketId"), "הפנייה"),
    body: body(str(form, "body")),
    internal: str(form, "internal") === "true",
    status: status
      ? oneOf(status, ["in_progress", "waiting_customer", "resolved", "closed"] as const, "הסטטוס")
      : null,
    files: formFiles(form),
  };
}

export function parseSupportTicketId(input: Raw) {
  return { id: uuid((input ?? {})["id"], "הפנייה") };
}

export function parseSupportFileId(input: Raw) {
  return { id: uuid((input ?? {})["id"], "הקובץ") };
}

export function parseSupportSetOpen(input: Raw) {
  const open = (input ?? {})["open"];
  if (typeof open !== "boolean") throw new InputError("בקשה לא תקינה");
  return { id: uuid((input ?? {})["id"], "הפנייה"), open };
}

export const ADMIN_SUPPORT_PAGE = 50;

export function parseAdminSupportFilter(input: Raw) {
  const v = input ?? {};
  const opt = (k: string) => (v[k] === undefined || v[k] === null || v[k] === "" ? null : v[k]);
  const from = opt("from") === null ? null : isoDate(v["from"], "מתאריך");
  const to = opt("to") === null ? null : isoDate(v["to"], "עד תאריך");
  if (from && to && to < from) throw new InputError("טווח תאריכים לא תקין");
  const q = opt("q") === null ? null : String(v["q"]).trim().slice(0, 80) || null;
  const page = opt("page") === null ? 0 : Number(v["page"]);
  if (!Number.isInteger(page) || page < 0 || page > 2000) throw new InputError("עמוד לא תקין");
  return {
    status:
      opt("status") === null
        ? null
        : oneOf(v["status"], ["open", ...SUPPORT_STATUSES] as const, "הסטטוס"),
    priority: opt("priority") === null ? null : oneOf(v["priority"], SUPPORT_PRIORITIES, "הדחיפות"),
    from,
    to,
    q,
    needsReply: v["needsReply"] === true,
    page,
  };
}
export type AdminSupportFilter = ReturnType<typeof parseAdminSupportFilter>;

export function parseAdminSupportStatus(input: Raw) {
  return {
    id: uuid((input ?? {})["id"], "הפנייה"),
    status: oneOf((input ?? {})["status"], SUPPORT_STATUSES, "הסטטוס"),
  };
}

export function parseSupportSettingsInput(input: Raw) {
  const raw = String((input ?? {})["whatsapp"] ?? "").replace(/[\s\-()]/g, "");
  if (raw !== "" && !/^\+?[0-9]{9,15}$/.test(raw)) throw new InputError("מספר WhatsApp לא תקין");
  return { whatsapp: raw || null };
}
