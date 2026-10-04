import { Link } from "@tanstack/react-router";
import { Crown, Lock } from "lucide-react";
import { PREMIUM_ONLY_MESSAGE } from "@/lib/subscription";
import { cn } from "@/lib/utils";

/**
 * נעילת פיצ'ר של פרימיום בחבילה הבסיסית (חלק 13): אייקון מנעול + "זמין
 * בחבילת פרימיום", וקישור ל"המנוי שלי". האכיפה עצמה גם במסד.
 */

/** תג קטן ליד כותרת / מתג */
export function PremiumBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200",
        className,
      )}
    >
      <Lock className="size-3" aria-hidden="true" />
      {PREMIUM_ONLY_MESSAGE}
    </span>
  );
}

/** כרטיס במקום פיצ'ר נעול — כותרת, הסבר וכפתור לשדרוג */
export function PremiumLockCard({
  title,
  description,
  className,
  compact = false,
}: {
  title: string;
  description?: string;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-amber-200 bg-gradient-to-l from-amber-50 to-background dark:border-amber-800 dark:from-amber-950/30",
        compact ? "p-3" : "p-5",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200",
            compact ? "size-9" : "size-11",
          )}
        >
          <Lock className={compact ? "size-4" : "size-5"} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
            {title}
            <PremiumBadge />
          </p>
          {description && <p className="text-sm leading-6 text-muted-foreground">{description}</p>}
          <Link
            to="/admin"
            search={{ tab: "billing" }}
            className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-amber-800 underline-offset-4 hover:underline dark:text-amber-200"
          >
            <Crown className="size-4" aria-hidden="true" />
            לשדרוג לפרימיום
          </Link>
        </div>
      </div>
    </div>
  );
}
