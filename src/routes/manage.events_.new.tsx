// מתאם נתיב (Hospitality): אירוע חדש
import { createFileRoute } from "@tanstack/react-router";
import { NewEventPage } from "@/engines/hospitality/management/events/NewEventPage";

export const Route = createFileRoute("/manage/events_/new")({
  head: () => ({ meta: [{ title: "אירוע חדש" }] }),
  component: NewEventPage,
});
