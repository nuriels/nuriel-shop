// מסמכי האתר, הצהרת הנגישות והסדרי הנגישות במתחם (מיגרציה 60) — מה שהמסד מחזיר
import type { AccessibilityItems, DocKind } from "../documents/kinds";
import type { PublicPolicy } from "./website";

/** מסמך שמוצג באתר (לפוטר ולטופס ההזמנה) */
export interface PublicDocumentMeta {
  kind: DocKind;
  title: string;
  version: number;
  published_at: string;
}
export interface PublicDocument extends PublicDocumentMeta {
  body: string;
}

export interface LegalProfile {
  legal_name: string | null;
  registration_id: string | null;
  legal_address: string | null;
  a11y_contact_name: string | null;
  a11y_contact_phone: string | null;
  a11y_contact_email: string | null;
  coordinator_required: boolean;
  coordinator_name: string | null;
  coordinator_phone: string | null;
  coordinator_email: string | null;
  revision: number;
}

export interface PropertyAccessibility {
  items: AccessibilityItems;
  additional: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  confirmed_at: string;
  revision?: number;
}

export interface DocProperty {
  id: string;
  name: string;
  address: string | null;
  rules: {
    smoking: string | null;
    pets: string | null;
    pets_note: string | null;
    events: string | null;
    quiet_from: string | null;
    quiet_to: string | null;
    /** כללים נוספים (רשימה) */
    custom: string[] | null;
  };
  accessibility: PropertyAccessibility | null;
}

export interface DocDraft {
  kind: DocKind;
  draft_title: string;
  draft_body: string;
  revision: number;
  updated_at: string;
  published_version: number | null;
}

export interface DocVersion {
  kind: DocKind;
  version: number;
  title: string;
  /** רק בגרסה האחרונה של כל מסמך */
  body: string | null;
  body_hash: string;
  published_at: string;
  review_kind: "lawyer" | "accessibility" | null;
  reviewed_by: string | null;
  reviewed_on: string | null;
  acceptances: number;
}

export interface DocumentsView {
  business: {
    name: string;
    phone: string | null;
    email: string | null;
    whatsapp: string | null;
    address: string | null;
    check_in_time: string | null;
    check_out_time: string | null;
    currency: string;
    slug: string;
  } | null;
  profile: LegalProfile | null;
  payments: { bank: boolean; bit: boolean; phone: boolean } | null;
  policy: PublicPolicy | null;
  properties: DocProperty[];
  documents: DocDraft[];
  versions: DocVersion[];
}

/** מה שהאורח אישר בהזמנה (לעמוד ההזמנה בניהול) */
export interface BookingDocument {
  kind: DocKind;
  title: string;
  version: number;
  accepted_at: string;
  body_hash: string;
  sale_type: "distance";
  service: "accommodation" | "event";
}
