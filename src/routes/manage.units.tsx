// מתאם נתיב (Hospitality): יחידות ומתחמים (?add=unit — פותח את הוספת היחידה, מלוח הבקרה)
import { createFileRoute } from "@tanstack/react-router";
import { CatalogPage } from "@/engines/hospitality/management/catalog/CatalogPage";

export const Route = createFileRoute("/manage/units")({
  head: () => ({ meta: [{ title: "יחידות ומתחמים" }] }),
  validateSearch: (s: Record<string, unknown>): { add?: "unit" } =>
    s["add"] === "unit" ? { add: "unit" } : {},
  component: CatalogPage,
});
