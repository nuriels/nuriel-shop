// לוח הבקרה של בעל העסק (שלב F3). ההרשאות נאכפות במסד:
//   • dashboard_overview — "לוח בקרה ודוחות" (בעלים ומנהלים); הכנסות / גבייה רק עם הרשאה כספית;
//   • dashboard_today / dashboard_tasks — "הזמנות".
// כאן: בדיקת הקלט והקריאה עם הטוקן של המשתמש.
import { createServerFn } from "@tanstack/react-start";
import type { DashboardOverview, DashboardTasks, DashboardToday } from "../types/dashboard";
import { parseDashboardRange } from "../validation/dashboard";

export const hospitalityDashboardOverview = createServerFn({ method: "GET" })
  .inputValidator((input: Record<string, unknown>) => parseDashboardRange(input))
  .handler(async ({ data }): Promise<DashboardOverview> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<DashboardOverview>("dashboard_overview", { _from: data.from, _to: data.to });
  });

export const hospitalityDashboardToday = createServerFn({ method: "GET" }).handler(
  async (): Promise<DashboardToday> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<DashboardToday>("dashboard_today", {});
  },
);

export const hospitalityDashboardTasks = createServerFn({ method: "GET" }).handler(
  async (): Promise<DashboardTasks> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<DashboardTasks>("dashboard_tasks", {});
  },
);
