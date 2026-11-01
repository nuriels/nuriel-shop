// מפתחות TanStack Query של אזור הניהול — אחידים, כדי לרענן בדיוק את מה שצריך
export const manageKeys = {
  all: ["hospitality", "manage"] as const,
  context: ["hospitality", "manage", "context"] as const,
  settings: ["hospitality", "manage", "settings"] as const,
  team: ["hospitality", "manage", "team"] as const,
  activity: ["hospitality", "manage", "activity"] as const,
  catalog: ["hospitality", "manage", "catalog"] as const,
  /** מידע פרטי להגעה של מתחם (2d) — נפרד מהקטלוג, לא נשמר בשום מטמון משותף */
  arrival: (propertyId: string) => ["hospitality", "manage", "arrival", propertyId] as const,
};
