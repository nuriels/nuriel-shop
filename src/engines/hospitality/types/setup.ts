// מדריך ההקמה (מיגרציה 35) — מה ש-hospitality.setup_guide() / setup_save() מחזירות

export const SETUP_STEPS = [
  "details",
  "contact",
  "units",
  "photos",
  "prices",
  "booking",
  "policy",
  "payments",
  "template",
  "logo",
  "site",
  "seo",
  "publish",
] as const;
export type SetupStepKey = (typeof SETUP_STEPS)[number];

/** צעדים שמשלימים ב"בדקתי, מתאים לי" (ערכי ברירת המחדל יכולים להתאים) */
export const SETUP_CONFIRMABLE = ["booking", "policy", "payments"] as const;
/** צעדי רשות — אפשר לדלג */
export const SETUP_SKIPPABLE = ["logo", "seo"] as const;

export const SETUP_ACTIONS = ["visit", "confirm", "unconfirm", "skip", "unskip"] as const;
export type SetupAction = (typeof SETUP_ACTIONS)[number];

export interface SetupSteps {
  details: { done: boolean; name: boolean; address: boolean };
  contact: { done: boolean; phone: boolean; email: boolean; whatsapp: boolean };
  units: { done: boolean; total: number; active: number };
  photos: { done: boolean; count: number; units_without: number };
  prices: { done: boolean; priced: number; active: number };
  booking: {
    done: boolean;
    confirmed: boolean;
    mode: "request" | "instant";
    check_in: string;
    check_out: string;
    approval_hours: number;
  };
  policy: {
    done: boolean;
    confirmed: boolean;
    reviewed: boolean;
    name: string | null;
    free_cancel_days: number | null;
  };
  payments: {
    done: boolean;
    confirmed: boolean;
    /** מיגרציה 37: הוראות התשלום לאורחים נשמרו, ואילו אמצעים פעילים (לפני 37 — חסר) */
    configured?: boolean;
    methods?: string[];
    deposit_kind: "none" | "percent" | "fixed";
    deposit_value: number;
    deposit_due: "booking" | "approval";
  };
  template: { done: boolean; theme: string | null };
  logo: { done: boolean; has: boolean; skipped: boolean };
  site: { done: boolean; edited: boolean };
  seo: { done: boolean; has: boolean; skipped: boolean };
  publish: {
    done: boolean;
    /** יש גרסה מפורסמת — רק אותה האתר הציבורי מציג */
    published: boolean;
    version: number | null;
    published_at: string | null;
    /** יש בטיוטה שינויים שעוד לא פורסמו */
    unpublished: boolean;
    /** אבן הדרך "האתר מוכן לפרסום" */
    ready: boolean;
    /** האתר פתוח לגולשים / קבלת הזמנות — החלטה של הפלטפורמה */
    site_open: boolean;
    booking_open: boolean;
  };
}

export interface SetupMilestones {
  business: boolean;
  units: boolean;
  photos: boolean;
  prices: boolean;
  site: boolean;
}

export interface SetupGuideView {
  steps: SetupSteps;
  milestones: SetupMilestones;
  bookable_units: number;
  state: {
    current_step: SetupStepKey | null;
    confirmed: string[];
    skipped: string[];
    updated_at: string | null;
  };
}
