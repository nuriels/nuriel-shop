import { createFileRoute, redirect } from "@tanstack/react-router";

// כתובת ישירה לניהול ההזמנות (/admin/orders) → לשונית "הזמנות" בפאנל הניהול
// (שם: בחירה מרובה, "נשלח" + מייל, מסירה לשליח ומדבקות משלוח).
export const Route = createFileRoute("/admin_/orders")({
  beforeLoad: () => {
    throw redirect({ to: "/admin", search: { tab: "orders" } });
  },
});
