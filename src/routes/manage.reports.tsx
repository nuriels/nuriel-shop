// מתאם נתיב (Hospitality): דוחות וייצוא (?preset / from / to / unit / source / status)
import { createFileRoute } from "@tanstack/react-router";
import { ReportsPage } from "@/engines/hospitality/management/reports/ReportsPage";
import { parseReportsSearch } from "@/engines/hospitality/management/reports/model";

export const Route = createFileRoute("/manage/reports")({
  head: () => ({ meta: [{ title: "דוחות" }] }),
  validateSearch: parseReportsSearch,
  component: ReportsPage,
});
