// מתאם נתיב (Hospitality): היומן — לוח התפוסה והחסימות (?unit= — היומן של יחידה אחת;
// ?block=1 — פותח את חסימת התאריכים, מלוח הבקרה)
import { createFileRoute } from "@tanstack/react-router";
import { CalendarPage } from "@/engines/hospitality/management/calendar/CalendarPage";

export const Route = createFileRoute("/manage/calendar")({
  head: () => ({ meta: [{ title: "יומן" }] }),
  validateSearch: (s: Record<string, unknown>): { unit?: string; block?: "1" } => ({
    ...(typeof s["unit"] === "string" ? { unit: s["unit"] } : {}),
    ...(s["block"] === "1" || s["block"] === 1 ? { block: "1" as const } : {}),
  }),
  component: CalendarPage,
});
