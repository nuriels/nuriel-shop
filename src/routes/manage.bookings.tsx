// מתאם נתיב (Hospitality): הזמנות — רשימה לפי לשונית (?tab= — קישור ישיר ללשונית, מלוח הבקרה)
import { createFileRoute } from "@tanstack/react-router";
import { BookingsPage } from "@/engines/hospitality/management/bookings/BookingsPage";
import { parseBookingsSearch } from "@/engines/hospitality/management/bookings/model";

export const Route = createFileRoute("/manage/bookings")({
  head: () => ({ meta: [{ title: "הזמנות" }] }),
  validateSearch: parseBookingsSearch,
  component: BookingsPage,
});
