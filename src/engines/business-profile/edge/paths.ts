// הנתיבים של אתר עסק — משותף לשער העמודים (שרת), למיפוי הכתובות של הנתב ולניווט בדפדפן.
// קובץ קטן בלי תלויות, כדי שהשער והנתב לא יגררו קוד של המנוע לבאנדל של ה-root.
import { SITE_ROUTE_PREFIX, STUDIO_PATH } from "../config";

const STUDIO_AREA = new RegExp(`^${STUDIO_PATH}(/|$)`);
const INTERNAL_AREA = new RegExp(`^${SITE_ROUTE_PREFIX}(/|$)`);
export const HANDOFF_PATH = "/admin-handoff";
/** כתובת הנחיתה של ה-handoff הקיים (/admin) — באתר עסק מופנית ל-/studio */
export const ADMIN_LANDING = /^\/admin\/?$/;

/** ממשק הניהול והכניסה אליו */
export function isStudioPath(pathname: string): boolean {
  return STUDIO_AREA.test(pathname) || pathname === HANDOFF_PATH;
}

/** הקידומת הפנימית של הנתב — לא כתובת ציבורית (בשער: 404) */
export function isInternalSitePath(pathname: string): boolean {
  return INTERNAL_AREA.test(pathname);
}

/**
 * כתובת של עמוד באתר: "/" או שם עמוד (אותיות קטנות באנגלית, ספרות ומקפים; גם בעברית — בקידוד
 * URL), עד שתי רמות (למשל /services/editing). כל השאר (קבצים, נתיבים של החנויות) — לא.
 */
const PAGE_SEGMENT =
  "(?:[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?|(?:%[0-9A-Fa-f]{2}|[a-z0-9-]){1,180})";
const PAGE_PATH = new RegExp(`^/(?:${PAGE_SEGMENT}(?:/${PAGE_SEGMENT})?/?)?$`);

export function isPublicPagePath(pathname: string): boolean {
  return PAGE_PATH.test(pathname) && !isStudioPath(pathname) && !isInternalSitePath(pathname);
}

/**
 * ניווט בתוך האפליקציה (בדפדפן) באתר עסק — הנתיב הפנימי של הנתב (אחרי המיפוי): עמודי האתר,
 * ממשק הניהול והכניסה מותרים; /admin (הנחיתה של ה-handoff) → /studio; כל השאר → דף הבית.
 * null = הנתיב מותר.
 */
export function clientRouteRedirect(pathname: string): string | null {
  if (isStudioPath(pathname) || isInternalSitePath(pathname)) return null;
  if (ADMIN_LANDING.test(pathname)) return STUDIO_PATH;
  return "/";
}
