// מתאם נתיב (Hospitality): האתר הציבורי — הבקשה התקבלה
import { createFileRoute } from "@tanstack/react-router";
import { siteReceivedRoute } from "@/engines/hospitality/website/routes";

export const Route = createFileRoute("/stay/booking-received")(siteReceivedRoute);
