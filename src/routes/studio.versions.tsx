// מתאם נתיב (Nuriel Websites): "גרסאות" — היסטוריה ושחזור
import { createFileRoute } from "@tanstack/react-router";
import { StudioVersions } from "@/engines/business-profile/studio/StudioVersions";

export const Route = createFileRoute("/studio/versions")({ component: StudioVersions });
