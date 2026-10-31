// מודל הטופס של הגדרות העסק: חלוקה לאזורים, רק שדות שהמשתמש רשאי לערוך,
// מה השתנה, ומיזוג אחרי "עודכן בינתיים" — בלי לדרוס שינוי של משתמש אחר.
import type { SettingsChanges, SettingsKey, SettingsValues } from "../../types/settings";
import { settingsFieldError } from "../../validation/settings";

export type FormValues = {
  business_name: string;
  contact_phone: string;
  contact_email: string;
  whatsapp_phone: string;
  address: string;
  check_in_time: string;
  check_out_time: string;
  approval_window_minutes: number;
  approval_reminder_pct: number;
  max_open_requests: number;
  weekend_nights: number[];
  notification_emails: string[];
  guest_retention_months: number | null;
};

export type SectionKey = "business" | "times" | "rules" | "notifications" | "privacy";

export interface SectionDef {
  key: SectionKey;
  title: string;
  description: string;
  fields: SettingsKey[];
}

export const SECTIONS: readonly SectionDef[] = [
  {
    key: "business",
    title: "פרטי העסק",
    description: "השם והדרכים ליצור קשר — יופיעו לאורחים באתר ובמיילים.",
    fields: ["business_name", "contact_phone", "whatsapp_phone", "contact_email", "address"],
  },
  {
    key: "times",
    title: "שעות הגעה ועזיבה",
    description: "השעות שבהן האורחים מגיעים ועוזבים.",
    fields: ["check_in_time", "check_out_time"],
  },
  {
    key: "rules",
    title: "כללי הזמנה",
    description: "כמה זמן יש לכם לאשר בקשה, ומה נחשב סוף שבוע במחירים.",
    fields: [
      "approval_window_minutes",
      "approval_reminder_pct",
      "max_open_requests",
      "weekend_nights",
    ],
  },
  {
    key: "notifications",
    title: "מי מקבל את המיילים על הזמנות",
    description: "עד 5 כתובות. בלי כתובות — המיילים נשלחים לאימייל העסק.",
    fields: ["notification_emails"],
  },
  {
    key: "privacy",
    title: "שמירת פרטי אורחים",
    description: "אחרי כמה זמן מהשהייה האחרונה פרטי האורח נמחקים אוטומטית.",
    fields: ["guest_retention_months"],
  },
];

/** רק אזורים שיש בהם שדה שהמשתמש רשאי לערוך, ורק השדות האלה */
export function visibleSections(editable: readonly SettingsKey[]): SectionDef[] {
  return SECTIONS.map((s) => ({
    ...s,
    fields: s.fields.filter((f) => editable.includes(f)),
  })).filter((s) => s.fields.length > 0);
}

export function formFromValues(v: SettingsValues): FormValues {
  return {
    business_name: v.business_name ?? "",
    contact_phone: v.contact_phone ?? "",
    contact_email: v.contact_email ?? "",
    whatsapp_phone: v.whatsapp_phone ?? "",
    address: v.address ?? "",
    check_in_time: v.check_in_time,
    check_out_time: v.check_out_time,
    approval_window_minutes: v.approval_window_minutes,
    approval_reminder_pct: v.approval_reminder_pct,
    max_open_requests: v.max_open_requests,
    weekend_nights: [...v.weekend_nights].sort((a, b) => a - b),
    notification_emails: [...v.notification_emails],
    guest_retention_months: v.guest_retention_months,
  };
}

const OPTIONAL_TEXT: ReadonlySet<SettingsKey> = new Set([
  "contact_phone",
  "contact_email",
  "whatsapp_phone",
  "address",
]);

/** הערך כפי שנשלח לשמירה (טקסט ריק → null, אימיילים מנורמלים, ימים ממוינים) */
export function toServerValue(key: SettingsKey, form: FormValues): unknown {
  const v = form[key];
  if (OPTIONAL_TEXT.has(key)) {
    const s = String(v).trim();
    return s === "" ? null : key === "contact_email" ? s.toLowerCase() : s;
  }
  if (key === "business_name") return String(v).trim();
  if (key === "weekend_nights") return [...new Set(v as number[])].sort((a, b) => a - b);
  if (key === "notification_emails")
    return [
      ...new Set((v as string[]).map((e) => e.trim().toLowerCase()).filter((e) => e !== "")),
    ].sort();
  return v;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** השדות (מתוך המותרים) שהערך שלהם שונה בין שני מצבים */
export function changedFields(
  a: FormValues,
  b: FormValues,
  editable: readonly SettingsKey[],
): SettingsKey[] {
  return editable.filter((k) => !same(toServerValue(k, a), toServerValue(k, b)));
}

export function buildChanges(
  base: FormValues,
  form: FormValues,
  editable: readonly SettingsKey[],
): SettingsChanges {
  const changes: Record<string, unknown> = {};
  for (const k of changedFields(base, form, editable)) changes[k] = toServerValue(k, form);
  return changes as SettingsChanges;
}

/** שגיאות לשדות ששונו (שדה שלא נגעו בו לא מסומן) */
export function formErrors(
  base: FormValues,
  form: FormValues,
  editable: readonly SettingsKey[],
): Partial<Record<SettingsKey, string>> {
  const errors: Partial<Record<SettingsKey, string>> = {};
  for (const k of changedFields(base, form, editable)) {
    const e = settingsFieldError(k, toServerValue(k, form));
    if (e) errors[k] = e;
  }
  return errors;
}

/**
 * מישהו אחר שמר בינתיים. הטופס החדש = הערכים העדכניים, ועליהם השינויים שלי בשדות
 * שהמשתמש האחר לא שינה. שדה ששנינו שינינו — הערך שלו נשאר (השינוי שלי בוטל ומדווח).
 */
export function mergeAfterConflict(
  base: FormValues,
  form: FormValues,
  latest: FormValues,
  editable: readonly SettingsKey[],
): { form: FormValues; remoteChanged: SettingsKey[]; dropped: SettingsKey[]; kept: SettingsKey[] } {
  const all = Array.from(new Set<SettingsKey>([...editable, ...SECTIONS.flatMap((s) => s.fields)]));
  const remoteChanged = changedFields(base, latest, all);
  const mine = changedFields(base, form, editable);
  const dropped = mine.filter((k) => remoteChanged.includes(k));
  const kept = mine.filter((k) => !remoteChanged.includes(k));
  const merged: FormValues = { ...latest };
  for (const k of kept) (merged as Record<SettingsKey, unknown>)[k] = form[k];
  return { form: merged, remoteChanged, dropped, kept };
}

// אפשרויות בחירה (שפה פשוטה, בלי מספרים טכניים)
export const APPROVAL_HOURS = [1, 2, 3, 4, 6, 8, 12, 24, 36, 48];
export const REMINDER_PCT = [25, 50, 75];
export const OPEN_REQUESTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const RETENTION_MONTHS: (number | null)[] = [null, 12, 24, 36, 60, 120];
/** 0 = ליל ראשון … 6 = ליל שבת (הלילה שמתחיל ביום הזה) */
export const NIGHT_LABELS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export function hoursText(minutes: number): string {
  if (minutes % 60 !== 0) return `${minutes} דקות`;
  const h = minutes / 60;
  return h === 1 ? "שעה אחת" : h === 24 ? "יממה" : h === 48 ? "יומיים" : `${h} שעות`;
}

export function retentionText(months: number | null): string {
  if (months === null) return "לא למחוק אוטומטית";
  if (months % 12 === 0)
    return months === 12 ? "שנה" : months === 24 ? "שנתיים" : `${months / 12} שנים`;
  return `${months} חודשים`;
}
