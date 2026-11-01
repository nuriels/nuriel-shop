// מתאם נתיב (Hospitality): עמוד הזמנה
import { createFileRoute } from "@tanstack/react-router";
import { BookingPage } from "@/engines/hospitality/management/bookings/BookingPage";

export const Route = createFileRoute("/manage/bookings_/$bookingId")({
  head: () => ({ meta: [{ title: "הזמנה" }] }),
  component: BookingPage,
});
