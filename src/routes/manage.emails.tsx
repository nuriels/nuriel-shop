// מתאם נתיב (Hospitality): מיילים
import { createFileRoute } from "@tanstack/react-router";
import { EmailsPage } from "@/engines/hospitality/management/emails/EmailsPage";

export const Route = createFileRoute("/manage/emails")({
  head: () => ({ meta: [{ title: "מיילים" }] }),
  component: EmailsPage,
});
