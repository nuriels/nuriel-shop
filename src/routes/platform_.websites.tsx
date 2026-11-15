// מתאם נתיב (Nuriel Websites): "אתרי אינטרנט" בפאנל הפלטפורמה — בכתובת הפאנל בלבד
import { createFileRoute } from "@tanstack/react-router";
import { PlatformWebsitesPage } from "@/engines/business-profile/platform-admin/PlatformWebsitesPage";
import { SITE_STYLE_LINKS } from "@/engines/business-profile/site/page-head";

export const Route = createFileRoute("/platform_/websites")({
  ssr: false,
  head: () => ({
    meta: [{ title: "אתרי אינטרנט (Nuriel Websites)" }, { name: "robots", content: "noindex" }],
    // התצוגה המקדימה של בקשת הפרסום — אותו עיצוב של האתר
    links: SITE_STYLE_LINKS,
  }),
  component: PlatformWebsitesPage,
});
