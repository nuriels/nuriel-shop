// לוח זמינות של יחידה: לילות פנויים / תפוסים / שעוד לא נפתחו להזמנה (מהשרת, בלי פרטים), חודשיים
// במחשב וחודש בנייד. במצב בחירה (onSelect) — תאריך הגעה ואז תאריך יציאה; לילה תפוס או סגור באמצע
// הטווח לא נבחר (יום היציאה עצמו לא נספר כלילה). הבדיקה הסופית — בשרת, בזמן הבקשה.
// K3: תאים גדולים יותר, מקרא ברור, ושלושה סגנונות שבעל העסק בוחר בעורך (design.calendar).
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/platform/ui";
import {
  hospitalityPublicAvailability,
  hospitalityPublicTypeAvailability,
} from "../../api/website.functions";
import { useCopy } from "../copy";
import type { CalendarStyle } from "../design/schema";
import { longDate, monthTitle } from "../lib/format";
import { addDays, monthGrid, nightKind, rangeHasBusy, type NightKind } from "../lib/dates";

export interface DateRange {
  from: string | null;
  to: string | null;
}

// הסגנונות: התא לפי המצב (נבחר / בטווח — מעל כל סגנון)
const CELL: Record<CalendarStyle, Record<NightKind, string>> = {
  classic: {
    free: "text-foreground hover:bg-muted",
    busy: "text-muted-foreground/70 line-through decoration-muted-foreground/60",
    closed:
      "text-muted-foreground/60 [background:repeating-linear-gradient(135deg,transparent,transparent_4px,rgba(100,116,139,0.14)_4px,rgba(100,116,139,0.14)_7px)]",
    past: "text-muted-foreground/40",
  },
  colors: {
    free: "bg-emerald-50 text-emerald-950 ring-1 ring-inset ring-emerald-200 hover:bg-emerald-100",
    busy: "bg-rose-50 text-rose-900/80 line-through decoration-rose-700/50",
    closed:
      "bg-slate-100 text-slate-500 [background-image:repeating-linear-gradient(135deg,transparent,transparent_4px,rgba(100,116,139,0.18)_4px,rgba(100,116,139,0.18)_7px)]",
    past: "text-muted-foreground/40",
  },
  minimal: {
    free: "text-foreground hover:bg-muted",
    busy: "text-muted-foreground/60",
    closed: "text-muted-foreground/40",
    past: "text-muted-foreground/30",
  },
};
// הסגנון "נקי": נקודה מתחת למספר (ירוק — פנוי, אדום — תפוס)
const DOT: Partial<Record<NightKind, string>> = { free: "bg-emerald-600", busy: "bg-rose-600" };

export function AvailabilityCalendar({
  unitId,
  typeId,
  today,
  range,
  onSelect,
  minNights = 1,
  months: count = 2,
  calendarStyle = "classic",
  className,
}: {
  /** יחידה — או סוג חדר (לילה תפוס = אין אף חדר פתוח ופנוי מהסוג) */
  unitId?: string | undefined;
  typeId?: string | undefined;
  today: string;
  range?: DateRange;
  onSelect?: (r: DateRange) => void;
  minNights?: number;
  /** חודש אחד (צד העמוד) או שניים (בנייד תמיד אחד) */
  months?: 1 | 2;
  /** K3: הסגנון שבעל העסק בחר בעורך */
  calendarStyle?: CalendarStyle | undefined;
  className?: string;
}) {
  const t = useCopy();
  const look = calendarStyle ?? "classic";
  const [y0, m0] = today.split("-").map(Number) as [number, number];
  const [offset, setOffset] = useState(0);
  const first = new Date(Date.UTC(y0, m0 - 1 + offset, 1));
  const from = first.toISOString().slice(0, 10);
  const to = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 2, 1))
    .toISOString()
    .slice(0, 10);
  const query = useQuery({
    queryKey: ["hospitality", "site", "availability", unitId ?? `type:${typeId}`, from, to],
    queryFn: async (): Promise<{ busy: string[]; open_until?: string | null }> =>
      typeId
        ? hospitalityPublicTypeAvailability({ data: { categoryId: typeId, from, to } })
        : hospitalityPublicAvailability({ data: { unitId: unitId ?? "", from, to } }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const busy = useMemo(() => new Set(query.data?.busy ?? []), [query.data]);
  const openUntil = query.data ? query.data.open_until : undefined;
  // לבחירה: תפוס או סגור — אותו דבר (לילה שאי אפשר להזמין)
  const blocked = useMemo(() => {
    const set = new Set(busy);
    if (openUntil !== undefined)
      for (let d = from; d < to; d = addDays(d, 1))
        if (openUntil === null || d > openUntil) set.add(d);
    return set;
  }, [busy, openUntil, from, to]);
  const months = (count === 2 ? [0, 1] : [0]).map((i) => {
    const d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, 1));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  });

  const pick = (day: string) => {
    if (!onSelect) return;
    const start = range?.from;
    if (!start || range?.to || day <= start) {
      if (blocked.has(day)) return;
      onSelect({ from: day, to: null });
      return;
    }
    if (rangeHasBusy(start, day, blocked)) {
      onSelect({ from: blocked.has(day) ? null : day, to: null });
      return;
    }
    onSelect({
      from: start,
      to: day < addDays(start, minNights) ? addDays(start, minNights) : day,
    });
  };

  // הודעה כשאין תאריכים פתוחים בכלל / כשהם נגמרים לפני החודשים שעל המסך
  const closedNote =
    openUntil === null
      ? t.availability.closedAll
      : openUntil && openUntil < to
        ? t.availability.closedAfter(longDate(openUntil, t.locale))
        : null;

  return (
    <div className={className} data-calendar-style={look}>
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setOffset((o) => Math.max(0, o - 1))}
          disabled={offset === 0}
          className="inline-flex size-11 items-center justify-center rounded-full hover:bg-muted disabled:opacity-30"
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
          className="inline-flex size-11 items-center justify-center rounded-full hover:bg-muted"
          aria-label={t.availability.nextMonth}
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </button>
      </div>
      {closedNote && (
        <p
          className="mb-4 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground"
          role="status"
          data-testid="calendar-closed-note"
        >
          {closedNote} {openUntil === null && t.availability.closedAsk}
        </p>
      )}
      <div className={cn("grid gap-8", count === 2 && "sm:grid-cols-2")}>
        {months.map(({ y, m }, i) => (
          <div key={`${y}-${m}`} className={i === 1 ? "hidden sm:block" : undefined}>
            <p className="font-display mb-3 text-center text-xl">{monthTitle(y, m, t.locale)}</p>
            <table className="w-full table-fixed border-collapse text-center" role="grid">
              <thead>
                <tr>
                  {t.availability.weekdays.map((d) => (
                    <th
                      key={d}
                      scope="col"
                      className="pb-2 text-sm font-medium text-muted-foreground"
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
                      const kind = nightKind(day, today, busy, openUntil);
                      const inRange =
                        !!range?.from && !!range?.to && day > range.from && day < range.to;
                      const edge = day === range?.from || day === range?.to;
                      const stateText =
                        kind === "past"
                          ? t.availability.past
                          : kind === "busy"
                            ? t.availability.busy
                            : kind === "closed"
                              ? t.availability.closed
                              : t.availability.free;
                      const label = `${Number(day.slice(8))} — ${stateText}`;
                      // נבחר / בטווח — במקום הסגנון (יום היציאה יכול להיות לילה תפוס / סגור)
                      const cls = cn(
                        "relative mx-auto flex size-11 flex-col items-center justify-center rounded-full text-base transition-colors sm:size-12",
                        edge
                          ? "bg-primary text-primary-foreground"
                          : inRange
                            ? "rounded-none bg-[var(--site-sand)] text-foreground"
                            : CELL[look][kind],
                      );
                      const dot = look === "minimal" && !edge && DOT[kind] && (
                        <span
                          className={cn("absolute bottom-1.5 size-1.5 rounded-full", DOT[kind])}
                          aria-hidden="true"
                        />
                      );
                      // יום היציאה יכול להיות תפוס / סגור (הלילה שלו לא נספר)
                      const checkoutPick = !!range?.from && !range.to && day > range.from;
                      return (
                        <td key={di} className="py-0.5">
                          {onSelect && kind !== "past" ? (
                            <button
                              type="button"
                              onClick={() => pick(day)}
                              className={cn(cls, "disabled:cursor-not-allowed")}
                              aria-label={label}
                              aria-pressed={edge}
                              disabled={kind !== "free" && !checkoutPick}
                              data-night={kind}
                            >
                              {Number(day.slice(8))}
                              {dot}
                            </button>
                          ) : (
                            <span className={cls} aria-label={label} data-night={kind}>
                              {Number(day.slice(8))}
                              {dot}
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
      <ul className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
        {(["free", "busy", "closed"] as const).map((k) => (
          <li key={k} className="inline-flex items-center gap-2">
            <span
              className={cn(
                "relative inline-flex size-6 items-center justify-center rounded-full text-[11px]",
                CELL[look][k],
                look === "classic" && k === "free" && "ring-1 ring-foreground/30",
              )}
              aria-hidden="true"
            >
              {look === "minimal" && DOT[k] ? (
                <span className={cn("size-1.5 rounded-full", DOT[k])} />
              ) : (
                "12"
              )}
            </span>
            {k === "free"
              ? t.availability.free
              : k === "busy"
                ? t.availability.busy
                : t.availability.closed}
          </li>
        ))}
        {onSelect && (
          <li className="inline-flex items-center gap-2">
            <span
              className="inline-flex size-6 items-center justify-center rounded-full bg-primary text-[11px] text-primary-foreground"
              aria-hidden="true"
            >
              12
            </span>
            {t.availability.selected}
          </li>
        )}
      </ul>
    </div>
  );
}
