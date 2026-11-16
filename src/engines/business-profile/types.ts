// הטיפוסים שעוברים בין השרת לממשק (בלי קוד שרת)
import type { SiteDocument } from "./document/schema";

/** כתובות התמונות של המסמך: מזהה מדיה → כתובת (WebP 1600), srcset (480 / 960 / 1600), AVIF, מידות */
export type MediaMap = Record<
  string,
  {
    url: string;
    width: number | null;
    height: number | null;
    srcset: string | null;
    avif: string | null;
  }
>;

export interface MediaFont {
  family: string;
  weight: string;
  style: "normal" | "italic";
  unicode_range: string;
  license: string;
}

export interface MediaItem {
  id: string;
  /** תמונה או גופן (WOFF2) */
  kind: "image" | "font";
  font: MediaFont | null;
  url: string;
  thumb: string;
  width: number | null;
  height: number | null;
  size_bytes: number;
  alt: { he: string; en?: string | undefined };
  original_name: string | null;
  created_at: string;
}

export interface MediaLibrary {
  items: MediaItem[];
  used_bytes: number;
  quota_bytes: number;
}

export interface PublicSiteData {
  name: string;
  version: number;
  publishedAt: string;
  document: SiteDocument;
  media: MediaMap;
  /** הכתובת הקנונית של האתר (לכתובת קנונית בכל עמוד); null — לא ידועה */
  origin: string | null;
}

export type SiteStatus = "draft" | "pending_review" | "live";

export interface SiteState {
  status: SiteStatus;
  approved: boolean;
  first_approved_at: string | null;
  live_version: number | null;
  live_published_at: string | null;
  public_enabled: boolean;
  pending: { id: string; requested_at: string; revision: number; note: string | null } | null;
  last_rejection: { at: string; note: string } | null;
}

export interface TemplateOption {
  key: string;
  label_he: string;
  label_en: string;
  status: "available" | "planned";
}

export interface StudioContext {
  site: { id: string; slug: string; name: string; status: "active" | "suspended" };
  permissions: string[];
  platform_admin: boolean;
  state: SiteState;
  templates: TemplateOption[];
}

export interface DraftData {
  document: SiteDocument;
  revision: number;
  updatedAt: string;
}

export interface VersionRow {
  id: string;
  state: "pending" | "published" | "rejected";
  version: number | null;
  template: string;
  note: string | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  live: boolean;
}

export interface PlatformSiteRow {
  id: string;
  slug: string;
  name: string;
  status: "active" | "suspended";
  owner_email: string | null;
  has_owner: boolean;
  created_at: string;
  template: string | null;
  state: SiteState;
  /** הכתובת בפלטפורמה (<slug>.<הדומיין>) */
  url: string | null;
}

/** כתובת האתר (מיגרציה 197): תת-הדומיין, כתובות ישנות שמפנות, והדומיין האישי — כפי שהמסד מחזיר */
export interface AddressRow {
  slug: string;
  old_slugs: { name: string; expires_at: string | null }[];
  changes_30d: number;
  custom_domain: string | null;
  custom_domain_status: "pending" | "verified" | "active" | "error" | null;
  custom_domain_error: string | null;
  custom_domain_verified_at: string | null;
  custom_domain_checked_at: string | null;
  custom_domain_ssl_expires_at: string | null;
  alternate: string | null;
  verify_token: string | null;
  ownership_domain: string | null;
  ownership_verified_at: string | null;
  alternate_redirect: boolean;
  last_check: {
    txt: boolean;
    dns: boolean;
    alternate: string | null;
    alternate_ok: boolean;
    message: string;
    at: string;
  } | null;
}

/** רשומת DNS להצגה בהוראות (אצל רשם הדומיין) */
export interface DnsRecordHint {
  type: "TXT" | "CNAME" | "A";
  /** השם המלא */
  name: string;
  /** מה כותבים בשדה "שם / Host" אצל הרשם */
  host: string;
  value: string;
  purpose: string;
}

/** המצב של מסך "כתובת האתר" */
export interface AddressState extends AddressRow {
  baseDomain: string | null;
  /** הכתובת הציבורית (הקנונית) של האתר */
  publicOrigin: string | null;
  /** הכתובת בפלטפורמה (תמיד קיימת; הניהול תמיד בה) */
  slugOrigin: string | null;
  /** הצורה השנייה של הדומיין (www / בלי www), אם רלוונטי */
  alternateHost: string | null;
  /** ההוראות לרשם הדומיין — רק כשיש דומיין אישי */
  records: DnsRecordHint[];
}

export interface DomainCheckResult {
  ok: boolean;
  txtOk: boolean;
  dnsOk: boolean;
  alternateOk: boolean | null;
  message: string;
  state: AddressState;
}

/** תיק האתר בפאנל הפלטפורמה (platform_bp_site_file + הכתובות) */
export interface PlatformSiteFile {
  id: string;
  slug: string;
  name: string;
  status: "active" | "suspended";
  created_at: string;
  owner_email: string | null;
  owner: { email: string; since: string } | null;
  address: AddressRow;
  state: SiteState;
  draft: {
    template: string;
    revision: number;
    updated_at: string;
    updated_by: string | null;
  } | null;
  media: { count: number; bytes: number };
  audit: {
    source: "site" | "platform";
    action: string;
    /** פרטי הפעולה כטקסט (בלי תוכן אישי — כך הם נרשמים) */
    details: Record<string, string>;
    at: string;
    actor: string | null;
    platform_admin: boolean;
  }[];
  publicOrigin: string | null;
  slugOrigin: string | null;
}

// ---------- מיגרציה 198: הזמנת בעלת האתר ----------
export type InviteStatus = "valid" | "invalid" | "expired" | "used" | "revoked" | "owner_exists";

export interface OwnerInviteState {
  has_owner: boolean;
  owner_email: string | null;
  owner_email_verified_at: string | null;
  owner_via_invite: boolean;
  open: {
    id: string;
    created_at: string;
    expires_at: string;
    expired: boolean;
    created_by: string | null;
  } | null;
  history: {
    id: string;
    created_at: string;
    expires_at: string;
    status: InviteStatus;
    revoked_at: string | null;
    revoke_reason: "revoked" | "replaced" | null;
    used_at: string | null;
    used_email: string | null;
    email_verified_at: string | null;
  }[];
  /** שירות המיילים מוגדר בשרת — בלעדיו אימות המייל מחכה */
  emailConfigured: boolean;
}

export interface CreatedInvite {
  /** מוצג פעם אחת בלבד — במסד נשמר רק ה-hash */
  url: string;
  expiresAt: string;
}

export interface InviteCheck {
  status: InviteStatus;
  siteName: string | null;
  expiresAt: string | null;
}

export interface InviteRedeemed {
  /** קוד הכניסה החד-פעמי לממשק הניהול (/admin-handoff) */
  handoffCode: string;
  email: string;
  verification: "sent" | "not_configured" | "failed";
}

export interface OwnerEmailStatus {
  needed: boolean;
  email: string | null;
  verifiedAt: string | null;
  emailConfigured: boolean;
}
