import { createFileRoute, redirect } from "@tanstack/react-router";

// כתובת ישירה לקופה המהירה (/admin/orders/new) → לשונית "קופה מהירה" בפאנל הניהול
// (חלק 32: הזמנה טלפונית / מכירה בחנות — לקוח, מוצרים, משלוח, תשלום והנחה).
export const Route = createFileRoute("/admin_/orders_/new")({
  beforeLoad: () => {
    throw redirect({ to: "/admin", search: { tab: "pos" } });
  },
});
