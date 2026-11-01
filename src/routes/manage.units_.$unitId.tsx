// מתאם נתיב (Hospitality): עמוד היחידה
import { createFileRoute } from "@tanstack/react-router";
import { UnitPage } from "@/engines/hospitality/management/catalog/UnitPage";

export const Route = createFileRoute("/manage/units_/$unitId")({
  head: () => ({ meta: [{ title: "פרטי היחידה" }] }),
  component: UnitPage,
});
