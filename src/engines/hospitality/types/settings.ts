// הגדרות העסק — מה ש-settings_view() / update_settings() מחזירות (מיגרציה 8)

/** השדות שאפשר לערוך (לפי הרשאה); מיגרציה 8 מחליטה מי עורך מה */
export const SETTINGS_KEYS = [
  "business_name",
  "contact_phone",
  "contact_email",
  "whatsapp_phone",
  "address",
  "check_in_time",
  "check_out_time",
  "approval_window_minutes",
  "approval_reminder_pct",
  "max_open_requests",
  "weekend_nights",
  "notification_emails",
  "guest_retention_months",
] as const;
export type SettingsKey = (typeof SETTINGS_KEYS)[number];

/** נעולים לכולם עד השלב שתומך בהם */
export const LOCKED_SETTINGS_KEYS = [
  "booking_mode",
  "currency",
  "timezone",
  "payment_hold_minutes",
] as const;
export type LockedSettingsKey = (typeof LOCKED_SETTINGS_KEYS)[number];

export interface SettingsValues {
  business_name: string;
  contact_phone: string | null;
  contact_email: string | null;
  whatsapp_phone: string | null;
  address: string | null;
  check_in_time: string;
  check_out_time: string;
  approval_window_minutes: number;
  approval_reminder_pct: number;
  max_open_requests: number;
  weekend_nights: number[];
  notification_emails: string[];
  guest_retention_months: number | null;
  booking_mode: string;
  currency: string;
  timezone: string;
  payment_hold_minutes: number;
}

export interface SettingsView {
  revision: number;
  updated_at: string;
  values: SettingsValues;
  /** מה המשתמש הנוכחי רשאי לערוך (המסד קובע) */
  editable: SettingsKey[];
  locked: LockedSettingsKey[];
}

export type SettingsChanges = Partial<Pick<SettingsValues, SettingsKey>>;

/** שמירה: נשמר / מישהו אחר שמר בינתיים (עם הערכים העדכניים) */
export type SettingsSaveResult =
  | { status: "saved"; view: SettingsView }
  | { status: "conflict"; view: SettingsView; message: string };
