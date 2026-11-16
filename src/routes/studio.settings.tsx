// מתאם נתיב (Nuriel Websites): "הגדרות האתר" — כתובת האתר, דומיין אישי ותצוגת גוגל (מיגרציה 197)
import { createFileRoute } from "@tanstack/react-router";
import { StudioSettings } from "@/engines/business-profile/studio/StudioSettings";

export const Route = createFileRoute("/studio/settings")({
  component: StudioSettings,
});
