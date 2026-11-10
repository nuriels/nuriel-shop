// מסמכי לקוחות — חוזים לחתימה אלקטרונית (מיגרציה 64) ומסמכים עצמאיים (20261111140000): מה שהמסד מחזיר
// לצוות, ללקוח ולאזור האישי
import type { DocKind } from "../documents/kinds";
import type { Json } from "./domain";
import type { BusinessTerms } from "./events";

/** policy — מסמך מדיניות של העסק (אחד ממסמכי האתר שפורסמו), עצמאי בלבד */
export type ContractKind = "hosting" | "pool_event" | "policy";
/** linked — מתוך הזמנה / אירוע; standalone — מסמך עצמאי מ"מסמכי לקוחות" */
export type ContractOrigin = "linked" | "standalone";
/** business — העסק ממלא ושולח במייל (א'); customer — הלקוח ממלא את פרטיו וחותם בקישור (ב') */
export type ContractFillMode = "business" | "customer";
/** מסמכי האתר שאפשר לשלוח לחתימה (לא הצהרת הנגישות — היא לא הסכם) */
export type PolicyDocKind = Exclude<DocKind, "accessibility">;
/** expired — נשלח / נצפה, והקישור פג תוקף */
export type ContractStatus =
  "draft" | "sent" | "viewed" | "signed" | "superseded" | "cancelled" | "expired";
export type DepositMethod = "cash" | "check" | "card";

export const CONTRACT_KIND_LABEL: Record<ContractKind, string> = {
  hosting: "חוזה אירוח (הזמנת לינה)",
  pool_event: "חוזה מתחם הבריכה לאירועים",
  policy: "מסמך מדיניות / תנאים",
};
/** שם קצר לסוג — במסמך עצמאי (בלי הזמנה) */
export const STANDALONE_KIND_LABEL: Record<ContractKind, string> = {
  hosting: "חוזה אירוח לטווח קצר",
  pool_event: "חוזה אירוע (מתחם הבריכה)",
  policy: "מסמך מדיניות ותנאים של העסק",
};
export const ORIGIN_LABEL: Record<ContractOrigin, string> = {
  linked: "מתוך הזמנה / אירוע",
  standalone: "מסמך עצמאי",
};
export const FILL_MODE_LABEL: Record<ContractFillMode, string> = {
  business: "העסק מילא — נשלח במייל",
  customer: "הלקוח ממלא בקישור",
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
  /** בחוזה — שם התבנית; במסמך מדיניות — שם המסמך שפורסם ("כללי המקום") */
  title: string;
  origin: ContractOrigin;
  fill_mode: ContractFillMode;
  /** מסמך מדיניות: איזה מסמך אתר ובאיזו גרסה, וטביעת ה-SHA-256 של הגרסה שפורסמה */
  document_kind: PolicyDocKind | null;
  document_version: string | null;
  document_hash: string | null;
  booking_id: string | null;
  event_id: string | null;
  guest_id: string | null;
  /** null — מסמך מדיניות (אין לו הזמנה או אירוע) */
  booking_type: "hosting" | "event" | null;
  link_number: string | null;
  event_type: string | null;
  event_purpose: string | null;
  service_date: string | null;
  service_end: string | null;
  /** null — בדרך ב', עד שהלקוח כותב את פרטיו בחתימה */
  signer_name: string | null;
  signer_email: string | null;
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
  /** נחתם, ואף אחד מהצוות עוד לא פתח את "מסמכים חתומים" מאז */
  unseen: boolean;
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
    /** דרך ב': מה שהלקוח כתב בחתימה */
    full_name?: string;
    email?: string;
    phone?: string;
  } | null;
  signature_kind: "drawn" | "typed" | null;
  signer_ip: string | null;
  log: ContractLogEntry[];
}

export interface ContractsView {
  enabled: boolean;
  terms: BusinessTerms;
  templates: { kind: ContractKind; version: number; title: string; body_hash: string }[];
  counts: {
    all: number;
    signed: number;
    waiting: number;
    draft: number;
    standalone: number;
    unseen: number;
  };
  can_confirm_terms: boolean;
  /** מסמכי האתר שפורסמו — אפשר לשלוח אותם לחתימה כמסמך מדיניות */
  documents: { kind: PolicyDocKind; title: string; version: number; published_at: string }[];
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
  origin: ContractOrigin;
  fill_mode: ContractFillMode;
  business_name: string;
  business_phone: string | null;
  business_email: string | null;
  signer_name: string | null;
  signer_phone: string | null;
  signer_email: string | null;
  body: string;
  needs_deposit_method: boolean;
  /** דרך ב': הלקוח כותב שם מלא, אימייל (חובה) וטלפון */
  needs_identity: boolean;
  /** חוזה (לא מסמך מדיניות): ת"ז / ח.פ וכתובת מגורים */
  needs_id_address: boolean;
  /** הודעת שעות הבריכה (מחוץ לנוסח) */
  pool: ContractPool;
  id_label: string;
  expires_at: string;
}

export interface ContractSigned {
  number: number;
  kind: ContractKind;
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

/** מסמך עצמאי: מה שהצוות ממלא לכל סוג (המסד בודק הכול שוב) */
export interface StandaloneHostingInput {
  check_in: string;
  check_out: string;
  /** שמות היחידות מתוך "תנאים ופרטי החוזה" (או whole — כל המתחם) */
  units?: string[];
  whole?: boolean;
  price: number;
  event_fee?: number | null;
  deposit_method?: DepositMethod | null;
}
export interface StandaloneEventInput {
  event_date: string;
  start_time: string;
  end_time: string;
  event_type: string;
  event_type_other?: string | null;
  participants: number;
  price: number;
  deposit_amount?: number | null;
  late_fee?: number | null;
  /** שניהם, או אף אחד (כל החלון המותר); null + null — בלי שימוש בבריכה */
  pool_start_time?: string | null;
  pool_end_time?: string | null;
}
export interface StandalonePolicyInput {
  document_kind: PolicyDocKind;
}
export type StandaloneInput = StandaloneHostingInput | StandaloneEventInput | StandalonePolicyInput;

export interface StandaloneTarget {
  kind: ContractKind;
  fillMode: ContractFillMode;
  guestId: string | null;
  signer: { full_name?: string; email?: string; phone?: string } | null;
  input: StandaloneInput;
}

export interface StandalonePreview {
  kind: ContractKind;
  fill_mode: ContractFillMode;
  origin: "standalone";
  template_version: number;
  title: string;
  signer: {
    guest_id: string | null;
    full_name: string | null;
    email: string | null;
    phone: string | null;
  };
  data: { [key: string]: Json };
  body: string;
  can_send: boolean;
  legal_pending: boolean;
  terms_confirmed: boolean;
}

/** יצירת מסמך עצמאי: א' — נשלח במייל; ב' — קישור להעתקה (מוצג לצוות פעם אחת, לא נשמר) */
export interface StandaloneResult {
  contract: ContractRow;
  delivery: "email" | "link";
  sent: boolean;
  error: string | null;
  /** דרך ב' בלבד: הקישור לחתימה — להעביר ללקוח (וואטסאפ / הודעה); לא נשמר במערכת */
  link: { url: string; expires_at: string } | null;
}

export interface SignedDocumentList {
  rows: ContractRow[];
  total: number;
  unseen: number;
}
