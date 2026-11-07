// מתאם נתיב (Hospitality): חבילות אירוח וחבילות מיוחדות (שלב א' 7)
import { createFileRoute } from "@tanstack/react-router";
import { PackagesPage } from "@/engines/hospitality/management/packages/PackagesPage";

export const Route = createFileRoute("/manage/packages")({
  head: () => ({ meta: [{ title: "חבילות" }] }),
  component: PackagesPage,
});
