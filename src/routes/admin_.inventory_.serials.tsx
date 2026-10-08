import { createFileRoute, redirect } from "@tanstack/react-router";

// כתובת ישירה למסך המספרים הסידוריים (/admin/inventory/serials) → לשונית
// "מספרים סידוריים ואחריות" בפאנל הניהול (חלק 35: קליטה לפי מספר סידורי,
// רשימת היחידות ובדיקת אחריות).
export const Route = createFileRoute("/admin_/inventory_/serials")({
  beforeLoad: () => {
    throw redirect({ to: "/admin", search: { tab: "serials" } });
  },
});
