// מתאם נתיב (Hospitality): מדיניות ביטול
import { createFileRoute } from "@tanstack/react-router";
import { PoliciesPage } from "@/engines/hospitality/management/pricing/PoliciesPage";

export const Route = createFileRoute("/manage/policies")({
  head: () => ({ meta: [{ title: "מדיניות ביטול" }] }),
  component: PoliciesPage,
});
