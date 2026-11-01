// מתאם נתיב (Hospitality): התצוגה המקדימה של עורך האתר (בתוך iframe; לצוות המחובר בלבד)
import { createFileRoute } from "@tanstack/react-router";
import { sitePreviewRoute } from "@/engines/hospitality/website/routes";

export const Route = createFileRoute("/manage_/preview")(sitePreviewRoute);
