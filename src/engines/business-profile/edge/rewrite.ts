// מיפוי הכתובות של הנתב — באתר עסק בלבד (Nuriel Websites, החלטה 1): הגולש רואה "/" ו-"/about",
// והנתב מגיש את הנתיבים הפנימיים "/bp-site" ו-"/bp-site/about". כך עמודי האתר יושבים בשורש בלי
// לגעת בנתיבים של החנויות ("/", "/about", "/contact" של חנות לא משתנים) ובלי להפנות.
// לא מופעל בשום אתר אחר: router.tsx מוסיף אותו רק כשסוג האתר של הבקשה הוא business_profile.
// ממשק הניהול (/studio), הכניסה (/admin-handoff), הנחיתה הישנה (/admin) ופונקציות השרת — בלי מיפוי.
import { SITE_ROUTE_PREFIX } from "../config";

const PASS_THROUGH = /^\/(studio|admin-handoff|admin|_serverFn)(\/|$)/;

export function toInternalPath(pathname: string): string {
  if (PASS_THROUGH.test(pathname)) return pathname;
  return pathname === "/" ? SITE_ROUTE_PREFIX : `${SITE_ROUTE_PREFIX}${pathname}`;
}

export function toPublicPath(pathname: string): string {
  if (pathname === SITE_ROUTE_PREFIX || pathname === `${SITE_ROUTE_PREFIX}/`) return "/";
  if (pathname.startsWith(`${SITE_ROUTE_PREFIX}/`)) return pathname.slice(SITE_ROUTE_PREFIX.length);
  return pathname;
}

/** זוג המיפוי לנתב (TanStack Router `rewrite`) */
export const businessProfileRewrite = {
  input: ({ url }: { url: URL }) => {
    const next = new URL(url.href);
    next.pathname = toInternalPath(url.pathname);
    return next;
  },
  output: ({ url }: { url: URL }) => {
    const next = new URL(url.href);
    next.pathname = toPublicPath(url.pathname);
    return next;
  },
};
