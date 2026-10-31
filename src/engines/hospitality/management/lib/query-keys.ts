// מפתחות TanStack Query של אזור הניהול — אחידים, כדי לרענן בדיוק את מה שצריך
export const manageKeys = {
  all: ["hospitality", "manage"] as const,
  context: ["hospitality", "manage", "context"] as const,
  settings: ["hospitality", "manage", "settings"] as const,
  team: ["hospitality", "manage", "team"] as const,
  activity: ["hospitality", "manage", "activity"] as const,
};
