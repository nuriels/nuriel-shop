// מתאם נתיב (Hospitality): לוח הבקרה של אזור הניהול (?period= / ?period=custom&from=&to=)
import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/engines/hospitality/management/dashboard/Dashboard";
import { parseDashboardSearch } from "@/engines/hospitality/management/dashboard/model";

export const Route = createFileRoute("/manage/")({
  validateSearch: parseDashboardSearch,
  component: Dashboard,
});
