import { createFileRoute, redirect } from "@tanstack/react-router";

// כתובת ישירה לנתונים (/admin/analytics) → הלשונית "לוח בקרה" בפאנל הניהול.
// עובד בלי הרשאה (למשל קופאי) מוחזר משם למסך הבית שלו עם "אין לך הרשאה מתאימה".
export const Route = createFileRoute("/admin_/analytics")({
  beforeLoad: () => {
    throw redirect({ to: "/admin", search: { tab: "dashboard" } });
  },
});
