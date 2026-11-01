// הניווט של אזור הניהול. מה שעוד לא נבנה מסומן "בקרוב" (לא קישור);
// פריט עם הרשאה מוצג רק למי שיש לו אותה (למשל הצוות — לבעלים בלבד).
// ההרשאה עצמה נאכפת במסד; כאן רק מה מוצג.

export type NavKey =
  | "dashboard"
  | "calendar"
  | "bookings"
  | "units"
  | "photos"
  | "pricing"
  | "policies"
  | "guests"
  | "emails"
  | "settings"
  | "team";

export interface NavItem {
  key: NavKey;
  label: string;
  /** נתיב של מסך קיים; בלי נתיב = עוד לא נבנה ("בקרוב") */
  to?:
    | "/manage"
    | "/manage/calendar"
    | "/manage/bookings"
    | "/manage/guests"
    | "/manage/emails"
    | "/manage/settings"
    | "/manage/team"
    | "/manage/units"
    | "/manage/photos"
    | "/manage/pricing"
    | "/manage/policies";
  /** בניווט התחתון בטלפון (השאר תחת "עוד") */
  primary?: boolean;
  permission?: string;
  /** מסכים נוספים ששייכים לפריט (מסומן גם בהם), לפי תחילת הנתיב */
  also?: readonly string[];
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "dashboard", label: "לוח בקרה", to: "/manage", primary: true },
  { key: "calendar", label: "יומן", to: "/manage/calendar", primary: true, permission: "bookings" },
  {
    key: "bookings",
    label: "הזמנות",
    to: "/manage/bookings",
    primary: true,
    permission: "bookings",
    also: ["/manage/bookings/"],
  },
  {
    key: "units",
    label: "יחידות",
    to: "/manage/units",
    primary: true,
    permission: "catalog",
    also: ["/manage/units/", "/manage/properties/"],
  },
  { key: "photos", label: "תמונות", to: "/manage/photos", permission: "media" },
  { key: "pricing", label: "מחירים", to: "/manage/pricing", permission: "pricing" },
  { key: "policies", label: "מדיניות ביטול", to: "/manage/policies", permission: "policies" },
  {
    key: "guests",
    label: "אורחים",
    to: "/manage/guests",
    permission: "guests",
    also: ["/manage/guests/"],
  },
  { key: "emails", label: "מיילים", to: "/manage/emails", permission: "bookings" },
  { key: "settings", label: "הגדרות העסק", to: "/manage/settings", permission: "settings" },
  { key: "team", label: "צוות ניהול", to: "/manage/team", permission: "staff.managers" },
];

export function visibleNav(permissions: Record<string, boolean>): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.permission || permissions[item.permission] === true);
}

/** הפריט מסומן כמסך הנוכחי: הנתיב שלו בדיוק, או מסך ששייך אליו (עמוד יחידה / מתחם) */
export function isNavActive(item: NavItem, pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (item.to === path) return true;
  return (item.also ?? []).some((prefix) => path.startsWith(prefix));
}

/** בטלפון: הפריטים הראשיים בשורה התחתונה, וכל השאר בתפריט "עוד" */
export function splitForMobile(items: NavItem[]): { bar: NavItem[]; more: NavItem[] } {
  return { bar: items.filter((i) => i.primary), more: items.filter((i) => !i.primary) };
}
