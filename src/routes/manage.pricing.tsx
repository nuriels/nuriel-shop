// מתאם נתיב (Hospitality): מחירים וכללי מחיר
import { createFileRoute } from "@tanstack/react-router";
import { PricingPage } from "@/engines/hospitality/management/pricing/PricingPage";

export const Route = createFileRoute("/manage/pricing")({
  head: () => ({ meta: [{ title: "מחירים" }] }),
  component: PricingPage,
});
