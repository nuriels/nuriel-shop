// לוח התפוסה של לוח הבקרה (שלב F3): 14 הלילות הקרובים, שורה לכל יחידה, פס לכל הזמנה / תאריכים
// מ-Airbnb / Booking / חסימה, ותפוסה לכל לילה. לחיצה על הזמנה — לעמוד ההזמנה. בטלפון — גלילה
// אופקית עם שמות היחידות קבועים בצד.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BedDouble, ChevronLeft } from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "@/platform/ui";
import { hospitalityCalendar } from "../../api/calendar.functions";
import { DAY_SHORT, calendarKey } from "../calendar/model";
import { EmptyState, ErrorState, SectionCard, SkeletonBlock } from "../ui/kit";
import { BOARD_DAYS, BOARD_KIND_LABELS, type BoardBar, type BoardKind, boardModel } from "./board";
import { addDays, shortDate } from "./model";

const KIND_STYLE: Record<BoardKind, { className: string; style?: CSSProperties }> = {
  direct: { className: "bg-[var(--hm-direct)] text-white" },
  airbnb: { className: "bg-[var(--hm-airbnb)] text-white" },
  booking: { className: "bg-[var(--hm-booking)] text-white" },
  channel: { className: "bg-[var(--hm-channel)] text-white" },
  pending: {
    className:
      "border-2 border-dashed border-[var(--hm-warning-dot)] bg-[var(--hm-warning-bg)] text-[var(--hm-warning)]",
  },
  block: {
    className: "text-[var(--hm-neutral)]",
    style: { backgroundImage: "var(--hm-block-stripes)" },
  },
};

const LEGEND: BoardKind[] = ["direct", "airbnb", "booking", "pending", "block"];

export function OccupancyBoard({ today }: { today: string }) {
  const to = addDays(today, BOARD_DAYS);
  const query = useQuery({
    queryKey: calendarKey(today, to, null, false),
    queryFn: () =>
      hospitalityCalendar({ data: { from: today, to, unitIds: null, includeCancelled: false } }),
    refetchInterval: 120_000,
  });
  const model = query.data ? boardModel(query.data, today, BOARD_DAYS) : null;

  return (
    <SectionCard
      title={`לוח תפוסה — ${BOARD_DAYS} הלילות הקרובים`}
      description="כולל Airbnb ו-Booking. חסימה פנימית מורידה זמינות ולא נספרת כלינה."
      actions={
        <Link
          to="/manage/calendar"
          className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-[var(--hm-lagoon-500)] hover:underline"
        >
          ליומן המלא
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Link>
      }
    >
      {query.isPending ? (
        <SkeletonBlock className="h-56" />
      ) : query.isError || !model ? (
        <ErrorState message="לוח התפוסה לא נטען." onRetry={() => void query.refetch()} />
      ) : model.rows.length === 0 ? (
        <EmptyState
          icon={BedDouble}
          title="עוד אין יחידות פעילות"
          text="כשתוסיפו יחידה ותפעילו אותה, התפוסה שלה תופיע כאן."
          action={
            <Link
              to="/manage/units"
              search={{ add: "unit" }}
              className="inline-flex min-h-11 items-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground"
            >
              הוספת יחידה
            </Link>
          }
        />
      ) : (
        <>
          <div
            className="-mx-5 overflow-x-auto px-5 sm:-mx-6 sm:px-6"
            tabIndex={0}
            aria-label="לוח התפוסה — אפשר לגלול לצדדים"
            role="region"
          >
            <div
              className="grid min-w-[620px] text-xs"
              style={{ gridTemplateColumns: `7.5rem repeat(${BOARD_DAYS}, minmax(0, 1fr))` }}
            >
              {/* כותרת: הימים */}
              <div className="sticky start-0 z-10 bg-card" />
              {model.days.map((d) => (
                <div
                  key={d.date}
                  className={cn(
                    "flex flex-col items-center rounded-t-lg py-1.5",
                    d.today && "bg-[var(--hm-lagoon-100)] font-bold text-[var(--hm-lagoon-900)]",
                    !d.today && d.weekend && "bg-[var(--hm-surface-2)]",
                  )}
                >
                  <span className="text-muted-foreground">{DAY_SHORT[d.dow]}</span>
                  <span data-num="">{shortDate(d.date)}</span>
                </div>
              ))}

              {/* היחידות */}
              {model.rows.map((row) => (
                <div key={row.id} className="contents">
                  <div className="sticky start-0 z-10 flex min-h-11 items-center truncate border-t bg-card pe-2 text-[13px] font-semibold">
                    {row.name}
                  </div>
                  <div
                    className="relative grid border-t py-1.5"
                    style={{
                      gridColumn: `2 / span ${BOARD_DAYS}`,
                      gridTemplateColumns: `repeat(${BOARD_DAYS}, minmax(0, 1fr))`,
                    }}
                  >
                    {model.days.map((d, i) => (
                      <span
                        key={d.date}
                        aria-hidden="true"
                        className={cn(
                          "row-start-1 border-s border-[var(--hm-line-soft)]",
                          d.today && "bg-[var(--hm-lagoon-50)]",
                          !d.today && d.weekend && "bg-[var(--hm-surface-2)]",
                        )}
                        style={{ gridColumn: `${i + 1}` }}
                      />
                    ))}
                    {row.bars.map((b) => (
                      <BoardBarView key={b.key} bar={b} />
                    ))}
                  </div>
                </div>
              ))}

              {/* תפוסה לכל לילה */}
              <div className="sticky start-0 z-10 flex min-h-10 items-center border-t-2 bg-card pe-2 text-[12px] font-bold text-[var(--hm-ink-2)]">
                תפוסה ללילה
              </div>
              {model.nights.map((n) => (
                <div
                  key={n.date}
                  className="flex min-h-10 items-center justify-center border-t-2 font-bold"
                  title={`${n.occupied} מתוך ${n.available} יחידות`}
                  data-num=""
                >
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-0.5",
                      n.pct === null
                        ? "text-muted-foreground"
                        : n.pct >= 80
                          ? "bg-[var(--hm-success-bg)] text-[var(--hm-success)]"
                          : n.pct >= 40
                            ? "bg-[var(--hm-lagoon-100)] text-[var(--hm-lagoon-700)]"
                            : "text-[var(--hm-ink-2)]",
                    )}
                  >
                    {n.pct === null ? "—" : `${n.pct}%`}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <ul
            className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-[var(--hm-ink-2)]"
            aria-label="מקרא"
          >
            {LEGEND.map((k) => (
              <li key={k} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn("inline-block h-3 w-5 rounded", KIND_STYLE[k].className)}
                  style={KIND_STYLE[k].style}
                />
                {BOARD_KIND_LABELS[k]}
              </li>
            ))}
          </ul>
        </>
      )}
    </SectionCard>
  );
}

function BoardBarView({ bar }: { bar: BoardBar }) {
  const s = KIND_STYLE[bar.kind];
  const text = `${BOARD_KIND_LABELS[bar.kind]}${bar.bookingNumber ? ` #${bar.bookingNumber}` : ""} · ${bar.label} · ${bar.span} לילות${bar.via ? " (כל המתחם)" : ""}`;
  const cls = cn(
    "relative z-[1] row-start-1 mx-0.5 flex min-h-8 items-center overflow-hidden px-2 text-[11px] font-semibold whitespace-nowrap shadow-sm",
    bar.clippedStart ? "rounded-s-none" : "rounded-s-lg",
    bar.clippedEnd ? "rounded-e-none" : "rounded-e-lg",
    bar.via && "outline-1 -outline-offset-[3px] outline-white/70 outline-dashed",
    s.className,
  );
  const style: CSSProperties = { gridColumn: `${bar.start + 1} / span ${bar.span}`, ...s.style };
  if (bar.bookingId)
    return (
      <Link
        to="/manage/bookings/$bookingId"
        params={{ bookingId: bar.bookingId }}
        className={cn(
          cls,
          "hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--hm-lagoon-500)]",
        )}
        style={style}
        title={text}
        aria-label={text}
      >
        <span className="truncate">{bar.label}</span>
      </Link>
    );
  return (
    <span className={cls} style={style} title={text}>
      <span className="truncate">{bar.label}</span>
      <span className="sr-only"> — {text}</span>
    </span>
  );
}
