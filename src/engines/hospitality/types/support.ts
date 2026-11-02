// מערכת התמיכה של עסקי האירוח (שלב E4) — הצורות שהמסד מחזיר (מיגרציה 33).

export type SupportTopic =
  "bookings" | "payments" | "website" | "calendar" | "account" | "technical" | "other";
export type SupportPriority = "low" | "normal" | "high" | "urgent";
export type SupportStatus = "new" | "in_progress" | "waiting_customer" | "resolved" | "closed";
/** רמת התמיכה לפי החבילה */
export type SupportPlan = "basic" | "trial" | "premium";
export type SupportSender = "business" | "platform";

export interface SupportTicketRow {
  id: string;
  number: number;
  subject: string;
  topic: SupportTopic;
  priority: SupportPriority;
  status: SupportStatus;
  opened_by_name: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  last_public_sender: SupportSender | null;
  first_response_at: string | null;
  /** ממתינה למענה של צוות הפלטפורמה */
  needs_reply: boolean;
  /** הודעות של הצד השני שעוד לא נקראו */
  unread: number;
  preview: string | null;
}

export interface SupportFile {
  id: string;
  name: string;
  mime: string;
  size: number;
}

export interface SupportMessage {
  id: string;
  sender_type: SupportSender;
  /** לעסק: "צוות התמיכה" במקום השם של איש הצוות */
  sender_name: string | null;
  mine: boolean;
  body: string;
  /** הערה פנימית — רק בצד הפלטפורמה */
  internal: boolean;
  created_at: string;
  files: SupportFile[];
}

export interface SupportList {
  plan: SupportPlan;
  /** WhatsApp לתמיכה — רק בחבילת פרימיום */
  whatsapp: string | null;
  counts: { open: number; waiting_customer: number; done: number; all: number };
  items: SupportTicketRow[];
}

export interface SupportTicket extends SupportTicketRow {
  plan: SupportPlan;
  messages: SupportMessage[];
}

export interface SupportBusinessBrief {
  id: string;
  name: string;
  slug: string;
  domain: string | null;
  plan: SupportPlan;
}

export interface SupportBusinessFull extends SupportBusinessBrief {
  plan_code: string | null;
  subscription_status: string | null;
  owner_email: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  units: number;
  tickets: number;
  created_at: string | null;
}

export interface AdminSupportRow extends SupportTicketRow {
  business: SupportBusinessBrief;
  opened_by_email: string | null;
}

export interface AdminSupportCounts {
  new: number;
  in_progress: number;
  waiting_customer: number;
  resolved: number;
  closed: number;
  needs_reply: number;
  urgent_open: number;
}

export interface AdminSupportList {
  counts: AdminSupportCounts;
  total: number;
  items: AdminSupportRow[];
}

export interface AdminSupportTicket extends SupportTicketRow {
  business: SupportBusinessFull;
  opened_by_email: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  messages: SupportMessage[];
}

/** תוצאת שליחה (פנייה חדשה / תגובה): קבצים שלא עלו — לפי השם */
export interface SupportSendResult {
  ticketId: string;
  status: SupportStatus;
  failedFiles: string[];
}

export interface SupportSettings {
  whatsapp: string | null;
  updated_at: string | null;
}
