// מתאם נתיב (Nuriel Websites): "תיק האתר" בפאנל הפלטפורמה — בכתובת הפאנל בלבד (מיגרציה 197)
import { createFileRoute } from "@tanstack/react-router";
import { PlatformSiteFile } from "@/engines/business-profile/platform-admin/PlatformSiteFile";
import { SITE_STYLE_LINKS } from "@/engines/business-profile/site/page-head";

export const Route = createFileRoute("/platform_/websites_/$tenantId")({
  ssr: false,
  head: () => ({
    meta: [{ title: "תיק האתר (Nuriel Websites)" }, { name: "robots", content: "noindex" }],
    // התצוגה המקדימה של בקשת הפרסום — אותו עיצוב של האתר
    links: SITE_STYLE_LINKS,
  }),
  component: SiteFilePage,
});

function SiteFilePage() {
  const { tenantId } = Route.useParams();
  return <PlatformSiteFile tenantId={tenantId} />;
}
