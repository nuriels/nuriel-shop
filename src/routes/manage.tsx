// מתאם נתיב (Hospitality): אזור הניהול של בעל העסק. רק נתיב, כותרת ורכיב —
// כל הקוד ב-src/engines/hospitality/management. מוגש רק באתר אירוח שאזור
// הניהול פעיל בו (שער המנוע ב-src/server.ts + ה-root).
import { createFileRoute } from "@tanstack/react-router";
import { hospitalitySiteOnly } from "@/engines/hospitality/management/route-guard";
import { ManageLayout } from "@/engines/hospitality/management/shell/ManageLayout";

export const Route = createFileRoute("/manage")({
  ssr: "data-only",
  beforeLoad: hospitalitySiteOnly,
  head: () => ({
    meta: [{ title: "ניהול העסק" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: ManageLayout,
});
