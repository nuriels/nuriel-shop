// מתאם נתיב (Hospitality): עמוד סוג חדר באתר הציבורי (מלונות)
import { createFileRoute } from "@tanstack/react-router";
import { siteRoomTypeRoute } from "@/engines/hospitality/website/routes";

export const Route = createFileRoute("/stay/rooms/$typeSlug")(siteRoomTypeRoute);
