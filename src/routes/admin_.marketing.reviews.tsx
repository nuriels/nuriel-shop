import { createFileRoute, redirect } from "@tanstack/react-router";

// כתובת ישירה לביקורות הלקוחות (/admin/marketing/reviews) → הלשונית "ביקורות לקוחות"
// בפאנל הניהול (חלק 34): אישור / הסתרה / מחיקה. בעלים ומנהל חנות בלבד —
// קופאי / מחסנאי מוחזרים למסך הבית שלהם עם "אין לך הרשאה מתאימה".
export const Route = createFileRoute("/admin_/marketing/reviews")({
  beforeLoad: () => {
    throw redirect({ to: "/admin", search: { tab: "reviews" } });
  },
});
