/**
 * חלק 33: תפקידים והרשאות לצוות החנות.
 *
 * מטריצת ההרשאות — מראה של staff_can() במסד (מיגרציה 20261019390000). המסד
 * הוא הקובע (RLS + בדיקה בכל פונקציה), השרת בודק שוב (requireStaffPermission
 * ב-caller.server.ts), והמסכים משתמשים בזה כדי להסתיר ממשקים שאין בהם צורך.
 *
 *   owner     — בעל החנות (המנהל המוגן): הכל.
 *   manager   — מנהל חנות: הכל חוץ מחבילה / תוספים / פרטי חיוב, ומינוי מנהלים.
 *   cashier   — קופאי: הקופה המהירה + צפייה במוצרים.
 *   warehouse — מחסנאי: מלאי, ליקוט, מדבקות ברקוד, סטטוס משלוח של הזמנות.
 *   agent     — סוכן מכירות (האזור שלו ב-/agent, כמו קודם).
 *
 * קובץ טהור — נטען גם בדפדפן וגם בשרת.
 */

export type StaffRole = "owner" | "manager" | "cashier" | "warehouse" | "agent";

export type StaffPermission =
  /** הקופה המהירה: יצירת הזמנה, חיפוש לקוח, מחיר ללקוח */
  | "pos"
  /** רשימת המוצרים (בלי מחיר עלות) */
  | "products.view"
  /** מלאי: בדיקת מלאי, העברות, מדבקות ברקוד */
  | "inventory"
  /** הזמנות למשלוח: ליקוט + עדכון סטטוס משלוח (בלי מחירים) */
  | "orders.fulfill"
  /** פאנל הניהול המלא: לוח בקרה, הזמנות, לקוחות, הגדרות */
  | "admin"
  /** ניהול הצוות: קופאים, מחסנאים, סוכנים */
  | "staff.manage"
  /** מינוי / הורדה / חסימה / מחיקה של מנהלים */
  | "staff.managers"
  /** חבילת ה-SaaS, תוספים ופרטי החיוב */
  | "billing.manage";

/** ההודעה בכל ניסיון גישה בלי הרשאה (ממשק + שרת) */
export const NO_PERMISSION_MESSAGE = "אין לך הרשאה מתאימה";

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  owner: "בעל החנות",
  manager: "מנהל חנות",
  cashier: "קופאי",
  warehouse: "מחסנאי",
  agent: "סוכן מכירות",
};

export const STAFF_ROLE_DESCRIPTION: Record<StaffRole, string> = {
  owner: "כל ההרשאות, כולל החבילה, התוספים ומינוי מנהלים",
  manager: "כל הניהול — חוץ משינוי החבילה, רכישת תוספים ומינוי מנהלים",
  cashier: "רק הקופה המהירה: יצירת הזמנות וצפייה במוצרים — בלי הכנסות והגדרות",
  warehouse: "מלאי, ליקוט, מדבקות ברקוד ועדכון סטטוס משלוח — בלי מחירים והכנסות",
  agent: "סוכן מכירות: הלקוחות וההזמנות שלו, באזור הסוכן",
};

/** התפקידים שאפשר לתת לעובד (בעל החנות — רק אחד, ולא משתנה מהמסך) */
export const ASSIGNABLE_STAFF_ROLES = ["manager", "cashier", "warehouse", "agent"] as const;
export type AssignableStaffRole = (typeof ASSIGNABLE_STAFF_ROLES)[number];

export function isAssignableStaffRole(value: unknown): value is AssignableStaffRole {
  return (ASSIGNABLE_STAFF_ROLES as readonly unknown[]).includes(value);
}

/** הערך בעמודה user_roles.role לתפקיד בצוות (מנהל = admin בלי הגנה) */
export function dbRoleForStaffRole(
  staffRole: AssignableStaffRole,
): "admin" | "cashier" | "warehouse" | "agent" {
  return staffRole === "manager" ? "admin" : staffRole;
}

/** התפקיד בצוות לפי השורה ב-user_roles (זהה ל-store_staff_role במסד) */
export function staffRoleOf(
  role: string | null | undefined,
  isProtected: boolean,
  isBlocked = false,
): StaffRole | null {
  if (isBlocked) return null;
  switch (role) {
    case "admin":
      return isProtected ? "owner" : "manager";
    case "cashier":
    case "warehouse":
    case "agent":
      return role;
    default:
      return null;
  }
}

/** האם לתפקיד יש את ההרשאה (זהה ל-staff_can במסד) */
export function staffCan(
  staffRole: StaffRole | null | undefined,
  permission: StaffPermission,
): boolean {
  switch (staffRole) {
    case "owner":
      return true;
    case "manager":
      return permission !== "billing.manage" && permission !== "staff.managers";
    case "cashier":
      return permission === "pos" || permission === "products.view";
    case "warehouse":
      return (
        permission === "products.view" ||
        permission === "inventory" ||
        permission === "orders.fulfill"
      );
    case "agent":
      return permission === "products.view";
    default:
      return false;
  }
}

/**
 * התפקיד של המשתמש המחובר (my_store_role.staff_role). מסד ישן בלי העמודה —
 * מנהל נחשב בעלים (כמו לפני חלק 33), כך ששום דבר לא ננעל לפני עדכון המסד.
 */
export function effectiveStaffRole(
  role: { role: string; staff_role?: StaffRole | null; is_blocked?: boolean } | null | undefined,
): StaffRole | null {
  if (!role) return null;
  if (role.staff_role !== undefined) return role.staff_role;
  return staffRoleOf(role.role === "admin" ? "admin" : role.role, true, role.is_blocked === true);
}

// ------------------------------------------------------------
// פאנל הניהול: מי רואה איזו לשונית (?tab=)
// ------------------------------------------------------------

type AdminTabRule = {
  permission: StaffPermission;
  /** מוצגת בתפריט רק לתפקידים האלה (הלשונית עצמה פתוחה לכל מי שיש לו ההרשאה) */
  navFor?: readonly StaffRole[];
};

/** ברירת מחדל ללשונית שלא ברשימה — פאנל הניהול המלא */
const DEFAULT_TAB_RULE: AdminTabRule = { permission: "admin" };

export const ADMIN_TAB_RULES: Record<string, AdminTabRule> = {
  dashboard: { permission: "admin" },
  orders: { permission: "admin" },
  pos: { permission: "pos" },
  inbox: { permission: "admin" },
  users: { permission: "admin" },
  "custom-prices": { permission: "admin" },
  performance: { permission: "admin" },
  products: { permission: "admin" },
  categories: { permission: "admin" },
  stock: { permission: "admin" },
  labels: { permission: "inventory" },
  // חלק 35: מספרים סידוריים — מחסנאי, מנהל ובעלים
  serials: { permission: "inventory" },
  transfers: { permission: "inventory" },
  pending: { permission: "admin" },
  promotions: { permission: "admin" },
  coupons: { permission: "admin" },
  abandoned: { permission: "admin" },
  // חלק 34: אישור ביקורות לקוחות — בעלים ומנהל בלבד
  reviews: { permission: "admin" },
  shipping: { permission: "admin" },
  home: { permission: "admin" },
  site: { permission: "admin" },
  legal: { permission: "admin" },
  pages: { permission: "admin" },
  marketing: { permission: "admin" },
  email: { permission: "admin" },
  domain: { permission: "admin" },
  staff: { permission: "staff.manage" },
  addons: { permission: "admin" },
  billing: { permission: "admin" },
  support: { permission: "admin" },
  // המסכים של המחסנאי — למנהלים יש את המקבילים המלאים ("הזמנות", "ספירת מלאי")
  picking: { permission: "orders.fulfill", navFor: ["warehouse"] },
  fulfillment: { permission: "orders.fulfill", navFor: ["warehouse"] },
  "stock-check": { permission: "inventory", navFor: ["warehouse"] },
};

/** מותר לפתוח את הלשונית? (גם בכתובת ישירה) */
export function canOpenAdminTab(staffRole: StaffRole | null | undefined, tab: string): boolean {
  const rule = ADMIN_TAB_RULES[tab] ?? DEFAULT_TAB_RULE;
  return staffCan(staffRole, rule.permission);
}

/** מוצגת בתפריט הצד? */
export function showAdminTabInNav(staffRole: StaffRole | null | undefined, tab: string): boolean {
  const rule = ADMIN_TAB_RULES[tab] ?? DEFAULT_TAB_RULE;
  if (!staffCan(staffRole, rule.permission)) return false;
  return !rule.navFor || (staffRole != null && rule.navFor.includes(staffRole));
}

/** מי נכנס לפאנל הניהול (/admin). סוכן — לאזור הסוכן, כמו קודם */
export function canEnterAdmin(staffRole: StaffRole | null | undefined): boolean {
  return (
    staffRole === "owner" ||
    staffRole === "manager" ||
    staffRole === "cashier" ||
    staffRole === "warehouse"
  );
}

/** המסך הראשון של כל תפקיד בפאנל: קופאי — הקופה; מחסנאי — הליקוט */
export function adminHomeTab(staffRole: StaffRole | null | undefined): string {
  if (staffRole === "cashier") return "pos";
  if (staffRole === "warehouse") return "picking";
  return "dashboard";
}

/**
 * שינוי תפקיד של עובד — אותם כללים כמו store_set_staff_role במסד.
 * מחזיר הודעת שגיאה, או null כשמותר.
 */
export function staffRoleChangeProblem(input: {
  actor: StaffRole | null | undefined;
  actorId: string;
  targetId: string;
  from: StaffRole | null;
  to: AssignableStaffRole;
}): string | null {
  const { actor, actorId, targetId, from, to } = input;
  if (!staffCan(actor, "staff.manage")) return NO_PERMISSION_MESSAGE;
  if (from === "owner") return "אי אפשר לשנות את התפקיד של בעל החנות";
  if (actorId === targetId) return "אי אפשר לשנות את התפקיד של עצמך";
  if (from === to) return null;
  if ((from === "manager" || to === "manager") && !staffCan(actor, "staff.managers")) {
    return "רק בעל החנות יכול למנות מנהלים או לשנות תפקיד של מנהל";
  }
  return null;
}
