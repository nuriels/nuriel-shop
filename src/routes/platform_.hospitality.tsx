// מתאם נתיב (Hospitality): "ניהול Hospitality" בפאנל הפלטפורמה — בכתובת הפאנל בלבד
import { createFileRoute } from "@tanstack/react-router";
import { PlatformHospitalityPage } from "@/engines/hospitality/platform-admin/PlatformHospitalityPage";

export const Route = createFileRoute("/platform_/hospitality")({
  ssr: false,
  head: () => ({ meta: [{ title: "ניהול Hospitality" }, { name: "robots", content: "noindex" }] }),
  component: PlatformHospitalityPage,
});
