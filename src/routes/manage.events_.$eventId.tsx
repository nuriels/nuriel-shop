// מתאם נתיב (Hospitality): עמוד אירוע
import { createFileRoute } from "@tanstack/react-router";
import { EventPage } from "@/engines/hospitality/management/events/EventPage";

export const Route = createFileRoute("/manage/events_/$eventId")({
  head: () => ({ meta: [{ title: "אירוע" }] }),
  component: EventPage,
});
