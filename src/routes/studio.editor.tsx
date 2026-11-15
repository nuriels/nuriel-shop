// מתאם נתיב (Nuriel Websites): "עריכת האתר" — העורך והתצוגה המקדימה (מחשב / נייד)
import { createFileRoute } from "@tanstack/react-router";
import { StudioEditor } from "@/engines/business-profile/studio/StudioEditor";

export const Route = createFileRoute("/studio/editor")({ component: StudioEditor });
