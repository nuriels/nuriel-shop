import { useEffect, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  MONTH_SHORT,
  currentPeriod,
  isFuturePeriod,
  periodLabel,
  shiftPeriod,
  type Period,
} from "@/lib/period";

export type { Period } from "@/lib/period";

/**
 * בורר תקופה קומפקטי: חצים לחודש/שנה הקודמים והבאים, ולחיצה על התווית
 * פותחת לוח קטן — בחירת שנה בלחיצה אחת (גם 5 שנים אחורה) ואז חודש, או
 * "כל השנה". חודשים עם הזמנות מסומנים בנקודה.
 */
export function PeriodPicker({
  value,
  onChange,
  years,
  monthsWithData,
}: {
  value: Period;
  onChange: (next: Period) => void;
  /** שנים שיש בהן הזמנות (השנה הנוכחית תמיד מוצגת) */
  years: number[];
  /** לכל שנה — אילו חודשים יש בהם הזמנות */
  monthsWithData: (year: number) => Set<number>;
}) {
  const [open, setOpen] = useState(false);
  const [shownYear, setShownYear] = useState(value.year);
  const thisYear = currentPeriod().year;
  const yearChips = [...new Set([thisYear, ...years])].sort((a, b) => b - a);

  useEffect(() => {
    if (open) setShownYear(value.year);
  }, [open, value.year]);

  const pick = (next: Period) => {
    onChange(next);
    setOpen(false);
  };
  const withData = monthsWithData(shownYear);

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-card">
      <Button
        size="icon"
        variant="ghost"
        className="size-9"
        aria-label={value.month === null ? "שנה קודמת" : "חודש קודם"}
        onClick={() => onChange(shiftPeriod(value, -1))}
      >
        <ChevronRight className="size-4" />
      </Button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" className="h-9 min-w-40 gap-2 px-3 font-semibold">
            <CalendarDays className="size-4 text-muted-foreground" />
            {periodLabel(value)}
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent dir="rtl" align="center" className="w-80 p-3 text-right">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">שנה</p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {yearChips.map((year) => (
              <button
                key={year}
                type="button"
                onClick={() => setShownYear(year)}
                aria-pressed={shownYear === year}
                className={cn(
                  "numeric rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  shownYear === year
                    ? "border-accent bg-secondary font-semibold text-foreground"
                    : "border-border text-foreground/80 hover:border-accent/60",
                )}
              >
                {year}
              </button>
            ))}
          </div>

          <p className="mb-2 text-xs font-semibold text-muted-foreground">חודש ב-{shownYear}</p>
          <div className="grid grid-cols-4 gap-1.5">
            {MONTH_SHORT.map((label, index) => {
              const month = index + 1;
              const candidate = { year: shownYear, month };
              const selected = value.year === shownYear && value.month === month;
              const disabled = isFuturePeriod(candidate);
              return (
                <button
                  key={month}
                  type="button"
                  disabled={disabled}
                  onClick={() => pick(candidate)}
                  className={cn(
                    "relative rounded-md border py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-35",
                    selected
                      ? "border-accent bg-accent font-semibold text-accent-foreground"
                      : "border-border hover:border-accent/60",
                  )}
                >
                  {label}
                  {withData.has(month) && !selected && (
                    <span
                      className="absolute left-1.5 top-1.5 size-1.5 rounded-full bg-accent"
                      aria-label="יש הזמנות"
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex gap-2 border-t border-border pt-3">
            <Button
              size="sm"
              variant={value.month === null && value.year === shownYear ? "default" : "outline"}
              className="flex-1"
              onClick={() => pick({ year: shownYear, month: null })}
            >
              כל שנת {shownYear}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => pick(currentPeriod())}>
              החודש
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Button
        size="icon"
        variant="ghost"
        className="size-9"
        aria-label={value.month === null ? "שנה הבאה" : "חודש הבא"}
        disabled={isFuturePeriod(shiftPeriod(value, 1))}
        onClick={() => onChange(shiftPeriod(value, 1))}
      >
        <ChevronLeft className="size-4" />
      </Button>
    </div>
  );
}
