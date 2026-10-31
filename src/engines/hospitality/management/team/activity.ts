// הפעילות האחרונה בשפה פשוטה (יומן הפעולות, מיגרציה 8)
import type { ActivityEntry } from "../../types/team";
import { SETTINGS_KEYS, type SettingsKey } from "../../types/settings";
import { SETTINGS_LABELS } from "../../validation/settings";

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
