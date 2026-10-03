import { createFileRoute, redirect } from "@tanstack/react-router";

// כתובת ישירה ללוח הבקרה (/admin/dashboard) → הלשונית "לוח בקרה" בפאנל הניהול
export const Route = createFileRoute("/admin_/dashboard")({
  beforeLoad: () => {
    throw redirect({ to: "/admin", search: { tab: "dashboard" } });
  },
});
