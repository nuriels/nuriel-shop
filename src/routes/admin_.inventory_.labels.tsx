import { createFileRoute, redirect } from "@tanstack/react-router";

// כתובת ישירה למחולל מדבקות הברקוד (/admin/inventory/labels) → לשונית
// "מדבקות ברקוד" בפאנל הניהול (חלק 32: מדבקות מוצר למדפסת תרמית / דף A4).
export const Route = createFileRoute("/admin_/inventory_/labels")({
  beforeLoad: () => {
    throw redirect({ to: "/admin", search: { tab: "labels" } });
  },
});
