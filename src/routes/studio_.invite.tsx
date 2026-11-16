// מתאם נתיב (Nuriel Websites): מסך ההזמנה של בעלת האתר (מיגרציה 198) — בלי מעטפת הניהול, בלי SSR (הטוקן ב-fragment),
// noindex, בלי מטמון ובלי מסגור.
import { createFileRoute } from "@tanstack/react-router";
import { OwnerInvite } from "@/engines/business-profile/studio/OwnerInvite";
import { businessSiteOnly, STUDIO_HEADERS } from "@/engines/business-profile/studio/route-guard";

export const Route = createFileRoute("/studio_/invite")({
  ssr: false,
  beforeLoad: businessSiteOnly,
  head: () => ({
    meta: [{ title: "פתיחת חשבון לניהול האתר" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  headers: () => STUDIO_HEADERS,
  component: OwnerInvite,
});
