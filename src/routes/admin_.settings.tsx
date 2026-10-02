import { createFileRoute, redirect } from "@tanstack/react-router";

// כתובת ישירה להגדרות החנות (/admin/settings) → לשונית "הגדרות אתר" בפאנל
// הניהול. רק מנהל החנות רואה אותה: הפאנל בודק את התפקיד, והמסד (RLS) מאפשר
// לשמור הגדרות רק למנהל של אותה חנות.
export const Route = createFileRoute("/admin_/settings")({
  beforeLoad: () => {
    throw redirect({ to: "/admin", search: { tab: "site" } });
  },
});
