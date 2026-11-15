// הטיפוסים שעוברים בין השרת לממשק (בלי קוד שרת)
import type { SiteDocument } from "./document/schema";

/** כתובות התמונות של המסמך: מזהה מדיה → כתובת + מידות (Stage 2 — ספריית המדיה) */
export type MediaMap = Record<string, { url: string; width: number | null; height: number | null }>;

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
