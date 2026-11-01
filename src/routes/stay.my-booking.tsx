// מתאם נתיב (Hospitality): האתר הציבורי — ההזמנה שלי (קישור מאובטח)
import { createFileRoute } from "@tanstack/react-router";
import { siteMyBookingRoute } from "@/engines/hospitality/website/routes";

export const Route = createFileRoute("/stay/my-booking")(siteMyBookingRoute);
