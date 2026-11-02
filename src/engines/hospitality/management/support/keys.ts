// מפתחות המטמון של מסכי התמיכה (E4) — כדי לרענן בדיוק את מה שהשתנה
import { manageKeys } from "../lib/query-keys";

export const supportKeys = {
  all: [...manageKeys.all, "support"] as const,
  list: [...manageKeys.all, "support", "list"] as const,
  unread: [...manageKeys.all, "support", "unread"] as const,
  ticket: (id: string) => [...manageKeys.all, "support", "ticket", id] as const,
};

/** פאנל הפלטפורמה */
export const adminSupportKeys = {
  all: ["hospitality-platform", "support"] as const,
  list: (filter: unknown) => ["hospitality-platform", "support", "list", filter] as const,
  ticket: (id: string) => ["hospitality-platform", "support", "ticket", id] as const,
  settings: ["hospitality-platform", "support", "settings"] as const,
};
