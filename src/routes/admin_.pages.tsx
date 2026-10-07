import { createFileRoute, redirect } from "@tanstack/react-router";

// כתובת ישירה לעמודי התוכן (/admin/pages) → לשונית "עמודי תוכן" בפאנל הניהול
// (חלק 30). רק מנהל החנות רואה אותה: הפאנל בודק את התפקיד, והמסד (RLS)
// מאפשר לכתוב עמודים רק למנהל של אותה חנות.
export const Route = createFileRoute("/admin_/pages")({
  beforeLoad: () => {
    throw redirect({ to: "/admin", search: { tab: "pages" } });
  },
});
