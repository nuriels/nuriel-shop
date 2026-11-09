// מסמכי לקוחות — חוזים לחתימה אלקטרונית (מיגרציה 64): מה שהמסד מחזיר לצוות, ללקוח ולאזור האישי
import type { Json } from "./domain";
import type { BusinessTerms } from "./events";

export type ContractKind = "hosting" | "pool_event";
/** expired — נשלח / נצפה, והקישור פג תוקף */
export type ContractStatus =
  "draft" | "sent" | "viewed" | "signed" | "superseded" | "cancelled" | "expired";
export type DepositMethod = "cash" | "check" | "card";

export const CONTRACT_KIND_LABEL: Record<ContractKind, string> = {
  hosting: "חוזה אירוח (הזמנת לינה)",
  pool_event: "חוזה מתחם הבריכה לאירועים",
};
export const BOOKING_TYPE_LABEL: Record<"hosting" | "event", string> = {
  hosting: "אירוח",
  event: "אירוע",
};
export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  draft: "טיוטה — לא נשלח",
  sent: "נשלח — ממתין לחתימה",
  viewed: "נפתח — ממתין לחתימה",
  signed: "נחתם",
  superseded: "הוחלף בחוזה מתוקן",
  cancelled: "בוטל",
  expired: "הקישור פג תוקף",
};
export const DEPOSIT_METHOD_LABEL: Record<DepositMethod, string> = {
  cash: "מזומן",
  check: "צ'ק ביטחון",
  card: "כרטיס אשראי (תפיסת מסגרת)",
};

/** שעות הבריכה כפי שנשלחו (הצילום של החוזה); באירוע — גם השימוש בבריכה בו */
export interface ContractPool {
  open: string | null;
  close: string | null;
  event_start: string | null;
  event_end: string | null;
  /** השימוש בבריכה באירוע; null = בלי שימוש בבריכה (כש-window_known) */
  start: string | null;
  end: string | null;
  /** חוזה לאירוע שבו נשמר חלון השימוש בבריכה */
  window_known: boolean;
}

/** חוזה פתוח שכבר לא מתאים: 'unavailable' — ההזמנה / האירוע בוטלו; 'changed' — הפרטים השתנו מאז השליחה */
export type ContractStale = "unavailable" | "changed";

export interface ContractRow {
  id: string;
  number: number;
  kind: ContractKind;
  template_version: number;
  title: string;
  booking_id: string | null;
  event_id: string | null;
  guest_id: string | null;
  booking_type: "hosting" | "event";
  link_number: string | null;
  event_type: string | null;
  event_purpose: string | null;
  service_date: string | null;
  service_end: string | null;
  signer_name: string;
  signer_email: string;
  signer_phone: string | null;
  status: ContractStatus;
  stored_status: Exclude<ContractStatus, "expired">;
  sent_at: string | null;
  last_sent_at: string | null;
  send_count: number;
  send_error: string | null;
  viewed_at: string | null;
  link_expires_at: string | null;
  signed_at: string | null;
  has_pdf: boolean;
  pdf_sha256: string | null;
  signed_body_sha256: string | null;
  copy_sent_at: string | null;
  copy_error: string | null;
  supersedes_id: string | null;
  superseded_by_id: string | null;
  cancel_reason: string | null;
  /** חוזה פתוח שכבר לא מתאים להזמנה / לאירוע — הלקוח לא יוכל לחתום; null — מתאים */
  stale: ContractStale | null;
  pool: ContractPool;
  created_at: string;
}

export interface ContractLogEntry {
  id: number;
  action: string;
  actor_kind: "staff" | "customer" | "system";
  details: { [key: string]: Json };
  at: string;
}

export interface ContractDetail extends ContractRow {
  body: string;
  customer_fields: {
    address?: string;
    deposit_method?: DepositMethod;
    id_number_masked?: string;
  } | null;
  signature_kind: "drawn" | "typed" | null;
  signer_ip: string | null;
  log: ContractLogEntry[];
}

export interface ContractsView {
  enabled: boolean;
  terms: BusinessTerms;
  templates: { kind: ContractKind; version: number; title: string; body_hash: string }[];
  counts: { all: number; signed: number; waiting: number; draft: number };
  can_confirm_terms: boolean;
}

export interface ContractList {
  rows: ContractRow[];
  total: number;
}

export interface ContractPreview {
  kind: ContractKind;
  template_version: number;
  title: string;
  signer: { guest_id: string | null; full_name: string; email: string; phone: string | null };
  data: { [key: string]: Json };
  body: string;
  can_send: boolean;
  legal_pending: boolean;
  terms_confirmed: boolean;
  open_contract: ContractRow | null;
}

/** מה שהשליחה מחזירה לצוות — בלי הקישור עצמו (הוא רק במייל ללקוח) */
export interface ContractSendResult {
  contract: ContractRow;
  sent: boolean;
  error: string | null;
}

/** עמוד החתימה (הלקוח) */
export interface ContractForSigning {
  number: number;
  kind: ContractKind;
  title: string;
  business_name: string;
  business_phone: string | null;
  business_email: string | null;
  signer_name: string;
  signer_phone: string | null;
  signer_email: string;
  body: string;
  needs_deposit_method: boolean;
  /** הודעת שעות הבריכה (מחוץ לנוסח) */
  pool: ContractPool;
  id_label: string;
  expires_at: string;
}

export interface ContractSigned {
  number: number;
  /** העותק החתום (base64) — מיד אחרי החתימה, למי שחתם; null אם הפקת הקובץ נכשלה (יישלח במייל בהמשך) */
  pdf: string | null;
  copy_sent: boolean;
}

export interface GuestDocument {
  id: string;
  number: number;
  kind: ContractKind;
  title: string;
  signed_at: string;
  status: "signed" | "superseded";
  service_date: string | null;
  event_purpose: string | null;
  has_pdf: boolean;
}

export interface ContractTarget {
  kind: ContractKind;
  bookingId: string | null;
  eventId: string | null;
  guestId: string | null;
  signer: { full_name?: string; email?: string; phone?: string } | null;
  options: { deposit_method?: DepositMethod | null; event_fee?: number | null };
}
