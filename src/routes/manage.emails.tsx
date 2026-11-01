// מתאם נתיב (Hospitality): מיילים (?filter=failed — קישור ישיר מלוח הבקרה)
import { createFileRoute } from "@tanstack/react-router";
import { EmailsPage } from "@/engines/hospitality/management/emails/EmailsPage";
import { parseEmailsSearch } from "@/engines/hospitality/management/emails/model";

export const Route = createFileRoute("/manage/emails")({
  head: () => ({ meta: [{ title: "מיילים" }] }),
  validateSearch: parseEmailsSearch,
  component: EmailsPage,
});
