// מתאם נתיב (Hospitality): כניסה לאזור הניהול (מחוץ למעטפת — בלי בדיקת הרשאה)
import { createFileRoute } from "@tanstack/react-router";
import { hospitalitySiteOnly } from "@/engines/hospitality/management/route-guard";
import { ManageLogin } from "@/engines/hospitality/management/login/ManageLogin";

export const Route = createFileRoute("/manage_/login")({
  ssr: "data-only",
  beforeLoad: hospitalitySiteOnly,
  head: () => ({
    meta: [{ title: "כניסה לניהול העסק" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: ManageLogin,
});
