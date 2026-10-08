import { createFileRoute, redirect } from "@tanstack/react-router";

// אזור המחסנאי עבר לפאנל הניהול (חלק 33): ליקוט, סטטוס משלוחים, בדיקת מלאי,
// העברות ומדבקות ברקוד — לפי ההרשאות של המחסנאי. הכתובת הישנה ממשיכה לעבוד.
export const Route = createFileRoute("/warehouse")({
  beforeLoad: () => {
    throw redirect({ to: "/admin", search: { tab: "picking" } });
  },
});
