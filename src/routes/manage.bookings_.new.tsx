// מתאם נתיב (Hospitality): הוספת הזמנה (?unit=&from=&to= — מהיומן)
import { createFileRoute } from "@tanstack/react-router";
import { NewBookingPage } from "@/engines/hospitality/management/bookings/NewBookingPage";

export const Route = createFileRoute("/manage/bookings_/new")({
  head: () => ({ meta: [{ title: "הוספת הזמנה" }] }),
  validateSearch: (s: Record<string, unknown>): { unit?: string; from?: string; to?: string } => ({
    ...(typeof s["unit"] === "string" ? { unit: s["unit"] } : {}),
    ...(typeof s["from"] === "string" ? { from: s["from"] } : {}),
    ...(typeof s["to"] === "string" ? { to: s["to"] } : {}),
  }),
  component: NewBookingPage,
});
