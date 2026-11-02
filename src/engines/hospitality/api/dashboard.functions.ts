// לוח הבקרה של בעל העסק (שלב F3). ההרשאות נאכפות במסד:
//   • dashboard_overview — "לוח בקרה ודוחות" (בעלים ומנהלים); הכנסות / גבייה רק עם הרשאה כספית;
//   • dashboard_today / dashboard_tasks — "הזמנות".
//   • reports_view (F7) — הדוחות: אותו חישוב כמו לוח הבקרה, עם סינון; אותן הרשאות.
// כאן: בדיקת הקלט והקריאה עם הטוקן של המשתמש.
import { createServerFn } from "@tanstack/react-start";
import type { DashboardOverview, DashboardTasks, DashboardToday } from "../types/dashboard";
import type { ReportsView } from "../types/reports";
import { parseDashboardRange } from "../validation/dashboard";
import { parseReportsQuery } from "../validation/reports";

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

/** F7: הדוחות — תקופה, יחידות, מקורות וסטטוסים (מיגרציה 34) */
export const hospitalityReports = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => parseReportsQuery(input))
  .handler(async ({ data }): Promise<ReportsView> => {
    const { manageRpc } = await import("../server/manage.server");
    return manageRpc<ReportsView>("reports_view", {
      _from: data.from,
      _to: data.to,
      _unit_ids: data.units,
      _sources: data.sources,
      _statuses: data.statuses,
    });
  });
