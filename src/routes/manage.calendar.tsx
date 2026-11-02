// מתאם נתיב (Hospitality): היומן — לוח התפוסה והחסימות (?unit= — היומן של יחידה אחת;
// ?block=1 — פותח את חסימת התאריכים, מלוח הבקרה; ?open=1 — פתיחת תאריכים להזמנה, מלוח הבקרה
// ומהמייל — מיגרציה 43)
import { createFileRoute } from "@tanstack/react-router";
import { CalendarPage } from "@/engines/hospitality/management/calendar/CalendarPage";

export const Route = createFileRoute("/manage/calendar")({
  head: () => ({ meta: [{ title: "יומן" }] }),
  validateSearch: (s: Record<string, unknown>): { unit?: string; block?: "1"; open?: "1" } => ({
    ...(typeof s["unit"] === "string" ? { unit: s["unit"] } : {}),
    ...(s["block"] === "1" || s["block"] === 1 ? { block: "1" as const } : {}),
    ...(s["open"] === "1" || s["open"] === 1 ? { open: "1" as const } : {}),
  }),
  component: CalendarPage,
});
