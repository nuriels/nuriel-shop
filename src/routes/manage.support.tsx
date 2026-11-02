// מתאם נתיב (Hospitality): תמיכה (?new=1 — פנייה חדשה, למשל מהחיפוש המהיר)
import { createFileRoute } from "@tanstack/react-router";
import { SupportPage } from "@/engines/hospitality/management/support/SupportPage";
import { parseSupportSearch } from "@/engines/hospitality/management/support/model";

export const Route = createFileRoute("/manage/support")({
  head: () => ({ meta: [{ title: "תמיכה" }] }),
  validateSearch: parseSupportSearch,
  component: SupportPage,
});
