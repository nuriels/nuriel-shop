import { createFileRoute, redirect } from "@tanstack/react-router";

// כתובת ישירה להגדרות הדומיין (/admin/settings/domain) → לשונית "דומיין משלכם"
// בפאנל הניהול: חיבור דומיין מותאם, הוראות DNS ואימות.
export const Route = createFileRoute("/admin_/settings_/domain")({
  beforeLoad: () => {
    throw redirect({ to: "/admin", search: { tab: "domain" } });
  },
});
