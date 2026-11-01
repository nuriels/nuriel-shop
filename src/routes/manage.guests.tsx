// מתאם נתיב (Hospitality): אורחים
import { createFileRoute } from "@tanstack/react-router";
import { GuestsPage } from "@/engines/hospitality/management/guests/GuestsPage";

export const Route = createFileRoute("/manage/guests")({
  head: () => ({ meta: [{ title: "אורחים" }] }),
  component: GuestsPage,
});
