// מתאם נתיב (Hospitality): סוגי חדרים (מלונות)
import { createFileRoute } from "@tanstack/react-router";
import { RoomTypesPage } from "@/engines/hospitality/management/catalog/RoomTypesPage";

export const Route = createFileRoute("/manage/room-types")({
  head: () => ({ meta: [{ title: "סוגי חדרים" }] }),
  component: RoomTypesPage,
});
