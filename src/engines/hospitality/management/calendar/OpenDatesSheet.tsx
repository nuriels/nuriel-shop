// פתיחת תאריכים להזמנה (מיגרציה 43): לכל יחידה — עד איזה לילה אפשר להזמין אותה באתר. פתיחה / הארכה
// לכמה יחידות בבת אחת (תאריכים מוכנים או תאריך משלכם), וסגירה. ההזמנות שכבר קיימות לא משתנות, והצוות
// יכול להוסיף הזמנה ידנית גם בתאריך סגור.
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Input, Label, cn } from "@/platform/ui";
import { hospitalityOpenDates } from "../../api/calendar.functions";
import type { CalendarView } from "../../types/calendar";
import { openDatesError } from "../../validation/calendar";
import { FormSheet } from "../catalog/CatalogSheets";
import { ConfirmButton } from "../catalog/parts";
import { errorText } from "../catalog/refresh";
import { diffDays, shortDate } from "./model";
import {
  QUICK_LABELS,
  openStatus,
  openText,
  quickUntil,
  type OpenState,
  type QuickUntil,
} from "./open-dates";

const STATE_CLASS: Record<OpenState, string> = {
  closed: "bg-[var(--hm-danger-bg)] text-[var(--hm-danger)]",
  ending: "bg-amber-100 text-amber-950",
  open: "bg-emerald-50 text-emerald-900",
};
const STATE_LABEL: Record<OpenState, string> = {
  closed: "סגור",
  ending: "נגמר בקרוב",
  open: "פתוח",
};

export function OpenDatesSheet(props: {
  view: CalendarView;
  onClose: () => void;
  onDone: () => void;
}) {
  const { view } = props;
  const today = view.today;
  const units = useMemo(() => view.units.filter((u) => u.is_active), [view.units]);
  // ברירת מחדל: היחידות שצריכות טיפול (סגורות / נגמרות בקרוב); אין כאלה — כולן
  const [selected, setSelected] = useState<Set<string>>(() => {
    const need = units.filter((u) => openStatus(u, today).state !== "open").map((u) => u.id);
    return new Set(need.length ? need : units.map((u) => u.id));
  });
  const [until, setUntil] = useState(() => quickUntil("three", today));
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const error =
    selected.size === 0 ? "יש לבחור לפחות יחידה אחת" : openDatesError(until || null, today);
  const nights = until && until >= today ? diffDays(today, until) + 1 : 0;

  const save = async (value: string | null) => {
    setBusy(true);
    setServerError(null);
    try {
      const r = await hospitalityOpenDates({ data: { unitIds: [...selected], until: value } });
      const count = selected.size === 1 ? "יחידה אחת" : `${selected.size} יחידות`;
      toast.success(
        value ? `${count} פתוחות להזמנה עד ${shortDate(value)}` : `${count} נסגרו להזמנות באתר`,
      );
      if (r.updated === 0 && value) toast.message("התאריכים כבר היו פתוחים בדיוק כך");
      props.onDone();
      props.onClose();
    } catch (e) {
      setServerError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    setSubmitted(true);
    if (error) return;
    await save(until);
  };
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const all = selected.size === units.length && units.length > 0;
  const byProperty = view.properties
    .map((p) => ({ ...p, units: units.filter((u) => u.property_id === p.id) }))
    .filter((p) => p.units.length > 0);

  return (
    <FormSheet
      open
      title="פתיחת תאריכים להזמנה"
      description="אורחים יכולים להזמין באתר רק בתאריכים שפתחתם. ההזמנות שכבר קיימות לא משתנות, ואתם יכולים להוסיף הזמנה ידנית גם בתאריך סגור."
      dirty={false}
      busy={busy}
      submitLabel={
        until && !openDatesError(until, today) ? `פתיחה עד ${shortDate(until)}` : "פתיחה"
      }
      serverError={serverError}
      notice={null}
      hasErrors={Boolean(error)}
      submitted={submitted}
      onSubmit={() => void submit()}
      onClose={props.onClose}
    >
      <fieldset className="flex flex-col gap-2" data-testid="open-dates-units">
        <legend className="mb-1 text-sm font-medium">יחידות</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="size-5 accent-primary"
            checked={all}
            onChange={() => setSelected(all ? new Set() : new Set(units.map((u) => u.id)))}
          />
          כל היחידות
        </label>
        {byProperty.map((p) => (
          <div key={p.id} className="flex flex-col gap-1">
            {byProperty.length > 1 && (
              <p className="text-xs font-semibold text-muted-foreground">{p.name}</p>
            )}
            <ul className="flex flex-col gap-1">
              {p.units.map((u) => {
                const s = openStatus(u, today);
                return (
                  <li key={u.id}>
                    <label
                      className={cn(
                        "flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2",
                        selected.has(u.id) && "border-primary bg-primary/5",
                      )}
                      data-open-unit={u.name}
                    >
                      <input
                        type="checkbox"
                        className="size-5 shrink-0 accent-primary"
                        checked={selected.has(u.id)}
                        onChange={() => toggle(u.id)}
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium">
                          {u.kind === "whole_property" ? `${u.name} (כל המתחם)` : u.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {openText(s, shortDate)}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
                          STATE_CLASS[s.state],
                        )}
                        data-open-state={s.state}
                      >
                        {STATE_LABEL[s.state]}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">פתוח להזמנות עד (הלילה האחרון, כולל)</legend>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="תאריכים מוכנים">
          {(Object.keys(QUICK_LABELS) as QuickUntil[]).map((k) => {
            const value = quickUntil(k, today);
            return (
              <button
                key={k}
                type="button"
                aria-pressed={until === value}
                onClick={() => setUntil(value)}
                className={cn(
                  "min-h-11 rounded-full border px-3 text-sm",
                  until === value
                    ? "border-primary bg-primary text-primary-foreground"
                    : "hover:bg-muted",
                )}
              >
                {QUICK_LABELS[k]}
              </button>
            );
          })}
        </div>
        <Label htmlFor="od-until" className="sr-only">
          עד תאריך
        </Label>
        <Input
          id="od-until"
          type="date"
          dir="ltr"
          min={today}
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          className="min-h-11 w-fit"
        />
        {nights > 0 && !openDatesError(until, today) && (
          <p className="text-sm" data-testid="open-dates-summary">
            {selected.size === 1 ? "יחידה אחת תהיה פתוחה" : `${selected.size} יחידות יהיו פתוחות`}{" "}
            להזמנה מהיום עד {shortDate(until)} — {nights === 1 ? "לילה אחד" : `${nights} לילות`}.
          </p>
        )}
        {submitted && error && <p className="text-sm text-destructive">{error}</p>}
      </fieldset>

      <div className="flex flex-col gap-1 border-t pt-3">
        <p className="text-xs text-muted-foreground">
          סוגרים יחידה להזמנות באתר — למשל בעונה שלא משכירים. אפשר לפתוח שוב בכל רגע.
        </p>
        <ConfirmButton
          label="סגירת היחידות שנבחרו להזמנות"
          title="לסגור להזמנות באתר?"
          description={
            <p>
              אורחים לא יוכלו להזמין באתר את{" "}
              {selected.size === 1 ? "היחידה שנבחרה" : `${selected.size} היחידות שנבחרו`} עד שתפתחו
              תאריכים שוב. ההזמנות שכבר קיימות לא משתנות.
            </p>
          }
          confirmLabel="סגירה להזמנות"
          destructive
          disabled={selected.size === 0 || busy}
          onConfirm={() => save(null)}
        />
      </div>
    </FormSheet>
  );
}
