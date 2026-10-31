// מתאם נתיב (Hospitality): הגדרות העסק
import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "@/engines/hospitality/management/settings/SettingsPage";

export const Route = createFileRoute("/manage/settings")({
  head: () => ({ meta: [{ title: "הגדרות העסק" }] }),
  component: SettingsPage,
});
