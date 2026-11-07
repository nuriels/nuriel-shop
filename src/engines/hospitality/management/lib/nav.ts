// הניווט של אזור הניהול (שלב F2b: בקבוצות — תפעול / המקום / האתר והערוצים / חשבון).
// פריט עם הרשאה מוצג רק למי שיש לו אותה (למשל הצוות — לבעלים בלבד).
// ההרשאה עצמה נאכפת במסד; כאן רק מה מוצג.

export type NavKey =
  | "dashboard"
  | "calendar"
  | "bookings"
  | "units"
  | "packages"
  | "photos"
  | "pricing"
  | "policies"
  | "guests"
  | "emails"
  | "channels"
  | "website"
  | "settings"
  | "team"
  | "support"
  | "reports"
  | "setup";

export type NavGroupKey = "operations" | "place" | "site" | "account";

/** ספירות ליד פריטים (ממתינות לאישור, ערוצים שדורשים בדיקה, מיילים שנכשלו, תשובות מהתמיכה) */
export type NavBadges = Partial<Record<NavKey, number>>;

export const NAV_GROUPS: readonly { key: NavGroupKey; title: string }[] = [
  { key: "operations", title: "תפעול" },
  { key: "place", title: "המקום" },
  { key: "site", title: "האתר והערוצים" },
  { key: "account", title: "חשבון" },
];

export type NavPath =
  | "/manage"
  | "/manage/calendar"
  | "/manage/bookings"
  | "/manage/guests"
  | "/manage/emails"
  | "/manage/settings"
  | "/manage/website"
  | "/manage/channels"
  | "/manage/team"
  | "/manage/units"
  | "/manage/packages"
  | "/manage/photos"
  | "/manage/pricing"
  | "/manage/policies"
  | "/manage/support"
  | "/manage/reports"
  | "/manage/setup";

export interface NavItem {
  key: NavKey;
  label: string;
  to: NavPath;
  group: NavGroupKey;
  /** בניווט התחתון בטלפון (השאר תחת "עוד") */
  primary?: boolean;
  permission?: string;
  /** מסכים נוספים ששייכים לפריט (מסומן גם בהם), לפי תחילת הנתיב */
  also?: readonly string[];
  /** מילים נוספות לחיפוש המהיר */
  keywords?: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    key: "dashboard",
    label: "לוח בקרה",
    to: "/manage",
    group: "operations",
    primary: true,
    keywords: "בית סיכום נתונים",
  },
  {
    key: "calendar",
    label: "יומן",
    to: "/manage/calendar",
    group: "operations",
    primary: true,
    permission: "bookings",
    keywords: "תפוסה לוח חסימה",
  },
  {
    key: "bookings",
    label: "הזמנות",
    to: "/manage/bookings",
    group: "operations",
    primary: true,
    permission: "bookings",
    also: ["/manage/bookings/"],
    keywords: "אישור בקשות ביטול",
  },
  {
    key: "units",
    label: "יחידות",
    to: "/manage/units",
    group: "place",
    primary: true,
    permission: "catalog",
    also: ["/manage/units/", "/manage/properties/", "/manage/room-types"],
    keywords: "חדרים צימרים מתחם סוויטה",
  },
  {
    key: "packages",
    label: "חבילות",
    to: "/manage/packages",
    group: "place",
    permission: "catalog",
    keywords: "חבילת כלה חבילה מיוחדת חבילת אירוח VIP",
  },
  {
    key: "photos",
    label: "תמונות",
    to: "/manage/photos",
    group: "place",
    permission: "media",
    keywords: "גלריה",
  },
  {
    key: "pricing",
    label: "מחירים",
    to: "/manage/pricing",
    group: "place",
    permission: "pricing",
    keywords: "תעריף עונה קופון",
  },
  {
    key: "policies",
    label: "מדיניות ביטול",
    to: "/manage/policies",
    group: "place",
    permission: "policies",
    keywords: "תנאים מקדמה",
  },
  {
    key: "guests",
    label: "אורחים",
    to: "/manage/guests",
    group: "operations",
    permission: "guests",
    also: ["/manage/guests/"],
    keywords: "לקוחות פרטיות",
  },
  {
    key: "reports",
    label: "דוחות",
    to: "/manage/reports",
    group: "operations",
    permission: "reports",
    keywords: "הכנסות תפוסה ייצוא אקסל CSV ביטולים יתרות",
  },
  {
    key: "emails",
    label: "מיילים",
    to: "/manage/emails",
    group: "site",
    permission: "bookings",
    keywords: "הודעות דואר",
  },
  {
    key: "channels",
    label: "ערוצי הזמנה",
    to: "/manage/channels",
    group: "site",
    permission: "bookings",
    keywords: "Airbnb Booking סנכרון",
  },
  {
    key: "website",
    label: "עיצוב האתר",
    to: "/manage/website",
    group: "site",
    permission: "settings",
    keywords: "עורך תבנית",
  },
  {
    key: "setup",
    label: "הקמת העסק",
    to: "/manage/setup",
    group: "account",
    permission: "settings",
    keywords: "התחלה צעדים מדריך אשף פרסום מוכן",
  },
  {
    key: "settings",
    label: "הגדרות העסק",
    to: "/manage/settings",
    group: "account",
    permission: "settings",
    keywords: "פרטים טלפון כתובת",
  },
  {
    key: "team",
    label: "צוות ניהול",
    to: "/manage/team",
    group: "account",
    permission: "staff.managers",
    keywords: "מנהלים הרשאות",
  },
  {
    key: "support",
    label: "תמיכה",
    to: "/manage/support",
    group: "account",
    permission: "settings",
    also: ["/manage/support/"],
    keywords: "עזרה פנייה שאלה תקלה צור קשר",
  },
];

export function visibleNav(permissions: Record<string, boolean>): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.permission || permissions[item.permission] === true);
}

/** הפריטים לפי קבוצות (בסדר הקבוצות); קבוצה ריקה לא מוצגת */
export function groupedNav(
  items: NavItem[],
): { key: NavGroupKey; title: string; items: NavItem[] }[] {
  return NAV_GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.group === g.key) })).filter(
    (g) => g.items.length > 0,
  );
}

/** הפריט מסומן כמסך הנוכחי: הנתיב שלו בדיוק, או מסך ששייך אליו (עמוד יחידה / מתחם) */
export function isNavActive(item: NavItem, pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (item.to === path) return true;
  return (item.also ?? []).some((prefix) => path.startsWith(prefix));
}

/** המסך הנוכחי (לכותרת בסרגל העליון) */
export function currentNav(items: readonly NavItem[], pathname: string): NavItem | null {
  return items.find((i) => isNavActive(i, pathname)) ?? null;
}

/** בטלפון: הפריטים הראשיים בשורה התחתונה, וכל השאר בתפריט "עוד" */
export function splitForMobile(items: NavItem[]): { bar: NavItem[]; more: NavItem[] } {
  return { bar: items.filter((i) => i.primary), more: items.filter((i) => !i.primary) };
}

/** "דנה כהן" → "דכ"; שם עסק בלי רווח → שתי האותיות הראשונות */
export function monogram(name: string): string {
  const parts = name
    .replace(/["׳״'.]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2);
  return parts[0]![0]! + parts[1]![0]!;
}
