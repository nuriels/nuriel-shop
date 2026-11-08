// מתאם נתיב (Hospitality): אירועים במתחם (בלי לינה) — רשימה
import { createFileRoute } from "@tanstack/react-router";
import { EventsPage } from "@/engines/hospitality/management/events/EventsPage";

export const Route = createFileRoute("/manage/events")({
  head: () => ({ meta: [{ title: "אירועים" }] }),
  component: EventsPage,
});
