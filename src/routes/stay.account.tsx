// מתאם נתיב (Hospitality): האתר הציבורי — "ההזמנות שלי" (כניסה בקוד למייל)
import { createFileRoute } from "@tanstack/react-router";
import { siteAccountRoute } from "@/engines/hospitality/website/routes";

export const Route = createFileRoute("/stay/account")(siteAccountRoute);
