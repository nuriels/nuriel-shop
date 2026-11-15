// מתאם נתיב (Nuriel Websites): האתר הציבורי של עסק. הגולש רואה "/" ו-"/<עמוד>" — הנתב ממפה אותם לכאן
// רק באתר עסק (src/app/site-router.ts). בכל אתר אחר — "לא נמצא". הנתונים: הגרסה המפורסמת בלבד (SSR).
import { createFileRoute, notFound, Outlet, rootRouteId } from "@tanstack/react-router";
import { businessPublicSite } from "@/engines/business-profile/api/site.functions";
import { SITE_STYLE_LINKS } from "@/engines/business-profile/site/page-head";
import { BusinessNotFound } from "@/engines/business-profile/site/BusinessPage";

export const Route = createFileRoute("/bp-site")({
  beforeLoad: ({ context }) => {
    // בכל אתר אחר — עמוד ה-404 של האתר עצמו (ה-root), לא של אתרי העסקים
    if (context.hostMode.siteType !== "business_profile") throw notFound({ routeId: rootRouteId });
  },
  loader: async () => {
    const site = await businessPublicSite();
    if (!site) throw notFound();
    return site;
  },
  staleTime: 30_000,
  head: () => ({ links: SITE_STYLE_LINKS }),
  component: Outlet,
  notFoundComponent: BusinessNotFound,
});
