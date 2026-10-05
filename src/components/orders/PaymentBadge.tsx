import { CreditCard, Hourglass, TimerOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * מצב התשלום באשראי של הזמנה (חלק 16) — ליד תג הסטטוס.
 * הזמנה בלי סליקה (not_required / offline) — בלי תג.
 */
export function PaymentBadge({
  status,
  className,
}: {
  status: string | null | undefined;
  className?: string;
}) {
  if (status === "awaiting") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200",
          className,
        )}
      >
        <Hourglass className="size-3" aria-hidden="true" />
        ממתינה לתשלום באשראי
      </span>
    );
  }
  if (status === "paid") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200",
          className,
        )}
      >
        <CreditCard className="size-3" aria-hidden="true" />
        שולמה באשראי
      </span>
    );
  }
  if (status === "expired") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground",
          className,
        )}
      >
        <TimerOff className="size-3" aria-hidden="true" />
        לא שולמה בזמן
      </span>
    );
  }
  return null;
}
