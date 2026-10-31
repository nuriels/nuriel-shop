// מתאם נתיב (Hospitality): צוות הניהול (לבעלים בלבד)
import { createFileRoute } from "@tanstack/react-router";
import { TeamPage } from "@/engines/hospitality/management/team/TeamPage";

export const Route = createFileRoute("/manage/team")({
  head: () => ({ meta: [{ title: "צוות ניהול" }] }),
  component: TeamPage,
});
