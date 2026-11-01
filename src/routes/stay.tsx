// מתאם נתיב (Hospitality): האתר הציבורי של העסק — מעטפת, נתוני האתר (SSR) ושגיאות.
// כל הקוד ב-src/engines/hospitality/website. מוגש רק באתר אירוח שהאתר שלו פתוח.
import { createFileRoute } from "@tanstack/react-router";
import { siteLayoutRoute } from "@/engines/hospitality/website/routes";

export const Route = createFileRoute("/stay")(siteLayoutRoute);
