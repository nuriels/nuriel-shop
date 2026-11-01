// מתאם נתיב (Hospitality): האתר הציבורי — הצהרת נגישות (טיוטה)
import { createFileRoute } from "@tanstack/react-router";
import { siteAccessibilityRoute } from "@/engines/hospitality/website/routes";

export const Route = createFileRoute("/stay/accessibility")(siteAccessibilityRoute);
