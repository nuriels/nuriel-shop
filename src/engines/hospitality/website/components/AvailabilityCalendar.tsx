// לוח זמינות של יחידה: לילות פנויים / תפוסים (מהשרת, בלי פרטים), חודשיים במחשב וחודש בנייד.
// במצב בחירה (onSelect) — בחירת תאריך הגעה ואז תאריך יציאה; לילה תפוס באמצע הטווח לא נבחר.
// הבדיקה הסופית — בשרת, בזמן הבקשה (מניעת הזמנה כפולה במסד).
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/platform/ui";
import {
  hospitalityPublicAvailability,
  hospitalityPublicTypeAvailability,
} from "../../api/website.functions";
import { useCopy } from "../copy";
import { monthTitle } from "../lib/format";
import { addDays, monthGrid, rangeHasBusy } from "../lib/dates";

export interface DateRange {
  from: string | null;
  to: string | null;
}

export function AvailabilityCalendar({
  unitId,
  typeId,
  today,
  range,
  onSelect,
  minNights = 1,
  months: count = 2,
  className,
}: {
  /** יחידה — או סוג חדר (לילה תפוס = אין אף חדר פנוי מהסוג) */
  unitId?: string | undefined;
  typeId?: string | undefined;
  today: string;
  range?: DateRange;
  onSelect?: (r: DateRange) => void;
  minNights?: number;
  /** חודש אחד (צד העמוד) או שניים (בנייד תמיד אחד) */
  months?: 1 | 2;
  className?: string;
}) {
  const t = useCopy();
  const [y0, m0] = today.split("-").map(Number) as [number, number];
  const [offset, setOffset] = useState(0);
  const first = new Date(Date.UTC(y0, m0 - 1 + offset, 1));
  const from = first.toISOString().slice(0, 10);
  const to = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 2, 1))
    .toISOString()
    .slice(0, 10);
  const query = useQuery({
    queryKey: ["hospitality", "site", "availability", unitId ?? `type:${typeId}`, from, to],
    queryFn: async (): Promise<{ busy: string[] }> =>
      typeId
        ? hospitalityPublicTypeAvailability({ data: { categoryId: typeId, from, to } })
        : hospitalityPublicAvailability({ data: { unitId: unitId ?? "", from, to } }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const busy = useMemo(() => new Set(query.data?.busy ?? []), [query.data]);
  const months = (count === 2 ? [0, 1] : [0]).map((i) => {
    const d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, 1));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  });

  const pick = (day: string) => {
    if (!onSelect) return;
    const start = range?.from;
    if (!start || range?.to || day <= start) {
      if (busy.has(day)) return;
      onSelect({ from: day, to: null });
      return;
    }
    if (rangeHasBusy(start, day, busy)) {
      onSelect({ from: busy.has(day) ? null : day, to: null });
      return;
    }
    onSelect({
      from: start,
      to: day < addDays(start, minNights) ? addDays(start, minNights) : day,
    });
  };

  return (
    <div className={className}>
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setOffset((o) => Math.max(0, o - 1))}
          disabled={offset === 0}
          className="inline-flex size-10 items-center justify-center rounded-sm hover:bg-muted disabled:opacity-30"
          aria-label={t.availability.prevMonth}
        >
          <ChevronRight className="size-5" aria-hidden="true" />
        </button>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {query.isError
            ? t.availability.error
            : query.isFetching && !query.data
              ? t.availability.loading
              : ""}
        </p>
        <button
          type="button"
          onClick={() => setOffset((o) => Math.min(11, o + 1))}
          className="inline-flex size-10 items-center justify-center rounded-sm hover:bg-muted"
          aria-label={t.availability.nextMonth}
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
      </div>
      <div className={cn("grid gap-8", count === 2 && "sm:grid-cols-2")}>
        {months.map(({ y, m }, i) => (
          <div key={`${y}-${m}`} className={i === 1 ? "hidden sm:block" : undefined}>
            <p className="font-display mb-3 text-center text-lg">{monthTitle(y, m, t.locale)}</p>
            <table className="w-full table-fixed border-collapse text-center text-sm" role="grid">
              <thead>
                <tr>
                  {t.availability.weekdays.map((d) => (
                    <th
                      key={d}
                      scope="col"
                      className="pb-2 text-xs font-normal text-muted-foreground"
                    >
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthGrid(y, m).map((week, wi) => (
                  <tr key={wi}>
                    {week.map((day, di) => {
                      if (!day) return <td key={di} />;
                      const past = day < today;
                      const isBusy = busy.has(day);
                      const inRange =
                        !!range?.from && !!range?.to && day > range.from && day < range.to;
                      const edge = day === range?.from || day === range?.to;
                      const label = `${Number(day.slice(8))} — ${past ? t.availability.past : isBusy ? t.availability.busy : t.availability.free}`;
                      const cls = cn(
                        "mx-auto flex size-9 items-center justify-center rounded-full text-sm transition-colors sm:size-10",
                        past && "text-muted-foreground/40",
                        !past &&
                          isBusy &&
                          "text-muted-foreground/60 line-through decoration-muted-foreground/50",
                        !past && !isBusy && "text-foreground",
                        inRange && "rounded-none bg-[var(--site-sand)]",
                        edge && "bg-primary text-primary-foreground",
                      );
                      return (
                        <td key={di} className="py-0.5">
                          {onSelect && !past ? (
                            <button
                              type="button"
                              onClick={() => pick(day)}
                              className={cn(
                                cls,
                                !edge && "hover:bg-muted",
                                "disabled:cursor-not-allowed",
                              )}
                              aria-label={label}
                              aria-pressed={edge}
                              disabled={isBusy && !(range?.from && !range.to && day > range.from)}
                            >
                              {Number(day.slice(8))}
                            </button>
                          ) : (
                            <span className={cls} aria-label={label}>
                              {Number(day.slice(8))}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span
            className="inline-block size-3 rounded-full border border-foreground/40"
            aria-hidden="true"
          />
          {t.availability.free}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-px w-3 bg-muted-foreground" aria-hidden="true" />
          {t.availability.busy}
        </span>
      </div>
    </div>
  );
}
