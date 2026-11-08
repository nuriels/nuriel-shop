// מתאם נתיב (Hospitality): מסמכי לקוחות — חוזים לחתימה (?tab=send|archive|terms, ?booking= / ?event=)
import { createFileRoute } from "@tanstack/react-router";
import { ClientDocumentsPage } from "@/engines/hospitality/management/client-documents/ClientDocumentsPage";
import { parseClientDocsSearch } from "@/engines/hospitality/management/client-documents/model";

export const Route = createFileRoute("/manage/client-documents")({
  head: () => ({ meta: [{ title: "מסמכי לקוחות" }] }),
  validateSearch: parseClientDocsSearch,
  component: ClientDocumentsPage,
});
