import { CheckCircle2, CircleDashed, Clock, HelpCircle, Send, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  EMAIL_STATUS_HINT,
  EMAIL_STATUS_LABEL,
  LINK_STATE_LABEL,
  PROVIDER_EVENT_LABEL,
  type EmailStatus,
  type LinkState,
} from "@/lib/licenses";

const PILL =
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold";

const EMAIL_STYLE: Record<EmailStatus, string> = {
  pending:
    "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
  accepted:
    "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200",
  delivered:
    "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
  failed:
    "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200",
  unknown:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200",
};
const EMAIL_ICON: Record<EmailStatus, typeof Send> = {
  pending: Clock,
  accepted: Send,
  delivered: CheckCircle2,
  failed: XCircle,
  unknown: HelpCircle,
};

/** סטטוס המייל — רק מה שהספק אישר באמת ("נמסר" רק אחרי אישור מסירה) */
export function EmailStatusBadge({
  status,
  event,
}: {
  status: EmailStatus;
  event?: string | null;
}) {
  const Icon = EMAIL_ICON[status];
  const eventLabel = event ? (PROVIDER_EVENT_LABEL[event] ?? event) : null;
  return (
    <span
      className={cn(PILL, EMAIL_STYLE[status])}
      title={
        eventLabel
          ? `${EMAIL_STATUS_HINT[status]} · אירוע אחרון: ${eventLabel}`
          : EMAIL_STATUS_HINT[status]
      }
    >
      <Icon className="size-3.5" aria-hidden />
      {EMAIL_STATUS_LABEL[status]}
    </span>
  );
}

const LINK_STYLE: Record<LinkState, string> = {
  active:
    "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
  expired:
    "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
  exhausted:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200",
  revoked:
    "border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400",
};

export function LinkStateBadge({ state }: { state: LinkState | null }) {
  if (!state) {
    return (
      <span className={cn(PILL, "border-dashed border-slate-300 text-muted-foreground")}>
        <CircleDashed className="size-3.5" aria-hidden />
        ללא קישור
      </span>
    );
  }
  return <span className={cn(PILL, LINK_STYLE[state])}>{LINK_STATE_LABEL[state]}</span>;
}
