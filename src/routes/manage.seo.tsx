// מתאם נתיב (Hospitality): SEO וגוגל — NURIEL AI SEO ENGINE
import { createFileRoute } from "@tanstack/react-router";
import { SeoPage } from "@/engines/hospitality/management/seo/SeoPage";

export const Route = createFileRoute("/manage/seo")({
  head: () => ({ meta: [{ title: "SEO וגוגל" }] }),
  component: SeoPage,
});
