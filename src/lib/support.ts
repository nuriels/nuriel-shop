/**
 * מערכת התמיכה (חלק 13) — טיפוסים, פענוח התשובות מהמסד ועזרי תצוגה.
 * משותף למנהל החנות (לשונית "תמיכה ועזרה") ולמנהל הפלטפורמה (/platform/support).
 */

import { asPlan, type PlanType } from "@/lib/subscription";

export type TicketStatus = "open" | "answered" | "closed";
export type SenderType = "tenant" | "admin";

export const SUPPORT_HOURS_TEXT = "זמני פעילות: 07:00 עד 22:00 | התחייבות למענה תוך 3 שעות";

export const SUBJECT_MIN = 2;
export const SUBJECT_MAX = 120;
export const MESSAGE_MAX = 4000;

/** ההודעה למנהל החנות: open = ממתין לנו; answered = ענינו */
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "ממתין למענה",
  answered: "נענה",
  closed: "סגור",
};

/** בפאנל הפלטפורמה — מנקודת המבט שלנו */
export const PLATFORM_TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "ממתין לנו",
  answered: "ממתין ללקוח",
  closed: "סגור",
};

export type SupportTicket = {
  id: string;
  tenantId: string;
  storeName: string;
  storeSlug: string;
  plan: PlanType;
  subject: string;
  status: TicketStatus;
  openedByEmail: string | null;
  createdAt: string;
  lastMessageAt: string;
  lastSenderType: SenderType | null;
  /** הודעות של הצד השני שלא נקראו */
  unread: number;
  preview: string;
};

export type SupportMessage = {
  id: string;
  ticketId: string;
  senderType: SenderType;
  senderName: string;
  message: string;
  createdAt: string;
};

export type SupportThread = {
  ticket: SupportTicket;
  /** הצד של הקורא — ההודעות שלו מוצגות בצד "שלי" */
  side: SenderType;
  messages: SupportMessage[];
};

type Raw = Record<string, unknown>;
const obj = (value: unknown): Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Raw) : {};
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const strOrNull = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

function asStatus(value: unknown): TicketStatus {
  return value === "answered" || value === "closed" ? value : "open";
}

function asSender(value: unknown): SenderType | null {
  return value === "tenant" || value === "admin" ? value : null;
}

export function parseTicket(raw: unknown): SupportTicket {
  const row = obj(raw);
  return {
    id: str(row["id"]),
    tenantId: str(row["tenant_id"]),
    storeName: str(row["store_name"]) || str(row["store_slug"]),
    storeSlug: str(row["store_slug"]),
    plan: asPlan(row["plan"]),
    subject: str(row["subject"]),
    status: asStatus(row["status"]),
    openedByEmail: strOrNull(row["opened_by_email"]),
    createdAt: str(row["created_at"]),
    lastMessageAt: str(row["last_message_at"]),
    lastSenderType: asSender(row["last_sender_type"]),
    unread: Number(row["unread"] ?? 0) || 0,
    preview: str(row["preview"]),
  };
}

export function parseTickets(raw: unknown): SupportTicket[] {
  return Array.isArray(raw) ? raw.map(parseTicket) : [];
}

export function parseMessage(raw: unknown): SupportMessage {
  const row = obj(raw);
  return {
    id: str(row["id"]),
    ticketId: str(row["ticket_id"]),
    senderType: asSender(row["sender_type"]) ?? "tenant",
    senderName: str(row["sender_name"]),
    message: str(row["message"]),
    createdAt: str(row["created_at"]),
  };
}

export function parseThread(raw: unknown): SupportThread {
  const root = obj(raw);
  return {
    ticket: parseTicket(root["ticket"]),
    side: asSender(root["side"]) ?? "tenant",
    messages: Array.isArray(root["messages"]) ? root["messages"].map(parseMessage) : [],
  };
}

/** VIP = חבילת פרימיום / ניסיון (צ'אט תמיכה VIP כלול בפרימיום) */
export function isVip(plan: PlanType): boolean {
  return plan !== "basic";
}

/** "14:32" היום / "אתמול 09:10" / "3.10 · 18:05" — שעה בבועת צ'אט */
export function chatTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jerusalem",
  });
  const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  if (dayKey(date) === dayKey(now)) return time;
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (dayKey(date) === dayKey(yesterday)) return `אתמול ${time}`;
  const [, month, day] = dayKey(date).split("-");
  return `${Number(day)}.${Number(month)} · ${time}`;
}

/** כותרת יום מעל קבוצת הודעות: "היום" / "אתמול" / "יום ג׳, 3 באוקטובר" */
export function chatDayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
  if (dayKey(date) === dayKey(now)) return "היום";
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (dayKey(date) === dayKey(yesterday)) return "אתמול";
  return date.toLocaleDateString("he-IL", {
    weekday: "short",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Jerusalem",
  });
}

/** מפתח יום (לקיבוץ הודעות לפי יום, שעון ישראל) */
export function chatDayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}
