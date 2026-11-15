// מתאם נתיב (Nuriel Websites): התצוגה המקדימה של הטיוטה — עמוד מלא בלי מעטפת הניהול (נטען בתוך העורך,
// במסגרת בגודל מחשב / נייד). רק למחוברים עם הרשאה באתר הזה; noindex; לא נשמר במטמון.
import { createFileRoute } from "@tanstack/react-router";
import { DraftPreview } from "@/engines/business-profile/studio/DraftPreview";
import { SITE_STYLE_LINKS } from "@/engines/business-profile/site/page-head";
import { businessSiteOnly, STUDIO_HEADERS } from "@/engines/business-profile/studio/route-guard";

export const Route = createFileRoute("/studio_/preview")({
  ssr: false,
  beforeLoad: businessSiteOnly,
  head: () => ({
    meta: [{ title: "תצוגה מקדימה" }, { name: "robots", content: "noindex, nofollow" }],
    links: SITE_STYLE_LINKS,
  }),
  headers: () => STUDIO_HEADERS,
  component: DraftPreview,
});
