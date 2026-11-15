// מתאם נתיב (Nuriel Websites): ממשק הניהול של בעל העסק — רק באתר עסק שהמנוע פעיל בו (השער + ה-root)
import { createFileRoute } from "@tanstack/react-router";
import { StudioLayout } from "@/engines/business-profile/studio/StudioLayout";
import {
  businessSiteOnly,
  STUDIO_HEAD,
  STUDIO_HEADERS,
} from "@/engines/business-profile/studio/route-guard";

export const Route = createFileRoute("/studio")({
  ssr: false,
  beforeLoad: businessSiteOnly,
  head: () => STUDIO_HEAD("ניהול האתר"),
  headers: () => STUDIO_HEADERS,
  component: StudioLayout,
});
