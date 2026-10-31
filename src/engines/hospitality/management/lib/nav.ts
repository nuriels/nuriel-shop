// הניווט של אזור הניהול. מה שעוד לא נבנה מסומן "בקרוב" (לא קישור);
// פריט עם הרשאה מוצג רק למי שיש לו אותה (למשל הצוות — לבעלים בלבד).
// ההרשאה עצמה נאכפת במסד; כאן רק מה מוצג.

export type NavKey =
  "dashboard" | "bookings" | "units" | "pricing" | "guests" | "emails" | "settings" | "team";

export interface NavItem {
  key: NavKey;
  label: string;
  /** נתיב של מסך קיים; בלי נתיב = עוד לא נבנה ("בקרוב") */
  to?: "/manage" | "/manage/settings";
  /** בניווט התחתון בטלפון (השאר תחת "עוד") */
  primary?: boolean;
  permission?: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "dashboard", label: "לוח בקרה", to: "/manage", primary: true },
  { key: "bookings", label: "הזמנות", primary: true, permission: "bookings" },
  { key: "units", label: "יחידות", primary: true, permission: "catalog" },
  { key: "pricing", label: "מחירים", permission: "pricing" },
  { key: "guests", label: "אורחים", permission: "guests" },
  { key: "emails", label: "מיילים", permission: "bookings" },
  { key: "settings", label: "הגדרות העסק", to: "/manage/settings", permission: "settings" },
  { key: "team", label: "צוות ניהול", permission: "staff.managers" },
];

export function visibleNav(permissions: Record<string, boolean>): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.permission || permissions[item.permission] === true);
}

/** בטלפון: הפריטים הראשיים בשורה התחתונה, וכל השאר בתפריט "עוד" */
export function splitForMobile(items: NavItem[]): { bar: NavItem[]; more: NavItem[] } {
  return { bar: items.filter((i) => i.primary), more: items.filter((i) => !i.primary) };
}
