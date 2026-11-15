// מתאם נתיב (Nuriel Websites): "סקירה ופרסום"
import { createFileRoute } from "@tanstack/react-router";
import { StudioOverview } from "@/engines/business-profile/studio/StudioOverview";

export const Route = createFileRoute("/studio/")({ component: StudioOverview });
