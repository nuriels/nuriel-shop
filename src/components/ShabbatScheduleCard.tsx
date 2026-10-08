import { useEffect, useMemo, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { CalendarClock, CalendarPlus, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { refreshSiteSettings } from "@/hooks/useSiteSettings";
import { saveRestSchedule } from "@/lib/site";
import {
  computeRestState,
  formatLocalDay,
  formatLocalTime,
  holidayProblem,
  parseHolidays,
  reopenText,
  shortTime,
  timeToMinutes,
  upcomingYamimTovim,
  type Holiday,
} from "@/lib/rest-window";

/**
 * חלק 35: שמירת שבת וחג אוטומטית (שעון ישראל) — בלי לזכור להדליק מתג כל שבוע.
 * בחלון הזמן: האתר פתוח לגלישה ולאזור האישי, אבל אין הוספה לסל ואין הזמנות
 * (נאכף גם במסד). נשמר בכפתור משלו (לא בשמירת הגדרות האתר).
 */
export function ShabbatScheduleCard({
  enabled: initialEnabled,
  startTime: initialStart,
  endTime: initialEnd,
  holidays: initialHolidays,
  onSaved,
}: {
  enabled: boolean;
  startTime: string;
  endTime: string;
  holidays: unknown;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [startTime, setStartTime] = useState(shortTime(initialStart, "16:00"));
  const [endTime, setEndTime] = useState(shortTime(initialEnd, "20:30"));
  const [holidays, setHolidays] = useState<Holiday[]>(() => parseHolidays(initialHolidays));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(() =>
    JSON.stringify({
      enabled: initialEnabled,
      startTime: shortTime(initialStart, "16:00"),
      endTime: shortTime(initialEnd, "20:30"),
      holidays: parseHolidays(initialHolidays),
    }),
  );
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const current = JSON.stringify({ enabled, startTime, endTime, holidays });
  const dirty = current !== saved;
  const state = useMemo(
    () => computeRestState({ enabled, startTime, endTime, holidays }, now),
    [enabled, startTime, endTime, holidays, now],
  );
  const suggestions = useMemo(
    () => upcomingYamimTovim({ startTime, endTime, holidays }, now),
    [startTime, endTime, holidays, now],
  );

  const patchHoliday = (index: number, next: Partial<Holiday>) =>
    setHolidays((list) => list.map((h, i) => (i === index ? { ...h, ...next } : h)));

  const save = async () => {
    if (timeToMinutes(startTime) === null || timeToMinutes(endTime) === null) {
      toast.error("נא להזין שעת כניסה ושעת צאת שבת תקינות");
      return;
    }
    for (const holiday of holidays) {
      const problem = holidayProblem(holiday);
      if (problem) {
        toast.error(problem);
        return;
      }
    }
    setBusy(true);
    try {
      const clean = holidays.map((h) => ({
        name: h.name?.trim() || null,
        start: h.start,
        end: h.end,
      }));
      await saveRestSchedule({ enabled, startTime, endTime, holidays: clean });
      const fresh = await refreshSiteSettings();
      const stored = parseHolidays(fresh?.holidays);
      setHolidays(stored);
      setSaved(JSON.stringify({ enabled, startTime, endTime, holidays: stored }));
      // האתר נשען על נתוני ה-root — טוענים מחדש כדי שהשינוי יחול מיד
      await router.invalidate();
      onSaved?.();
      toast.success(enabled ? "שמירת שבת וחג אוטומטית נשמרה" : "שמירת שבת וחג אוטומטית כובתה");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "השמירה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      className={enabled ? "border-indigo-300 shadow-card dark:border-indigo-800" : "shadow-card"}
      data-testid="shabbat-schedule-card"
    >
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="size-4" aria-hidden="true" /> שמירת שבת וחג אוטומטית
        </CardTitle>
        <Button
          size="sm"
          disabled={busy || !dirty}
          onClick={() => void save()}
          data-testid="shabbat-save"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          שמירה
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
          <span className="space-y-1">
            <span className="block text-sm font-medium">
              {enabled ? "פעיל — האתר נסגר להזמנות אוטומטית" : "להפעיל סגירה אוטומטית בשבת ובחגים"}
            </span>
            <span className="block text-xs leading-5 text-muted-foreground">
              לפי שעון ישראל, בלי טיימרים: בזמן השבת / החג הלקוחות ממשיכים לגלוש בקטלוג ולהיכנס
              ל"ההזמנות שלי", אבל כפתורי "הוסף לסל" מושבתים והקופה נעולה עם ההודעה "האתר שומר שבת/חג
              ויחזור לפעילות בצאת השבת/חג". הקופה המהירה בחנות לא נחסמת.
            </span>
          </span>
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label="שמירת שבת וחג אוטומטית"
            data-testid="shabbat-auto-switch"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="shabbat-start">כניסת שבת — יום שישי בשעה</Label>
            <Input
              id="shabbat-start"
              type="time"
              dir="ltr"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              data-testid="shabbat-start"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="shabbat-end">צאת שבת — מוצאי שבת בשעה</Label>
            <Input
              id="shabbat-end"
              type="time"
              dir="ltr"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              data-testid="shabbat-end"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          טיפ: קבעו את שעת הכניסה מוקדם מעט מהדלקת הנרות בחורף, כדי שלא ייכנסו הזמנות סמוך לשבת.
        </p>

        <div
          className="rounded-lg bg-secondary/50 p-3 text-sm"
          role="status"
          data-testid="shabbat-now"
        >
          {!enabled ? (
            <span className="text-muted-foreground">כבוי — האתר פתוח להזמנות תמיד.</span>
          ) : state.closed ? (
            <span className="font-medium">
              עכשיו: האתר סגור להזמנות ({state.kind === "holiday" ? (state.name ?? "חג") : "שבת"}) —
              חוזר לפעילות {reopenText(state)}.
            </span>
          ) : state.nextCloseAt !== null ? (
            <span>
              עכשיו: פתוח. הסגירה הבאה — {formatLocalDay(state.nextCloseAt)} בשעה{" "}
              {formatLocalTime(state.nextCloseAt)}
              {state.nextKind === "holiday" && state.nextName ? ` (${state.nextName})` : ""}.
            </span>
          ) : (
            <span>עכשיו: פתוח.</span>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">חגים (תאריך ושעה — שעון ישראל)</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.length > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setHolidays((list) => [...list, ...suggestions]);
                    toast.success(
                      `נוספו ${suggestions.length} חגים לשנה הקרובה — בדקו את השעות ושמרו`,
                    );
                  }}
                  data-testid="holidays-suggest"
                >
                  <CalendarPlus className="size-4" />
                  הוספת חגי השנה הקרובה ({suggestions.length})
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setHolidays((list) => [...list, { name: "", start: "", end: "" }])}
                data-testid="holiday-add"
              >
                <Plus className="size-4" />
                חג ידני
              </Button>
            </div>
          </div>
          {holidays.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              עדיין אין חגים ברשימה. "הוספת חגי השנה הקרובה" מוסיפה את ימי החג (ראש השנה, יום כיפור,
              סוכות, שמחת תורה, פסח, שביעי של פסח ושבועות) לפי הלוח העברי, עם השעות שלמעלה.
            </p>
          ) : (
            <ul className="space-y-2">
              {holidays.map((holiday, index) => {
                const problem = holiday.start && holiday.end ? holidayProblem(holiday) : null;
                return (
                  <li
                    key={index}
                    className="grid gap-2 rounded-lg border border-border p-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
                    data-testid="holiday-row"
                  >
                    <div className="space-y-1">
                      <Label className="text-xs">שם</Label>
                      <Input
                        value={holiday.name ?? ""}
                        maxLength={60}
                        placeholder="למשל: פסח"
                        onChange={(e) => patchHoliday(index, { name: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">כניסה (ערב החג)</Label>
                      <Input
                        type="datetime-local"
                        dir="ltr"
                        value={holiday.start}
                        onChange={(e) => patchHoliday(index, { start: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">יציאה (צאת החג)</Label>
                      <Input
                        type="datetime-local"
                        dir="ltr"
                        value={holiday.end}
                        onChange={(e) => patchHoliday(index, { end: e.target.value })}
                      />
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => setHolidays((list) => list.filter((_, i) => i !== index))}
                      aria-label={`מחיקת ${holiday.name || "החג"}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                    {problem && <p className="text-xs text-destructive sm:col-span-4">{problem}</p>}
                  </li>
                );
              })}
            </ul>
          )}
          {holidays.length > 0 && (
            <Badge variant="outline" className="text-xs font-normal">
              {holidays.length} חגים ברשימה (עד 60)
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
