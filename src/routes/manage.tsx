// מתאם נתיב (Hospitality): אזור הניהול של בעל העסק. כל הקוד (כולל כותרות האבטחה) ב-
// src/engines/hospitality/management. מוגש רק באתר אירוח שאזור הניהול פעיל בו
// (שער המנוע ב-src/server.ts + ה-root).
import { createFileRoute } from "@tanstack/react-router";
import { manageLayoutRoute } from "@/engines/hospitality/management/routes";

export const Route = createFileRoute("/manage")(manageLayoutRoute);
