// מתאם נתיב (Hospitality): מדריך הקמת העסק — צעדים, אבני דרך והמשך מאותה נקודה
import { createFileRoute } from "@tanstack/react-router";
import { SetupPage } from "@/engines/hospitality/management/setup/SetupPage";

export const Route = createFileRoute("/manage/setup")({
  head: () => ({ meta: [{ title: "הקמת העסק" }] }),
  component: SetupPage,
});
