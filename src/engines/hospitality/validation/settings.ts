// בדיקת שדות הגדרות העסק — אותם כללים כמו update_settings() במסד (המסד נשאר הסמכות
// הסופית, כולל ההרשאה לכל שדה). משמש את הטופס (הודעה ליד השדה) ואת פונקציית השרת.
import {
  LOCKED_SETTINGS_KEYS,
  SETTINGS_KEYS,
  type SettingsChanges,
  type SettingsKey,
} from "../types/settings";
import { InputError } from "./input";

export const SETTINGS_LABELS: Record<SettingsKey, string> = {
  business_name: "שם העסק",
  contact_phone: "טלפון העסק",
  contact_email: "אימייל העסק",
  whatsapp_phone: "מספר WhatsApp",
  address: "כתובת העסק",
  check_in_time: "שעת הגעה",
  check_out_time: "שעת עזיבה",
  approval_window_minutes: "זמן לאישור בקשה",
  approval_reminder_pct: "זמן התזכורת",
  max_open_requests: "בקשות פתוחות לאורח",
  weekend_nights: "לילות סוף שבוע",
  notification_emails: "נמעני ההתראות",
  guest_retention_months: "שמירת פרטי אורחים",
};

const PHONE = /^\+?[0-9 ()-]{7,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const INT_RANGES: Partial<Record<SettingsKey, [number, number]>> = {
  approval_window_minutes: [60, 2880],
  approval_reminder_pct: [10, 90],
  max_open_requests: [1, 10],
  guest_retention_months: [6, 120],
};

const isKey = (k: string): k is SettingsKey => (SETTINGS_KEYS as readonly string[]).includes(k);
const textOrNull = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** הודעת שגיאה לשדה, או null אם הערך תקין */
export function settingsFieldError(key: SettingsKey, value: unknown): string | null {
  const label = SETTINGS_LABELS[key];
  switch (key) {
    case "business_name": {
      const s = textOrNull(value);
      if (!s) return `יש למלא את ${label}`;
      return s.length > 120 ? `${label} ארוך מדי (עד 120 תווים)` : null;
    }
    case "address": {
      const s = textOrNull(value);
      return s && s.length > 300 ? `${label} ארוך מדי (עד 300 תווים)` : null;
    }
    case "contact_phone":
    case "whatsapp_phone": {
      const s = textOrNull(value);
      return s && !PHONE.test(s) ? `${label} — מספר הטלפון לא תקין` : null;
    }
    case "contact_email": {
      const s = textOrNull(value);
      return s && (!EMAIL.test(s) || s.length > 254) ? "כתובת האימייל של העסק לא תקינה" : null;
    }
    case "check_in_time":
    case "check_out_time":
      return typeof value === "string" && TIME.test(value)
        ? null
        : `${label} — שעה לא תקינה (למשל 15:00)`;
    case "weekend_nights":
      return Array.isArray(value) &&
        value.length <= 7 &&
        value.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        ? null
        : "לילות סוף שבוע — יש לבחור ימים מהרשימה";
    case "notification_emails": {
      if (!Array.isArray(value) || value.length > 5) return "נמעני ההתראות — עד 5 כתובות אימייל";
      const bad = value.some(
        (e) =>
          typeof e !== "string" || (e.trim() !== "" && (!EMAIL.test(e.trim()) || e.length > 254)),
      );
      return bad ? "נמעני ההתראות — אחת הכתובות לא תקינה" : null;
    }
    case "guest_retention_months":
      return value === null ? null : intError(key, value);
    case "approval_window_minutes":
    case "approval_reminder_pct":
    case "max_open_requests":
      return intError(key, value);
  }
}

function intError(key: SettingsKey, value: unknown): string | null {
  const [min, max] = INT_RANGES[key]!;
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? null
    : `${SETTINGS_LABELS[key]} חייב להיות מספר שלם בין ${min} ל-${max}`;
}

/** הקלט של פונקציית השמירה: { changes: {שדה: ערך}, revision } */
export function parseSettingsUpdate(input: Record<string, unknown> | null | undefined): {
  changes: SettingsChanges;
  revision: number;
} {
  const revision = (input ?? {})["revision"];
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1)
    throw new InputError("גרסת ההגדרות לא תקינה — רעננו את העמוד");
  const raw = (input ?? {})["changes"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new InputError("אין שינויים לשמירה");
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0) throw new InputError("אין שינויים לשמירה");
  const changes: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if ((LOCKED_SETTINGS_KEYS as readonly string[]).includes(key))
      throw new InputError("השדה הזה נעול בשלב הזה");
    if (!isKey(key)) throw new InputError("שדה לא מוכר");
    const error = settingsFieldError(key, value);
    if (error) throw new InputError(error);
    changes[key] = value;
  }
  return { changes: changes as SettingsChanges, revision };
}
