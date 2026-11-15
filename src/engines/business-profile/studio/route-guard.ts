// נתיבי ממשק הניהול קיימים רק באתר עסק: בכל אתר אחר (חנות, צימר) — "לא נמצא"
import { notFound, rootRouteId } from "@tanstack/react-router";

export function businessSiteOnly({ context }: { context: { hostMode: { siteType: string } } }) {
  if (context.hostMode.siteType !== "business_profile") throw notFound({ routeId: rootRouteId });
}

export const STUDIO_HEAD = (title: string) => ({
  meta: [{ title }, { name: "robots", content: "noindex, nofollow" }],
});

/** כותרות אבטחה לממשק הניהול: בלי מסגור מאתרים אחרים, בלי מטמון */
export const STUDIO_HEADERS = {
  "X-Frame-Options": "SAMEORIGIN",
  "Cache-Control": "no-store",
  "Referrer-Policy": "same-origin",
};
