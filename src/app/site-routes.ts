// שורש ההרכבה — ניווט לפי סוג האתר (Stage 2a): באתר של מנוע אחר, נתיב שהמנוע
// לא מגיש מופנה. רק בחירה לפי סוג האתר; הכלל עצמו במנוע.
import type { SiteType } from "@/platform/engines/contract";
import { clientRouteRedirect } from "@/engines/hospitality/edge/paths";

/** לאן להפנות נתיב בדפדפן (null = מותר) */
export function engineRouteRedirect(siteType: SiteType, pathname: string): string | null {
  return siteType === "hospitality" ? clientRouteRedirect(pathname) : null;
}
