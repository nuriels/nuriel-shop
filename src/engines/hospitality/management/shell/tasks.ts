// "דורש טיפול" במעטפת (שלב F2b): אותה שאילתה כמו בלוח הבקרה (מטמון משותף — קריאה אחת לשרת),
// לפעמון שבסרגל העליון ולספירות שליד "הזמנות" ו"ערוצי הזמנה" בניווט.
import { useQuery } from "@tanstack/react-query";
import { hospitalityContractsUnseen } from "../../api/contracts.functions";
import { hospitalityDashboardTasks } from "../../api/dashboard.functions";
import { hospitalitySupportUnread } from "../../api/support.functions";
import type { DashboardTasks } from "../../types/dashboard";
import { contractsUnseenKey } from "../client-documents/model";
import { dashboardKeys, unseenAlerts } from "../dashboard/model";
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

/**
 * הזמנות: בקשות לאישור + בקשות ביטול; ערוצים: התנגשויות / יומן שלא מסתנכרן; מיילים: התראות על מיילים
 * שנכשלו שעוד לא נקראו (מיגרציה 206 — "סימון כנקרא" מוריד את המספר, "טופל" מסיר את ההתראה)
 */
export function navBadges(data: DashboardTasks | undefined): NavBadges {
  const out: NavBadges = {};
  for (const t of data?.items ?? []) {
    if (t.kind === "pending" || t.kind === "cancel_requests")
      out.bookings = (out.bookings ?? 0) + t.count;
    if (t.kind === "channels") out.channels = (t.conflicts ?? 0) + (t.failing ?? 0) || t.count;
    if (t.kind === "emails" && unseenAlerts(t) > 0) out.emails = unseenAlerts(t);
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

/** מסמכי לקוחות: חתימות חדשות שעוד לא נצפו — לתג ליד "מסמכי לקוחות" (ההתראה במערכת על כל חתימה) */
export function useContractsUnseen(enabled: boolean) {
  return useQuery({
    queryKey: contractsUnseenKey,
    queryFn: () => hospitalityContractsUnseen(),
    enabled,
    refetchInterval: 120_000,
    staleTime: 60_000,
  });
}
