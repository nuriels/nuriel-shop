// מתאם נתיב (Hospitality): עיצוב האתר — העורך של בעל העסק
import { createFileRoute } from "@tanstack/react-router";
import { WebsiteEditorPage } from "@/engines/hospitality/management/website/WebsiteEditorPage";

export const Route = createFileRoute("/manage/website")({
  head: () => ({ meta: [{ title: "עיצוב האתר" }] }),
  component: WebsiteEditorPage,
});
