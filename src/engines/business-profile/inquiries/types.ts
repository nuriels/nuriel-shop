// הטיפוסים של הפניות שעוברים בין השרת לממשק (בלי קוד שרת) — כמו שהמסד מחזיר (מיגרציה 196)
import type { InquiryKind, InquiryStatus, NotifyStatus } from "./logic";

export interface SubmitResult {
  id: string;
  reference: string;
  duplicate: boolean;
  notify: boolean;
  test: boolean;
}

export interface InquiryRow {
  id: string;
  reference: string;
  created_at: string;
  kind: InquiryKind;
  form_title: string | null;
  page_path: string | null;
  full_name: string;
  phone: string | null;
  email: string | null;
  /** ברשימה — 160 התווים הראשונים; בפרטים — ההודעה המלאה */
  message: string | null;
  status: InquiryStatus;
  status_changed_at: string | null;
  is_test: boolean;
  notify_status: NotifyStatus;
  notify_attempts: number;
  notify_error: string | null;
  notify_sent_at: string | null;
  notify_next_at: string | null;
  notes_count: number;
}

export interface InquiryNote {
  id: string;
  body: string;
  created_at: string;
  mine: boolean;
  author: string | null;
}

export interface InquiryHistoryEntry {
  action: string;
  at: string;
  from: string | null;
  to: string | null;
  by: string | null;
}

export interface InquiryDetail extends InquiryRow {
  notes: InquiryNote[];
  history: InquiryHistoryEntry[];
}

export interface InquiryList {
  items: InquiryRow[];
  counts: {
    all: number;
    new: number;
    in_progress: number;
    done: number;
    test: number;
    notify_failed: number;
  };
  settings: { notify_email: string | null; notify_enabled: boolean; retention_days: number };
  /** למה אין התראות במייל (NULL — יש) */
  notify_block: string | null;
}

export interface InquirySettings {
  notify_email: string | null;
  notify_enabled: boolean;
  retention_days: number;
  updated_at: string | null;
  /** המייל של החשבון המחובר — הצעה למילוי */
  account_email?: string | null;
}
