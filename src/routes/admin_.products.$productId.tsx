import { createFileRoute, redirect } from "@tanstack/react-router";

// כתובת ישירה לעריכת מוצר (/admin/products/$productId) → לשונית "מוצרים"
// בפאנל הניהול, וחלון העריכה של המוצר נפתח מיד.
export const Route = createFileRoute("/admin_/products/$productId")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/admin", search: { tab: "products", product: params.productId } });
  },
});
