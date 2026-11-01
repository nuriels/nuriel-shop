// מתאם נתיב (Hospitality): עמוד המתחם
import { createFileRoute } from "@tanstack/react-router";
import { PropertyPage } from "@/engines/hospitality/management/catalog/PropertyPage";

export const Route = createFileRoute("/manage/properties/$propertyId")({
  head: () => ({ meta: [{ title: "ניהול המתחם" }] }),
  component: PropertyPage,
});
