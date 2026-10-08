import { createFileRoute, redirect } from "@tanstack/react-router";

// כתובת ישירה לניהול הצוות (/admin/settings/staff) → לשונית "צוות והרשאות"
// בפאנל הניהול (חלק 33): אנשי הצוות, התפקיד של כל אחד והוספת עובד.
export const Route = createFileRoute("/admin_/settings_/staff")({
  beforeLoad: () => {
    throw redirect({ to: "/admin", search: { tab: "staff" } });
  },
});
