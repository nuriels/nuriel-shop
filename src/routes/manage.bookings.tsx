// מתאם נתיב (Hospitality): הזמנות — רשימה לפי לשונית
import { createFileRoute } from "@tanstack/react-router";
import { BookingsPage } from "@/engines/hospitality/management/bookings/BookingsPage";

export const Route = createFileRoute("/manage/bookings")({
  head: () => ({ meta: [{ title: "הזמנות" }] }),
  component: BookingsPage,
});
