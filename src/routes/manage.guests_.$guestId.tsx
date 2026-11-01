// מתאם נתיב (Hospitality): כרטיס אורח
import { createFileRoute } from "@tanstack/react-router";
import { GuestPage } from "@/engines/hospitality/management/guests/GuestPage";

export const Route = createFileRoute("/manage/guests_/$guestId")({
  head: () => ({ meta: [{ title: "אורח" }] }),
  component: GuestPage,
});
