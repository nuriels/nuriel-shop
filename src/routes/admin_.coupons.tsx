import { createFileRoute, redirect } from "@tanstack/react-router";

// כתובת ישירה לניהול הקופונים (/admin/coupons) → לשונית "קופונים" בפאנל הניהול
// (רשימה, "קופון חדש", סוגי הנחה כולל משלוח חינם, מגבלת שימושים ותוקף).
export const Route = createFileRoute("/admin_/coupons")({
  beforeLoad: () => {
    throw redirect({ to: "/admin", search: { tab: "coupons" } });
  },
});
