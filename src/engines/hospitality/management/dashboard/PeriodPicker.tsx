// בחירת התקופה בלוח הבקרה (שלב F3): היום / השבוע / החודש / 30 הימים האחרונים / החודש הקודם /
// טווח מותאם (עד שנה, גם קדימה — לתחזית תפוסה). כפתורים עם aria-pressed; בטלפון — שורה נגללת.
import { useState } from "react";
import { CalendarRange } from "lucide-react";
import { Button, Input, Label, Popover, PopoverContent, PopoverTrigger, cn } from "@/platform/ui";
import { DASHBOARD_MAX_DAYS, rangeDays } from "../../validation/dashboard";
import { PERIOD_OPTIONS, type PeriodKey, periodText, shortDate } from "./model";

export function PeriodPicker({
  value,
  range,
  onChange,
}: {
  value: PeriodKey;
  range: { from: string; to: string };
  onChange: (key: PeriodKey, custom?: { from: string; to: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const error =
    !from || !to
      ? "יש לבחור שני תאריכים"
      : to < from
        ? "תאריך הסיום לפני תאריך ההתחלה"
        : rangeDays(from, to) > DASHBOARD_MAX_DAYS
          ? "אפשר להציג עד שנה אחת"
          : null;

  const base =
    "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-[10px] px-3.5 text-[13px] whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hm-lagoon-500)]";
  const on = "bg-[var(--hm-lagoon-900)] font-bold text-white shadow-sm";
  const off = "font-medium text-[var(--hm-ink-2)] hover:bg-[var(--hm-lagoon-100)]";

  return (
    <div
      role="group"
      aria-label="התקופה שמוצגת"
      className="flex max-w-full gap-1 overflow-x-auto rounded-xl border bg-card p-1 shadow-[var(--hm-shadow-card)] [scrollbar-width:none]"
    >
      {PERIOD_OPTIONS.filter((p) => p.key !== "custom").map((p) => (
        <button
          key={p.key}
          type="button"
          aria-pressed={value === p.key}
          onClick={() => onChange(p.key)}
          className={cn(base, value === p.key ? on : off)}
        >
          {p.label}
        </button>
      ))}
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) {
            setFrom(range.from);
            setTo(range.to);
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-pressed={value === "custom"}
            className={cn(base, value === "custom" ? on : off)}
          >
            <CalendarRange className="size-4" aria-hidden="true" />
            {value === "custom" ? periodText("custom", range) : "טווח מותאם"}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72" dir="rtl">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (error) return;
              onChange("custom", { from, to });
              setOpen(false);
            }}
          >
            <p className="text-sm font-bold">טווח תאריכים</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="dash-from" className="text-xs">
                  מתאריך
                </Label>
                <Input
                  id="dash-from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="min-h-10"
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="dash-to" className="text-xs">
                  עד תאריך
                </Label>
                <Input
                  id="dash-to"
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => setTo(e.target.value)}
                  className="min-h-10"
                  required
                />
              </div>
            </div>
            <p
              className={cn("text-xs", error ? "text-[var(--hm-danger)]" : "text-muted-foreground")}
              role={error ? "alert" : undefined}
            >
              {error ??
                `${shortDate(from)} – ${shortDate(to)} · ${rangeDays(from, to)} ימים. אפשר גם תאריכים קדימה, לתחזית תפוסה.`}
            </p>
            <Button type="submit" className="min-h-10" disabled={Boolean(error)}>
              הצגה
            </Button>
          </form>
        </PopoverContent>
      </Popover>
    </div>
  );
}
