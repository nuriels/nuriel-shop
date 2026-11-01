// "ניהול Hospitality" בפאנל הפלטפורמה (P1) — מה שהמסך מקבל מהשרת (מיגרציה 15)
/** מה פתוח בחבילה (שלב E3) */
export interface PlanFeatures {
  /** סנכרון יומנים עם Airbnb / Booking.com (ייבוא + קישור ייצוא) */
  channels?: boolean;
  /** סוגי חדרים (מצב מלון) */
  room_types?: boolean;
  /** קופונים ומבצעים */
  promotions?: boolean;
}

export interface PlanOption {
  code: string;
  name: string;
  max_units: number | null;
  trial_days: number;
  // ---- שלב E3 (מיגרציה 30): מחירים, פירוט והגבלות — חסרים במסד ישן ----
  tagline?: string;
  price_monthly?: number | null;
  setup_fee?: number | null;
  currency?: string;
  max_properties?: number | null;
  /** תמונות וסרטונים לגלריה (עד 60) */
  max_media?: number;
  /** מנהלים כולל הבעלים; null = ללא הגבלה */
  max_managers?: number | null;
  features?: PlanFeatures;
  highlights?: string[];
  is_published?: boolean;
  sort_order?: number;
}

/** עריכת חבילה מהפאנל (admin_save_plan) */
export interface SavePlanInput {
  code: string;
  name: string;
  tagline: string;
  price_monthly: number | null;
  setup_fee: number | null;
  max_units: number | null;
  max_properties: number | null;
  max_media: number | null;
  max_managers: number | null;
  features: Required<PlanFeatures>;
  highlights: string[];
  is_published: boolean;
}

export interface PlatformFlags {
  backend: boolean;
  management: boolean;
  booking: boolean;
  /** האתרים הציבוריים (Stage 4) */
  frontend: boolean;
  plans: PlanOption[];
}

export interface HospitalitySiteRow {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  status: "active" | "suspended";
  created_at: string;
  plan: string;
  plan_name: string | null;
  subscription_status: string;
  subscription_active: boolean;
  trial_ends_at: string | null;
  units_active: number;
  units_limit: number | null;
  extra_units: number;
  properties: number;
  bookings_pending: number;
  bookings_upcoming: number;
  owner_email: string | null;
  managers: number;
  backend_enabled: boolean;
  management_enabled: boolean;
  booking_enabled: boolean;
  /** האתר הציבורי פתוח בפועל (פלטפורמה + אתר) */
  frontend_enabled: boolean;
  site_flags: { backend: boolean; management: boolean; booking: boolean; frontend: boolean };
  /** נוסף בשרת: כתובת האתר, האתר הציבורי ואזור הניהול (null — הדומיין לא הוגדר) */
  url: string | null;
  site_url: string | null;
  manage_url: string | null;
}

export interface PlatformHospitalityView {
  flags: PlatformFlags;
  sites: HospitalitySiteRow[];
  base_domain: string | null;
}

export interface OpenSiteResult {
  id: string;
  slug: string;
  name: string;
  manage_url: string | null;
  owner: OwnerResult;
}

export type OwnerResult =
  | { status: "added" | "already_owner"; account_created: boolean }
  | { status: "failed"; message: string };

export type SiteFlagKey = "backend" | "management" | "frontend" | "booking";

/** שלב E2: בקשה לאתר צימר מהשער (admin_site_requests) */
export interface SiteRequest {
  id: string;
  email: string;
  business_name: string;
  phone: string;
  units: number | null;
  plan_code: string | null;
  plan_name: string | null;
  area: string | null;
  message: string | null;
  status: "new" | "handled";
  admin_note: string | null;
  handled_at: string | null;
  created_at: string;
}
