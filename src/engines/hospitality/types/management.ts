// מה שאזור הניהול מקבל מ-hospitality.management_context() (מיגרציה 7)

export type ManagementRole = "owner" | "manager";

/** רשימת ההקמה בלוח הבקרה — חמש אבני הדרך (מיגרציה 35: "site" — האתר מוכן לפרסום) */
export const CHECKLIST_KEYS = ["business", "units", "photos", "prices", "site"] as const;
export type ChecklistKey = (typeof CHECKLIST_KEYS)[number];

/** המנוי — לבעלים במלואו; למנהל רק מה שהמסכים צריכים */
export interface ManagementEntitlements {
  active: boolean;
  max_units: number | null;
  units_used: number;
  plan?: string;
  plan_name?: string;
  status?: "trialing" | "active" | "past_due" | "canceled" | "expired";
  trial_ends_at?: string | null;
  current_period_end?: string | null;
  max_managers?: number | null;
  managers_used?: number;
  // ---- שלב E3 (מיגרציה 30) — לבעלים בלבד ----
  max_properties?: number | null;
  properties_used?: number;
  /** תמונות וסרטונים לגלריה */
  max_media?: number;
  features?: { channels?: boolean; room_types?: boolean; promotions?: boolean };
}

export interface ManagementContext {
  role: ManagementRole;
  permissions: Record<string, boolean>;
  flags: { management: boolean; frontend: boolean; booking: boolean };
  site: { name: string; slug: string; status: "active" | "suspended" };
  business: { name: string; timezone: string; currency: string };
  entitlements: ManagementEntitlements;
  /** policy — עוד מוחזר מהמסד (תאימות לגרסה הקודמת), לא מוצג ברשימה */
  checklist: Record<ChecklistKey, boolean> & { policy?: boolean };
}

/** התשובה לפונקציית השרת: מחובר עם הרשאה / לא מחובר / מחובר בלי הרשאה */
export type ManagementAccess =
  | { state: "ok"; context: ManagementContext }
  | { state: "signed_out" }
  | { state: "forbidden"; message: string };
