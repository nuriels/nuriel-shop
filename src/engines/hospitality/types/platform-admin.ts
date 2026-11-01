// "ניהול Hospitality" בפאנל הפלטפורמה (P1) — מה שהמסך מקבל מהשרת (מיגרציה 15)
export interface PlanOption {
  code: string;
  name: string;
  max_units: number | null;
  trial_days: number;
}

export interface PlatformFlags {
  backend: boolean;
  management: boolean;
  booking: boolean;
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
  site_flags: { backend: boolean; management: boolean; booking: boolean };
  /** נוסף בשרת: כתובת האתר ואזור הניהול (null — הדומיין לא הוגדר) */
  url: string | null;
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

export type SiteFlagKey = "backend" | "management";
