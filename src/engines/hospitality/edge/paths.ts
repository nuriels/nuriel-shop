// הנתיבים של אזור הניהול באתר אירוח — משותף לשער העמודים (שרת, import דינמי)
// ולניווט בדפדפן (שורש ההרכבה). קובץ קטן בלי תלויות, כדי ששער השרת לא ייכנס
// לבאנדל של ה-root.
import { MANAGE_PATH } from "../config";

const MANAGE_AREA = new RegExp(`^${MANAGE_PATH}(/|$)`);
const HANDOFF_PATH = "/admin-handoff";
/** כתובת הנחיתה של ה-handoff הקיים (/admin) — באתר אירוח מופנית ל-/manage */
export const ADMIN_LANDING = /^\/admin\/?$/;

/** הנתיבים שאזור הניהול מגיש באתר אירוח */
export function isManagementPath(pathname: string): boolean {
  return MANAGE_AREA.test(pathname) || pathname === HANDOFF_PATH;
}

/**
 * ניווט בתוך האפליקציה (בדפדפן) באתר אירוח: כל נתיב שאינו של אזור הניהול → /manage
 * (למשל הנחיתה של ה-handoff הקיים ב-/admin). null = הנתיב מותר.
 */
export function clientRouteRedirect(pathname: string): string | null {
  return isManagementPath(pathname) ? null : MANAGE_PATH;
}
