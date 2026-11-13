// הפעילות האחרונה בשפה פשוטה (יומן הפעולות, מיגרציה 8)
import type { ActivityEntry } from "../../types/team";
import { SETTINGS_KEYS, type SettingsKey } from "../../types/settings";
import { SETTINGS_LABELS } from "../../validation/settings";
import { PROPERTY_LABELS, UNIT_LABELS } from "../../validation/catalog";
import { ARRIVAL_LABELS, PROPERTY_DETAIL_LABELS } from "../../validation/details";
import { EVENT_STATUS_LABEL, type EventStatus } from "../../types/events";
import { EMAIL_EVENT } from "../bookings/model";
import { SETUP_STEP_DEFS } from "../setup/model";

/** שמות השדות שהשתנו (מהיומן) בעברית — בלי הערכים */
const FIELD_LABELS: Record<string, string> = {
  ...PROPERTY_LABELS,
  ...PROPERTY_DETAIL_LABELS,
  ...UNIT_LABELS,
  beds: "מיטות",
  amenities: "מתקנים",
};
const fieldsText = (changes: Record<string, unknown>) =>
  Object.keys(changes)
    .map((k) => FIELD_LABELS[k])
    .filter(Boolean)
    .join(", ");

/** שם הצעד במדריך ההקמה (מיגרציה 35) */
const setupStep = (entry: ActivityEntry) => {
  const key = entry.changes["step"];
  return SETUP_STEP_DEFS.find((d) => d.key === key)?.title ?? "צעד";
};

const ROLE_FALLBACK: Record<ActivityEntry["actor_role"], string> = {
  owner: "בעל/ת העסק",
  manager: "מנהל/ת",
  platform: "צוות נוריאל",
  system: "המערכת",
};

export function activityText(entry: ActivityEntry): string {
  const actor = entry.actor || ROLE_FALLBACK[entry.actor_role];
  const target = entry.target ?? "";
  switch (entry.action) {
    case "team.manager_added":
      return `${actor} הוסיף/ה את ${target} לצוות הניהול`;
    case "team.manager_removed":
      return `${actor} הסיר/ה את ${target} מצוות הניהול`;
    // שלב א' 6
    case "settings.shabbat_on":
      return `${actor} סימן/ה שהמתחם שומר שבת`;
    case "settings.shabbat_off":
      return `${actor} ביטל/ה את הסימון "המתחם שומר שבת"`;
    case "settings.updated": {
      const fields = Object.keys(entry.changes)
        .filter((k): k is SettingsKey => (SETTINGS_KEYS as readonly string[]).includes(k))
        .map((k) => SETTINGS_LABELS[k]);
      return fields.length
        ? `${actor} עדכן/ה את ההגדרות: ${fields.join(", ")}`
        : `${actor} עדכן/ה את ההגדרות`;
    }
    case "catalog.property_created":
      return `${actor} הוסיף/ה את המתחם ${target}`;
    case "catalog.property_updated": {
      const f = fieldsText(entry.changes);
      return f ? `${actor} עדכן/ה את המתחם ${target}: ${f}` : `${actor} עדכן/ה את המתחם ${target}`;
    }
    case "catalog.property_archived":
      return `${actor} העביר/ה לארכיון את המתחם ${target}`;
    case "catalog.property_deleted":
      return `${actor} מחק/ה את המתחם ${target}`;
    case "catalog.unit_created":
      return `${actor} הוסיף/ה את היחידה ${target}`;
    case "catalog.unit_updated": {
      const f = fieldsText(entry.changes);
      return f
        ? `${actor} עדכן/ה את היחידה ${target}: ${f}`
        : `${actor} עדכן/ה את היחידה ${target}`;
    }
    case "catalog.amenity_added":
      return `${actor} הוסיף/ה את המתקן ${target} לרשימה`;
    case "catalog.amenity_updated":
      return `${actor} עדכן/ה את המתקן ${target}`;
    case "catalog.amenity_removed":
      return `${actor} הסיר/ה את המתקן ${target} מהרשימה`;
    case "catalog.arrival_info_updated": {
      const fields = Array.isArray(entry.changes["fields"])
        ? (entry.changes["fields"] as string[])
            .map((k) => ARRIVAL_LABELS[k as keyof typeof ARRIVAL_LABELS])
            .filter(Boolean)
        : [];
      return fields.length
        ? `${actor} עדכן/ה מידע פרטי להגעה (${target}): ${fields.join(", ")}`
        : `${actor} עדכן/ה מידע פרטי להגעה (${target})`;
    }
    case "catalog.unit_activated":
      return `${actor} הפעיל/ה את היחידה ${target}`;
    case "catalog.unit_deactivated":
      return `${actor} השבית/ה את היחידה ${target}`;
    case "catalog.unit_deleted":
      return `${actor} מחק/ה את היחידה ${target}`;
    case "catalog.whole_property_enabled":
      return `${actor} הפעיל/ה השכרה של כל המתחם ${target}`;
    case "catalog.whole_property_disabled":
      return `${actor} כיבה/תה השכרה של כל המתחם ${target}`;
    case "catalog.reordered":
      return `${actor} שינה/תה את סדר התצוגה`;
    case "media.added":
      return `${actor} הוסיף/ה תמונה או סרטון`;
    case "media.replaced":
      return `${actor} החליף/ה תמונה`;
    case "media.deleted":
      return `${actor} מחק/ה תמונה או סרטון`;
    case "media.cover_set":
      return `${actor} בחר/ה תמונה ראשית`;
    case "media.alt_updated":
      return `${actor} עדכן/ה טקסט חלופי לתמונה`;
    case "media.reordered":
      return `${actor} שינה/תה את סדר התמונות`;
    case "pricing.unit_prices":
      return `${actor} עדכן/ה את המחירים של ${target}`;
    case "pricing.rule_created":
      return `${actor} הוסיף/ה כלל מחיר ${target}`;
    case "pricing.rule_updated":
      return `${actor} עדכן/ה את כלל המחיר ${target}`;
    case "pricing.rule_deleted":
      return `${actor} מחק/ה את כלל המחיר ${target}`;
    case "policies.created":
      return `${actor} יצר/ה מדיניות ביטול ${target}`;
    case "policies.updated":
      return `${actor} עדכן/ה את מדיניות הביטול ${target}`;
    case "policies.default_set":
      return `${actor} קבע/ה את ${target} כמדיניות ברירת המחדל`;
    case "policies.archived":
      return `${actor} העביר/ה לארכיון את מדיניות הביטול ${target}`;
    case "calendar.block_created":
      return `${actor} חסם/ה תאריכים ב${target}`;
    case "calendar.block_updated":
      return `${actor} שינה/תה חסימה ב${target}`;
    case "calendar.block_released":
      return `${actor} שחרר/ה חסימה ב${target}`;
    // מיגרציה 43: פתיחת תאריכים להזמנה באתר / סגירה
    case "calendar.dates_opened": {
      const until = entry.changes["until"];
      const day =
        typeof until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(until)
          ? `${Number(until.slice(8))}.${Number(until.slice(5, 7))}.${until.slice(0, 4)}`
          : "";
      return `${actor} פתח/ה להזמנה באתר את ${target}${day ? ` עד ${day}` : ""}`;
    }
    case "calendar.dates_closed":
      return `${actor} סגר/ה להזמנות באתר את ${target}`;
    case "guests.notes_updated":
      return `${actor} עדכן/ה הערות על האורח ${target}`;
    case "guests.exported":
      return `${actor} ייצא/ה את המידע על האורח ${target}`;
    case "guests.anonymized":
      return `${actor} מחק/ה פרטים אישיים של אורח`;
    case "payments.recorded":
      return `${actor} רשם/ה תשלום ב${target}`;
    case "payments.refund_recorded":
      return `${actor} רשם/ה החזר כספי ב${target}`;
    case "payments.voided":
      return `${actor} ביטל/ה רישום תשלום ב${target}`;
    // שלב א' 5: אישורי העברה שהאורח העלה
    case "payments.proof_approved":
      return `${actor} אישר/ה העברה בנקאית ב${target}`;
    case "payments.proof_rejected":
      return `${actor} דחה/תה אישור העברה ב${target}`;
    case "payments.instructions_updated":
      return `${actor} עדכן/ה את פרטי התשלום לאורחים`;
    case "room_types.created":
      return `${actor} הוסיף/ה את סוג החדר ${target}`;
    case "room_types.updated":
      return `${actor} עדכן/ה את סוג החדר ${target}`;
    case "room_types.deleted":
      return `${actor} מחק/ה את סוג החדר ${target}`;
    case "room_types.assigned":
      return `${actor} שייך/ה את ${target} לסוג חדר`;
    case "room_types.applied":
      return `${actor} החיל/ה את פרטי סוג החדר ${target} על החדרים שלו`;
    // שלב א' 7: חבילות
    case "packages.created":
      return `${actor} הוסיף/ה את החבילה ${target}`;
    case "packages.updated":
      return `${actor} עדכן/ה את החבילה ${target}`;
    case "packages.deleted":
      return `${actor} מחק/ה את החבילה ${target}`;
    case "packages.shown":
      return `${actor} הציג/ה באתר את החבילה ${target}`;
    case "packages.hidden":
      return `${actor} הסתיר/ה מהאתר את החבילה ${target}`;
    case "documents.saved":
      return `${actor} שמר/ה טיוטה של המסמך ${target}`;
    case "documents.published":
      return `${actor} פרסם/ה באתר את המסמך ${target}`;
    case "documents.unpublished":
      return `${actor} הסיר/ה מהאתר את המסמך ${target}`;
    case "documents.reviewed":
      return `${actor} סימן/ה שהמסמך ${target} נבדק`;
    case "documents.review_cleared":
      return `${actor} ביטל/ה את סימון הבדיקה של המסמך ${target}`;
    case "documents.profile_saved":
      return `${actor} עדכן/ה את פרטי העסק למסמכים`;
    case "accessibility.confirmed":
      return `${actor} אישר/ה את הסדרי הנגישות במתחם ${target}`;
    case "channels.calendar_added":
      return `${actor} חיבר/ה יומן חיצוני ל${target}`;
    case "channels.calendar_removed":
      return `${actor} ניתק/ה יומן חיצוני מ${target}`;
    case "channels.feed_rotated":
      return `${actor} החליף/ה את קישור הייצוא של ${target}`;
    case "channels.conflict":
      return `התנגשות תאריכים מיומן חיצוני ב${target}`;
    case "emails.requeued":
      return `${actor} שלח/ה שוב מייל: ${EMAIL_EVENT[target] ?? "מייל"}`;
    case "site.published":
      return `${actor} פרסם/ה את האתר (${target})`;
    case "site.restored":
      return `${actor} החזיר/ה לטיוטה את ${target} של האתר`;
    case "support.opened":
      return `${actor} פתח/ה פנייה לתמיכה ${target}`;
    case "support.closed":
      return `${actor} סגר/ה את הפנייה לתמיכה ${target}`;
    case "support.reopened":
      return `${actor} פתח/ה מחדש את הפנייה לתמיכה ${target}`;
    case "team.finance_granted":
      return `${actor} נתן/ה ל${target} גישה לנתונים הכספיים`;
    case "team.finance_revoked":
      return `${actor} הסיר/ה מ${target} את הגישה לנתונים הכספיים`;
    // מיגרציה 63: אירועים ותנאי העסק
    case "events.created":
      return `${actor} הוסיף/ה את ${target}`;
    case "events.updated":
      return `${actor} עדכן/ה את פרטי ${target}`;
    case "events.status": {
      const to = entry.changes["to"];
      const label = typeof to === "string" ? EVENT_STATUS_LABEL[to as EventStatus] : undefined;
      return label
        ? `${actor} שינה/תה את ${target} ל"${label}"`
        : `${actor} שינה/תה את המצב של ${target}`;
    }
    case "terms.saved":
      return `${actor} עדכן/ה את התנאים והפרטים לחוזים`;
    case "terms.confirmed":
      return `${actor} אישר/ה את התנאים והפרטים לחוזים`;
    // מיגרציה 65: תיקון פרטי הלקוח
    case "bookings.customer_updated":
      return `${actor} תיקן/ה את פרטי הלקוח ב${target}`;
    case "bookings.details_sent":
      return `${actor} שלח/ה ללקוח את פרטי ${target} וקישור אישי חדש`;
    case "events.customer_updated":
      return `${actor} תיקן/ה את פרטי הלקוח ב${target}`;
    // מיגרציה 64: מסמכי לקוחות
    case "contracts.created":
      return `${actor} הכין/ה את ${target} לשליחה`;
    case "contracts.corrected":
      return `${actor} הכין/ה חוזה מתוקן — ${target}`;
    case "contracts.sent":
      return `${target} נשלח ללקוח לחתימה`;
    // מסמך עצמאי שהלקוח ממלא: נוצר קישור לחתימה, להעברה ללקוח (הקישור עצמו לא נשמר)
    case "contracts.link_created":
      return `${actor} יצר/ה קישור לחתימה על ${target}, להעברה ללקוח`;
    case "contracts.send_failed":
      return `השליחה של ${target} נכשלה — לא סומן כנשלח`;
    case "contracts.signed":
      return `הלקוח חתם על ${target}`;
    case "contracts.cancelled":
      return `${actor} ביטל/ה את ${target}`;
    case "contracts.file_view":
      return `${actor} צפה/תה ב-PDF של ${target}`;
    case "contracts.file_download":
      return `${actor} הוריד/ה את ה-PDF של ${target}`;
    case "team.contracts_granted":
      return `${actor} נתן/ה ל${target} גישה למסמכי הלקוחות`;
    case "team.contracts_revoked":
      return `${actor} הסיר/ה מ${target} את הגישה למסמכי הלקוחות`;
    case "team.business_admin_granted":
      return `${actor} מינה/תה את ${target} למנהל/ת עסק (כל ההרשאות חוץ ממנוי ותשלום)`;
    case "team.business_admin_revoked":
      return `${actor} ביטל/ה את המינוי של ${target} למנהל/ת עסק`;
    case "setup.confirm":
      return `${actor} סימן/ה במדריך ההקמה ש"${setupStep(entry)}" נבדק ומתאים`;
    case "setup.unconfirm":
      return `${actor} ביטל/ה במדריך ההקמה את האישור של "${setupStep(entry)}"`;
    case "setup.skip":
      return `${actor} דילג/ה במדריך ההקמה על "${setupStep(entry)}"`;
    case "setup.unskip":
      return `${actor} ביטל/ה במדריך ההקמה את הדילוג על "${setupStep(entry)}"`;
    default:
      return `${actor}: ${entry.action}`;
  }
}

/** "צוות ניהול: 2 מתוך 3" — וכמה נשארו */
export function seatsText(seats: { used: number; limit: number | null }): {
  text: string;
  full: boolean;
} {
  if (seats.limit === null) return { text: `${seats.used} מנהלים (ללא הגבלה)`, full: false };
  return {
    text: `${seats.used} מתוך ${seats.limit} מקומות בשימוש`,
    full: seats.used >= seats.limit,
  };
}
