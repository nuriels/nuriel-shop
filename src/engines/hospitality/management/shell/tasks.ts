// "דורש טיפול" במעטפת (שלב F2b): אותה שאילתה כמו בלוח הבקרה (מטמון משותף — קריאה אחת לשרת),
// לפעמון שבסרגל העליון ולספירות שליד "הזמנות" ו"ערוצי הזמנה" בניווט.
import { useQuery } from "@tanstack/react-query";
import { hospitalityDashboardTasks } from "../../api/dashboard.functions";
import { hospitalitySupportUnread } from "../../api/support.functions";
import type { DashboardTasks } from "../../types/dashboard";
import { dashboardKeys } from "../dashboard/model";
import type { NavBadges } from "../lib/nav";
import { supportKeys } from "../support/keys";

export function useDashboardTasks(enabled: boolean) {
  return useQuery({
    queryKey: dashboardKeys.tasks,
    queryFn: () => hospitalityDashboardTasks(),
    enabled,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/** הזמנות: בקשות לאישור + בקשות ביטול; ערוצים: התנגשויות / יומן שלא מסתנכרן; מיילים שנכשלו */
export function navBadges(data: DashboardTasks | undefined): NavBadges {
  const out: NavBadges = {};
  for (const t of data?.items ?? []) {
    if (t.kind === "pending" || t.kind === "cancel_requests")
      out.bookings = (out.bookings ?? 0) + t.count;
    if (t.kind === "channels") out.channels = (t.conflicts ?? 0) + (t.failing ?? 0) || t.count;
    if (t.kind === "emails") out.emails = t.count;
  }
  return out;
}

/** תמיכה (E4): תשובות של צוות התמיכה שעוד לא נקראו — לתג ליד "תמיכה" */
export function useSupportUnread(enabled: boolean) {
  return useQuery({
    queryKey: supportKeys.unread,
    queryFn: () => hospitalitySupportUnread(),
    enabled,
    refetchInterval: 120_000,
    staleTime: 60_000,
  });
}
