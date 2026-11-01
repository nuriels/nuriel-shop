// מתאם נתיב (Hospitality): האתר הציבורי — מדיניות פרטיות (טיוטה)
import { createFileRoute } from "@tanstack/react-router";
import { sitePrivacyRoute } from "@/engines/hospitality/website/routes";

export const Route = createFileRoute("/stay/privacy")(sitePrivacyRoute);
