// מתאם נתיב (Hospitality): פנייה לתמיכה
import { createFileRoute } from "@tanstack/react-router";
import { TicketPage } from "@/engines/hospitality/management/support/TicketPage";

export const Route = createFileRoute("/manage/support_/$ticketId")({
  head: () => ({ meta: [{ title: "פנייה לתמיכה" }] }),
  component: TicketPage,
});
