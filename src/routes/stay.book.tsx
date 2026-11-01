// מתאם נתיב (Hospitality): האתר הציבורי — עמוד ההזמנה
import { createFileRoute } from "@tanstack/react-router";
import { siteBookRoute } from "@/engines/hospitality/website/routes";

export const Route = createFileRoute("/stay/book")(siteBookRoute);
