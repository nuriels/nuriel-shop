// הפעילות האחרונה בשפה פשוטה (יומן הפעולות, מיגרציה 8)
import type { ActivityEntry } from "../../types/team";
import { SETTINGS_KEYS, type SettingsKey } from "../../types/settings";
import { SETTINGS_LABELS } from "../../validation/settings";
import { PROPERTY_LABELS, UNIT_LABELS } from "../../validation/catalog";
import { ARRIVAL_LABELS, PROPERTY_DETAIL_LABELS } from "../../validation/details";

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
