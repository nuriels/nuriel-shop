// מתאם נתיב (Hospitality): היומן — לוח התפוסה והחסימות (?unit= — היומן של יחידה אחת)
import { createFileRoute } from "@tanstack/react-router";
import { CalendarPage } from "@/engines/hospitality/management/calendar/CalendarPage";

export const Route = createFileRoute("/manage/calendar")({
  head: () => ({ meta: [{ title: "יומן" }] }),
  validateSearch: (s: Record<string, unknown>): { unit?: string } =>
    typeof s["unit"] === "string" ? { unit: s["unit"] } : {},
  component: CalendarPage,
});
