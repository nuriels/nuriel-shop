// מתאם נתיב (Hospitality): יחידות ומתחמים
import { createFileRoute } from "@tanstack/react-router";
import { CatalogPage } from "@/engines/hospitality/management/catalog/CatalogPage";

export const Route = createFileRoute("/manage/units")({
  head: () => ({ meta: [{ title: "יחידות ומתחמים" }] }),
  component: CatalogPage,
});
