import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import {
  CalendarClock,
  CalendarPlus,
  Eye,
  EyeOff,
  ImagePlus,
  Loader2,
  MoonStar,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { refreshSiteSettings } from "@/hooks/useSiteSettings";
import { saveRestSchedule, uploadRestImage } from "@/lib/site";
import {
  computeRestState,
  DEFAULT_HOLIDAY_MESSAGE,
  DEFAULT_SHABBAT_MESSAGE,
  formatLocalDay,
  formatLocalTime,
  holidayProblem,
  parseHolidays,
  REST_CHECKOUT_MESSAGE,
  REST_MESSAGE_MAX,
  reopenText,
  restGreeting,
  shortTime,
  timeToMinutes,
  upcomingYamimTovim,
  type Holiday,
} from "@/lib/rest-window";

/**
 * חלק 35: שמירת שבת וחג אוטומטית (שעון ישראל) — בלי לזכור להדליק מתג כל שבוע.
 * בחלון הזמן: האתר פתוח לגלישה ולאזור האישי, אבל אין הוספה לסל ואין הזמנות
 * (נאכף גם במסד). נשמר בכפתור משלו (לא בשמירת הגדרות האתר).
 *
 * חלק 35ב: ברכה ותמונה — לשבת ("שבת שלום" + תמונה), ולכל חג בנפרד
 * ("חג סוכות שמח" + תמונה). הלקוחות רואים אותן בכרטיס בעמוד הבית ובקופה,
 * ואת הברכה גם בפס העליון בכל האתר.
 */
export function ShabbatScheduleCard({
  enabled: initialEnabled,
  startTime: initialStart,
  endTime: initialEnd,
  holidays: initialHolidays,
  shabbatMessage: initialShabbatMessage = null,
  shabbatImageUrl: initialShabbatImage = null,
  onSaved,
}: {
  enabled: boolean;
  startTime: string;
  endTime: string;
  holidays: unknown;
  shabbatMessage?: string | null;
  shabbatImageUrl?: string | null;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [startTime, setStartTime] = useState(shortTime(initialStart, "16:00"));
  const [endTime, setEndTime] = useState(shortTime(initialEnd, "20:30"));
  const [holidays, setHolidays] = useState<Holiday[]>(() => parseHolidays(initialHolidays));
  const [shabbatMessage, setShabbatMessage] = useState(initialShabbatMessage ?? "");
  const [shabbatImage, setShabbatImage] = useState<string | null>(initialShabbatImage);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<"shabbat" | number | null>(null);
  const snapshot = (value: {
    enabled: boolean;
    startTime: string;
    endTime: string;
    holidays: Holiday[];
    shabbatMessage: string;
    shabbatImage: string | null;
  }) => JSON.stringify(value);
  const [saved, setSaved] = useState(() =>
    snapshot({
      enabled: initialEnabled,
      startTime: shortTime(initialStart, "16:00"),
      endTime: shortTime(initialEnd, "20:30"),
      holidays: parseHolidays(initialHolidays),
      shabbatMessage: initialShabbatMessage ?? "",
      shabbatImage: initialShabbatImage,
    }),
  );
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const current = snapshot({ enabled, startTime, endTime, holidays, shabbatMessage, shabbatImage });
  const dirty = current !== saved;
  const restSettings = useMemo(
    () => ({
      enabled,
      startTime,
      endTime,
      holidays,
      shabbatMessage: shabbatMessage.trim() || null,
      shabbatImageUrl: shabbatImage,
    }),
    [enabled, startTime, endTime, holidays, shabbatMessage, shabbatImage],
  );
  const state = useMemo(() => computeRestState(restSettings, now), [restSettings, now]);
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
    if (shabbatMessage.trim().length > REST_MESSAGE_MAX) {
      toast.error(`ברכת השבת: עד ${REST_MESSAGE_MAX} תווים`);
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
        message: h.message?.trim() || null,
        imageUrl: h.imageUrl ?? null,
      }));
      await saveRestSchedule({
        enabled,
        startTime,
        endTime,
        holidays: clean,
        shabbatMessage: shabbatMessage.trim() || null,
        shabbatImageUrl: shabbatImage,
      });
      const fresh = await refreshSiteSettings();
      const stored = parseHolidays(fresh?.holidays);
      const storedMessage = fresh?.shabbat_message ?? "";
      const storedImage = fresh?.shabbat_image_url ?? null;
      setHolidays(stored);
      setShabbatMessage(storedMessage);
      setShabbatImage(storedImage);
      setSaved(
        snapshot({
          enabled,
          startTime,
          endTime,
          holidays: stored,
          shabbatMessage: storedMessage,
          shabbatImage: storedImage,
        }),
      );
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

        {/* ---------- חלק 35ב: הברכה והתמונה לשבת ---------- */}
        <div
          className="space-y-3 rounded-lg border border-border p-3"
          data-testid="shabbat-greeting"
        >
          <p className="flex items-center gap-2 text-sm font-semibold">
            <MoonStar className="size-4 text-indigo-700 dark:text-indigo-300" aria-hidden="true" />
            מה הלקוחות רואים בשבת
          </p>
          <div className="grid items-start gap-3 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1">
              <Label htmlFor="shabbat-message" className="text-xs">
                ברכה
              </Label>
              <Input
                id="shabbat-message"
                value={shabbatMessage}
                maxLength={REST_MESSAGE_MAX}
                placeholder={DEFAULT_SHABBAT_MESSAGE}
                onChange={(e) => setShabbatMessage(e.target.value)}
                data-testid="shabbat-message"
              />
              <p className="text-[11px] text-muted-foreground">
                ריק = "{DEFAULT_SHABBAT_MESSAGE}". למשל: "שבת שלום ומבורך".
              </p>
            </div>
            <RestImageField
              kind="shabbat"
              value={shabbatImage}
              onChange={setShabbatImage}
              testId="shabbat-image"
            />
          </div>
          <PreviewToggle
            open={preview === "shabbat"}
            onToggle={() => setPreview((p) => (p === "shabbat" ? null : "shabbat"))}
            testId="shabbat-preview-toggle"
          />
          {preview === "shabbat" && (
            <GreetingPreview
              message={shabbatMessage.trim() || DEFAULT_SHABBAT_MESSAGE}
              imageUrl={shabbatImage}
              reopen={`במוצאי שבת בשעה ${endTime}`}
            />
          )}
        </div>

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
              הלקוחות רואים "{restGreeting(state)}", וחוזרים לפעילות {reopenText(state)}.
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
                      `נוספו ${suggestions.length} חגים לשנה הקרובה (עם ברכה לכל חג) — בדקו את השעות, הוסיפו תמונות ושמרו`,
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
                onClick={() =>
                  setHolidays((list) => [
                    ...list,
                    { name: "", start: "", end: "", message: "", imageUrl: null },
                  ])
                }
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
              סוכות, שמחת תורה, פסח, שביעי של פסח ושבועות) לפי הלוח העברי, עם השעות שלמעלה וברכה
              מוכנה לכל חג ("חג סוכות שמח", "שנה טובה ומתוקה"...). אפשר לשנות את הברכה ולהוסיף
              תמונה.
            </p>
          ) : (
            <ul className="space-y-2">
              {holidays.map((holiday, index) => {
                const problem = holiday.start && holiday.end ? holidayProblem(holiday) : null;
                return (
                  <li
                    key={index}
                    className="space-y-2 rounded-lg border border-border p-2"
                    data-testid="holiday-row"
                  >
                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
                      <div className="space-y-1">
                        <Label className="text-xs">שם</Label>
                        <Input
                          value={holiday.name ?? ""}
                          maxLength={60}
                          placeholder="למשל: סוכות"
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
                        onClick={() => {
                          setHolidays((list) => list.filter((_, i) => i !== index));
                          setPreview(null);
                        }}
                        aria-label={`מחיקת ${holiday.name || "החג"}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                    {/* חלק 35ב: הברכה והתמונה של החג */}
                    <div className="grid items-start gap-2 sm:grid-cols-[1fr_auto]">
                      <div className="space-y-1">
                        <Label className="text-xs">ברכה ללקוחות</Label>
                        <Input
                          value={holiday.message ?? ""}
                          maxLength={REST_MESSAGE_MAX}
                          placeholder={`למשל: חג ${holiday.name?.trim() || "סוכות"} שמח`}
                          onChange={(e) => patchHoliday(index, { message: e.target.value })}
                          data-testid="holiday-message"
                        />
                        <PreviewToggle
                          open={preview === index}
                          onToggle={() => setPreview((p) => (p === index ? null : index))}
                          testId="holiday-preview-toggle"
                        />
                      </div>
                      <RestImageField
                        kind="holiday"
                        value={holiday.imageUrl ?? null}
                        onChange={(url) => patchHoliday(index, { imageUrl: url })}
                        testId="holiday-image"
                      />
                    </div>
                    {preview === index && (
                      <GreetingPreview
                        message={holiday.message?.trim() || DEFAULT_HOLIDAY_MESSAGE}
                        imageUrl={holiday.imageUrl ?? null}
                        reopen={
                          holiday.end ? `בצאת החג (${holiday.end.replace("T", " ")})` : "בצאת החג"
                        }
                      />
                    )}
                    {problem && <p className="text-xs text-destructive">{problem}</p>}
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

/** העלאת תמונה לשבת / לחג: תמונה קטנה, החלפה והסרה */
function RestImageField({
  kind,
  value,
  onChange,
  testId,
}: {
  kind: "shabbat" | "holiday";
  value: string | null;
  onChange: (url: string | null) => void;
  testId: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      onChange(await uploadRestImage(file, kind));
      toast.success('התמונה הועלתה — לחצו "שמירה" כדי שתופיע באתר');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "העלאת התמונה נכשלה");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-1" data-testid={testId}>
      <Label className="text-xs">{kind === "shabbat" ? "תמונה לשבת" : "תמונה לחג"}</Label>
      <div className="flex items-center gap-2">
        {value ? (
          <div className="relative">
            <img
              src={value}
              alt=""
              className="h-16 w-28 rounded-md border border-border object-cover"
              data-testid={`${testId}-preview`}
            />
            <button
              type="button"
              className="absolute -left-1.5 -top-1.5 rounded-full border border-border bg-background p-0.5 text-muted-foreground shadow hover:text-destructive"
              onClick={() => onChange(null)}
              aria-label="הסרת התמונה"
              data-testid={`${testId}-remove`}
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ImagePlus className="size-4" />
          )}
          {value ? "החלפה" : "העלאת תמונה"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void upload(e.target.files?.[0])}
          data-testid={`${testId}-input`}
        />
      </div>
    </div>
  );
}

function PreviewToggle({
  open,
  onToggle,
  testId,
}: {
  open: boolean;
  onToggle: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
      data-testid={testId}
    >
      {open ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
      {open ? "הסתרת התצוגה המקדימה" : "תצוגה מקדימה — איך הלקוחות יראו"}
    </button>
  );
}

/** תצוגה מקדימה — כמו כרטיס הברכה באתר (RestGreetingCard) */
function GreetingPreview({
  message,
  imageUrl,
  reopen,
}: {
  message: string;
  imageUrl: string | null;
  reopen: string;
}) {
  return (
    <div
      className="overflow-hidden rounded-xl bg-indigo-950 text-center text-indigo-50"
      data-testid="greeting-preview"
    >
      {imageUrl ? (
        <img src={imageUrl} alt={message} className="block max-h-48 w-full object-cover" />
      ) : (
        <div className="flex justify-center pt-4" aria-hidden="true">
          <MoonStar className="size-8 text-amber-300" />
        </div>
      )}
      <div className="space-y-1 px-4 py-4">
        <p className="font-display text-xl font-bold">{message}</p>
        <p className="text-sm">{REST_CHECKOUT_MESSAGE}</p>
        <p className="text-xs opacity-80">נחזור לפעילות {reopen}.</p>
      </div>
    </div>
  );
}
