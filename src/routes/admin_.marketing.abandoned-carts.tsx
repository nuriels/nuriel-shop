import { createFileRoute, redirect } from "@tanstack/react-router";

// כתובת ישירה לסלים הנטושים (/admin/marketing/abandoned-carts) → הלשונית "עגלות נטושות"
export const Route = createFileRoute("/admin_/marketing/abandoned-carts")({
  beforeLoad: () => {
    throw redirect({ to: "/admin", search: { tab: "abandoned" } });
  },
});
