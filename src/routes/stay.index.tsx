// מתאם נתיב (Hospitality): עמוד הבית של האתר הציבורי
import { createFileRoute } from "@tanstack/react-router";
import { siteHomeRoute } from "@/engines/hospitality/website/routes";

export const Route = createFileRoute("/stay/")(siteHomeRoute);
