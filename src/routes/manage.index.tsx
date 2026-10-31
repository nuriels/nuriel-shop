// מתאם נתיב (Hospitality): לוח הבקרה של אזור הניהול
import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/engines/hospitality/management/dashboard/Dashboard";

export const Route = createFileRoute("/manage/")({
  component: Dashboard,
});
