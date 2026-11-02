// "דורש טיפול" בלוח הבקרה (שלב F3): מה שמחכה לבעל העסק — בקשות לאישור, בקשות ביטול, מקדמות
// לגבייה, יומנים חיצוניים, מיילים שנכשלו, יחידות בלי מחיר, שינויים באתר שלא פורסמו, וסוף תקופת
// הניסיון, ותאריכים להזמנה שצריך לפתוח (מיגרציה 43). המסד מחזיר רק מה שמותר למשתמש לראות; כל שורה —
// כפתור ליעד אמיתי.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CalendarCheck,
  CalendarClock,
  CircleCheckBig,
  Clock,
  CreditCard,
  Globe,
  MailWarning,
  Receipt,
  RefreshCw,
  Tag,
  TriangleAlert,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/platform/ui";
import { hospitalityChannels } from "../../api/channels.functions";
import { hospitalityDashboardTasks } from "../../api/dashboard.functions";
import type { DashboardTaskKind } from "../../types/dashboard";
import { CHANNEL_LABELS } from "../calendar/model";
import { manageKeys } from "../lib/query-keys";
import { ErrorState, IconTile, SectionCard, SkeletonBlock } from "../ui/kit";
import { TONES } from "../ui/tones";
import { channelAlerts } from "./channel-alerts";
import { dashboardKeys, shortDate, sortTasks, taskView } from "./model";

const ICONS: Record<DashboardTaskKind, LucideIcon> = {
  pending: Clock,
  cancel_requests: Undo2,
  deposits: CreditCard,
  channels: TriangleAlert,
  emails: MailWarning,
  prices: Tag,
  site: Globe,
  plan: Receipt,
  open_dates: CalendarCheck,
};

export function TasksCard({ canBookings }: { canBookings: boolean }) {
  const query = useQuery({
    queryKey: dashboardKeys.tasks,
    queryFn: () => hospitalityDashboardTasks(),
    refetchInterval: 60_000,
  });
  const items = query.data ? sortTasks(query.data.items) : [];
  const hasConflicts = items.some((t) => t.kind === "channels" && (t.conflicts ?? 0) > 0);
  // פירוט ההתנגשות הראשונה (יחידה · ערוץ · תאריכים) — רק כשיש כזו
  const channels = useQuery({
    queryKey: [...manageKeys.all, "channels"],
    queryFn: () => hospitalityChannels(),
    enabled: canBookings && hasConflicts,
    staleTime: 60_000,
  });
  const firstConflict = channels.data ? channelAlerts(channels.data).conflicts[0] : undefined;
  const now = Date.now();

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          דורש טיפול
          {query.data && query.data.count > 0 && (
            <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-[var(--hm-warning-bg)] px-1.5 text-xs font-bold text-[var(--hm-warning)]">
              {query.data.count}
            </span>
          )}
        </span>
      }
      description="מה שמחכה לכם עכשיו, לפי דחיפות"
      className="h-full"
    >
      {query.isPending ? (
        <div className="flex flex-col gap-2">
          <SkeletonBlock className="h-16" />
          <SkeletonBlock className="h-16" />
          <SkeletonBlock className="h-16" />
        </div>
      ) : query.isError ? (
        <ErrorState message="לא הצלחנו לבדוק מה דורש טיפול." onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl bg-[var(--hm-success-bg)]/60 px-4 py-8 text-center">
          <CircleCheckBig className="size-8 text-[var(--hm-success)]" aria-hidden="true" />
          <p className="font-semibold text-[var(--hm-success)]">הכול מטופל</p>
          <p className="text-sm text-muted-foreground">אין בקשות, התראות או משימות פתוחות.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="dashboard-tasks">
          {items.map((task) => {
            const v = taskView(task, now);
            const detail =
              task.kind === "channels" && firstConflict
                ? `${firstConflict.unit} · ${CHANNEL_LABELS[firstConflict.channel] ?? firstConflict.channel} · ${shortDate(firstConflict.from)}–${shortDate(firstConflict.to)}`
                : v.detail;
            const tone = TONES[v.tone];
            const Icon = task.kind === "channels" && !task.conflicts ? RefreshCw : ICONS[task.kind];
            return (
              <li key={task.kind} data-task={task.kind}>
                <Link
                  {...v.link}
                  className={cn(
                    "group flex min-h-16 items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors hover:bg-[var(--hm-surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hm-lagoon-500)]",
                    task.severity === "high" ? tone.border : "border-border",
                  )}
                >
                  <IconTile icon={Icon} tone={v.tone} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{v.title}</span>
                    {detail && (
                      <span className="block truncate text-xs text-muted-foreground">{detail}</span>
                    )}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold group-hover:underline",
                      tone.bg,
                      tone.text,
                    )}
                  >
                    {v.cta}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {query.data && (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <CalendarClock className="size-3.5" aria-hidden="true" />
          מתעדכן כל דקה
        </p>
      )}
    </SectionCard>
  );
}
