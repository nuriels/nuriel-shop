// מסך "יומן" (/manage/calendar) — Stage 3a: כלי העבודה היומי. חודש / שבוע (יחידות בשורות לפי
// מתחם, תאריכים בעמודות, עמודת היחידה והכותרת קבועות, היום מסומן, סוף שבוע מוצלל), סדר יום
// (ברירת המחדל בטלפון), פסים להזמנות ולחסימות בצבע + דוגמה + טקסט, "כל המתחם" ויחידותיו,
// סינון (מתחם, סוג יחידה, מצב, מבוטלות), חיפוש, לחיצה על הזמנה → סיכום, על חסימה → פרטים
// ושחרור; חסימה מהלוח (לחיצה על יום ראשון ואחרון בשורה) או מהטופס (מקלדת). רענון אוטומטי:
// בדיקת שינוי זולה כל 30 שניות כשהדף פתוח, בחזרה ללשונית ואחרי כל פעולה. שורות וירטואליות.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Lock,
  LogIn,
  LogOut,
  RefreshCw,
  Search,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  cn,
  useIsMobile,
} from "@/platform/ui";
import { hospitalityChannels } from "../../api/channels.functions";
import { hospitalityRoomTypes } from "../../api/room-types.functions";
import type { ChannelUnit } from "../../types/channels";
import {
  hospitalityCalendar,
  hospitalityCalendarStamp,
  hospitalityCreateBlock,
  hospitalityReleaseBlock,
  hospitalityUpcomingBlocks,
  hospitalityUpdateBlock,
} from "../../api/calendar.functions";
import type { CalendarBlock, CalendarBooking, CalendarView } from "../../types/calendar";
import { blockError } from "../../validation/calendar";
import { FormSheet } from "../catalog/CatalogSheets";
import { UNIT_TYPE_LABELS } from "../catalog/labels";
import { ConfirmButton, LoadError, PageSkeleton } from "../catalog/parts";
import { errorText } from "../catalog/refresh";
import { manageKeys } from "../lib/query-keys";
import { useManagement } from "../shell/management-context";
import {
  hospitalityApproveBooking,
  hospitalityBookingDetail,
  hospitalitySetStayStatus,
} from "../../api/bookings.functions";
import { actionsFor, bookingKey, STATE_LABELS as BOOKING_STATE } from "../bookings/model";
import { useBookingRefresh } from "../bookings/refresh";
import {
  DAY_SHORT,
  STATUS_LABELS,
  TONE_LABELS,
  addDays,
  agenda,
  dayOverview,
  buildRows,
  calendarKey,
  dayLabel,
  daysOf,
  diffDays,
  dow,
  isFreeNight,
  monthTitle,
  nightsText,
  rangeFor,
  search,
  shift,
  toneOf,
  visibleWindow,
  blockSource,
  bookingSource,
  conflictMarks,
  freeByNight,
  maskGuests,
  monthAnchor,
  monthOptions,
  shortDate,
  unitCards,
  NIGHT_LABELS,
  type Bar,
  type ConflictMark,
  type NightState,
  type UnitCard,
  type Filters,
  type Row,
  type Tone,
  type ViewMode,
} from "./model";

const ROW_H = 44;
/** שורת "פנויות" מתחת לתאריכים (Calendar Pro) */
const SUM_H = 26;
const COL_W = 40;
const NAME_W = 150;
const REFRESH_MS = 30_000;

const TONE_CLASS: Record<Tone, string> = {
  pending: "bg-amber-100 text-amber-950 border-amber-500 border-dashed",
  confirmed: "bg-emerald-700 text-white border-emerald-900",
  staying: "bg-sky-700 text-white border-sky-900",
  past: "bg-slate-300 text-slate-900 border-slate-500",
  cancelled: "bg-white text-slate-600 border-slate-400 line-through",
  block:
    "text-slate-900 border-slate-600 [background:repeating-linear-gradient(45deg,#e2e8f0,#e2e8f0_6px,#cbd5e1_6px,#cbd5e1_12px)]",
  // D3: מיומן חיצוני (Airbnb / Booking.com …) — גוון ופסים משלהם, כדי שיהיה ברור מאיפה התפוסה
  external:
    "text-violet-950 border-violet-700 border-dashed [background:repeating-linear-gradient(-45deg,#ede9fe,#ede9fe_6px,#ddd6fe_6px,#ddd6fe_12px)]",
};

// תפוסה "דרך" (הזמנה / חסימה של "כל המתחם" על יחידה שבו, או להפך): בהיר ומקווקו — בלי שקיפות,
// כדי שהניגודיות תישאר תקינה
const VIA_CLASS = "bg-slate-100 text-slate-800 border-dashed border-slate-500";

const todayIso = () => new Date().toISOString().slice(0, 10);

export function CalendarPage() {
  const ctx = useManagement();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  // ?unit= — "היומן של היחידה" (מעמוד היחידה): חודש של יחידה אחת, גם בטלפון
  const params = useSearch({ strict: false }) as { unit?: string; block?: string };
  const unitParam = params.unit ?? "";
  const navigate = useNavigate();
  const [mode, setMode] = useState<ViewMode | null>(null);
  const [anchor, setAnchor] = useState(todayIso());
  const [filters, setFilters] = useState<Filters>({
    propertyId: "",
    unitId: unitParam,
    unitType: "",
    tone: "",
  });
  const [cancelled, setCancelled] = useState(false);
  const [q, setQ] = useState("");
  const [booking, setBooking] = useState<CalendarBooking | null>(null);
  const [block, setBlock] = useState<CalendarBlock | null>(null);
  const [blockForm, setBlockForm] = useState<{ unitId: string; from: string; to: string } | null>(
    null,
  );
  const view: ViewMode = mode ?? (isMobile && !filters.unitId ? "agenda" : "month");
  // שמות אורחים — רק למי שיש לו הרשאת "אורחים" (אחרת רק מספר ההזמנה)
  const showGuests = ctx.permissions["guests"] === true;
  // התנגשויות עם יומנים חיצוניים (D3, קריאה בלבד) — אותו מטמון כמו מסך הערוצים
  const channels = useQuery({
    queryKey: [...manageKeys.all, "channels"],
    queryFn: () => hospitalityChannels(),
    enabled: ctx.permissions["bookings"] === true,
    staleTime: 60_000,
    retry: false,
  });
  const { from, to } = rangeFor(view, anchor);
  const key = calendarKey(from, to, null, cancelled);
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      hospitalityCalendar({ data: { from, to, unitIds: null, includeCancelled: cancelled } }),
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });
  // רענון: בדיקת שינוי זולה; הלוח נטען מחדש רק כשמשהו השתנה
  const stamp = query.data?.stamp;
  const checkNow = useCallback(async () => {
    if (!stamp || document.visibilityState !== "visible") return;
    try {
      const fresh = await hospitalityCalendarStamp({
        data: { from, to, unitIds: null, includeCancelled: cancelled },
      });
      if (fresh !== stamp) void queryClient.invalidateQueries({ queryKey: key });
    } catch {
      /* ננסה בפעם הבאה */
    }
  }, [stamp, from, to, cancelled, queryClient, key]);
  useEffect(() => {
    const t = setInterval(() => void checkNow(), REFRESH_MS);
    const onFocus = () => void checkNow();
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [checkNow]);
  const afterAction = () => {
    void queryClient.invalidateQueries({ queryKey: [...manageKeys.all, "calendar"] });
    void queryClient.invalidateQueries({ queryKey: [...manageKeys.all, "blocks-upcoming"] });
    void queryClient.invalidateQueries({ queryKey: [...manageKeys.all, "dashboard"] });
    void queryClient.invalidateQueries({ queryKey: manageKeys.activity });
  };
  // ?block=1 — "חסימת תאריכים" מלוח הבקרה: פותח את הטופס פעם אחת ומנקה את הכתובת
  const loaded = query.data;
  useEffect(() => {
    if (params.block !== "1" || !loaded) return;
    setBlockForm({
      unitId: loaded.units.find((u) => u.kind !== "whole_property")?.id ?? "",
      from: loaded.today,
      to: addDays(loaded.today, 1),
    });
    void navigate({
      to: "/manage/calendar",
      search: params.unit ? { unit: params.unit } : {},
      replace: true,
    });
  }, [params.block, params.unit, loaded, navigate]);

  if (!ctx.permissions["bookings"])
    return <p className="p-4">אין לכם הרשאה לראות את היומן באתר הזה.</p>;
  if (query.isError && !query.data) return <LoadError error={query.error} />;
  if (!query.data) return <PageSkeleton label="טוען את היומן…" />;
  const data = showGuests ? query.data : maskGuests(query.data);
  const found = search(data, q);
  const unitTypes = [
    ...new Set(data.units.filter((u) => u.kind !== "whole_property").map((u) => u.unit_type)),
  ];

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">יומן</h1>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="תצוגה">
          {(["month", "week", "day", "units", "agenda"] as ViewMode[]).map((m) => (
            <Button
              key={m}
              type="button"
              variant={view === m ? "default" : "outline"}
              className="min-h-11"
              aria-pressed={view === m}
              onClick={() => setMode(m)}
            >
              {m === "month"
                ? "חודש"
                : m === "week"
                  ? "שבוע"
                  : m === "day"
                    ? "יום"
                    : m === "units"
                      ? "יחידות"
                      : "סדר יום"}
            </Button>
          ))}
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 min-w-11"
          aria-label="הקודם"
          onClick={() => setAnchor(shift(view, view === "month" ? from : anchor, -1))}
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => setAnchor(todayIso())}
        >
          היום
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 min-w-11"
          aria-label="הבא"
          onClick={() => setAnchor(shift(view, view === "month" ? from : anchor, 1))}
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </Button>
        <p className="text-lg font-medium" aria-live="polite" data-testid="calendar-title">
          {view === "month"
            ? monthTitle(from)
            : view === "day"
              ? `${dayLabel(anchor)}${anchor === data.today ? " — היום" : ""}`
              : `${dayLabel(from)} – ${dayLabel(addDays(to, -1))}`}
        </p>
        {/* מעבר מהיר: לחודש (חודש / שבוע) או לתאריך */}
        {view === "month" || view === "week" ? (
          <select
            aria-label="מעבר לחודש"
            value={(view === "month" ? from : anchor).slice(0, 7)}
            onChange={(e) => {
              const a = monthAnchor(e.target.value);
              if (a) setAnchor(a);
            }}
            className="min-h-11 rounded-md border border-input bg-background px-2 text-sm"
          >
            {monthOptions(data.today, (view === "month" ? from : anchor).slice(0, 7)).map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="date"
            aria-label="מעבר לתאריך"
            value={anchor}
            onChange={(e) =>
              /^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && setAnchor(e.target.value)
            }
            className="min-h-11 rounded-md border border-input bg-background px-2 text-sm"
          />
        )}
        <span className="ms-auto flex items-center gap-2">
          {query.isFetching && (
            <span role="status" className="flex items-center">
              <RefreshCw className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">מתעדכן</span>
            </span>
          )}
          <Button
            type="button"
            className="min-h-11 gap-2"
            onClick={() =>
              setBlockForm({
                unitId: data.units.find((u) => u.kind !== "whole_property")?.id ?? "",
                from: data.today,
                to: addDays(data.today, 1),
              })
            }
          >
            <CalendarPlus className="size-4" aria-hidden="true" />
            חסימת תאריכים
          </Button>
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="cal-property" className="text-xs">
            מתחם
          </Label>
          <select
            id="cal-property"
            className="min-h-11 rounded-md border border-input bg-background px-3"
            value={filters.propertyId}
            onChange={(e) => setFilters((f) => ({ ...f, propertyId: e.target.value, unitId: "" }))}
          >
            <option value="">כל המתחמים</option>
            {data.properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="cal-unit" className="text-xs">
            יחידה
          </Label>
          <select
            id="cal-unit"
            className="min-h-11 max-w-56 rounded-md border border-input bg-background px-3"
            value={filters.unitId}
            onChange={(e) => setFilters((f) => ({ ...f, unitId: e.target.value }))}
          >
            <option value="">כל היחידות</option>
            {data.units
              .filter((u) => !filters.propertyId || u.property_id === filters.propertyId)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        </div>
        {unitTypes.length > 1 && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="cal-type" className="text-xs">
              סוג יחידה
            </Label>
            <select
              id="cal-type"
              className="min-h-11 rounded-md border border-input bg-background px-3"
              value={filters.unitType}
              onChange={(e) => setFilters((f) => ({ ...f, unitType: e.target.value }))}
            >
              <option value="">הכול</option>
              {unitTypes.map((t) => (
                <option key={t} value={t}>
                  {UNIT_TYPE_LABELS[t as keyof typeof UNIT_TYPE_LABELS] ?? t}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <Label htmlFor="cal-status" className="text-xs">
            מצב
          </Label>
          <select
            id="cal-status"
            className="min-h-11 rounded-md border border-input bg-background px-3"
            value={filters.tone}
            onChange={(e) => setFilters((f) => ({ ...f, tone: e.target.value as Filters["tone"] }))}
          >
            <option value="">הכול</option>
            {(Object.keys(TONE_LABELS) as Tone[])
              .filter((t) => t !== "cancelled")
              .map((t) => (
                <option key={t} value={t}>
                  {TONE_LABELS[t]}
                </option>
              ))}
          </select>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={cancelled}
            onChange={(e) => setCancelled(e.target.checked)}
          />
          להציג גם מבוטלות
        </label>
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <Label htmlFor="cal-search" className="text-xs">
            חיפוש — מספר הזמנה או שם אורח
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute start-3 top-3.5 size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="cal-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="min-h-11 ps-9"
            />
          </div>
        </div>
      </div>
      {q.trim() !== "" && (
        <ul
          className="flex flex-col gap-1 rounded-md border p-2 text-sm"
          aria-label="תוצאות החיפוש"
          data-testid="calendar-search"
        >
          {found.length === 0 && <li className="text-muted-foreground">לא נמצא בטווח שעל המסך.</li>}
          {found.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                className="min-h-11 text-start font-medium text-primary hover:underline"
                onClick={() => {
                  setAnchor(b.check_in);
                  setBooking(b);
                }}
              >
                #{b.number} {b.guest_name} · {dayLabel(b.check_in)} · {STATUS_LABELS[b.status]}
              </button>
            </li>
          ))}
        </ul>
      )}

      <Legend />
      {view === "agenda" ? (
        <Agenda view={data} filters={filters} onBooking={setBooking} onBlock={setBlock} />
      ) : view === "units" ? (
        <UnitsView
          view={data}
          filters={filters}
          onBooking={setBooking}
          onBlock={setBlock}
          onOpenUnit={(unitId) => {
            setFilters((f) => ({ ...f, unitId }));
            setMode("month");
          }}
          onNewBlock={(unitId) =>
            setBlockForm({ unitId, from: data.today, to: addDays(data.today, 1) })
          }
        />
      ) : view === "day" ? (
        <DayView
          view={data}
          date={anchor}
          filters={filters}
          onBooking={setBooking}
          onBlock={setBlock}
          onNewBlock={(unitId) => setBlockForm({ unitId, from: anchor, to: addDays(anchor, 1) })}
        />
      ) : (
        <Board
          view={data}
          filters={filters}
          channels={channels.data}
          onBooking={setBooking}
          onBlock={setBlock}
          onSelectRange={(unitId, a, b) => setBlockForm({ unitId, from: a, to: b })}
        />
      )}
      <UpcomingBlocks onOpen={setBlock} />

      {booking && <BookingPanel booking={booking} view={data} onClose={() => setBooking(null)} />}
      {block && (
        <BlockPanel
          block={block}
          today={data.today}
          onClose={() => setBlock(null)}
          onDone={afterAction}
        />
      )}
      {blockForm && (
        <BlockSheet
          view={data}
          initial={blockForm}
          onClose={() => setBlockForm(null)}
          onDone={afterAction}
        />
      )}
    </div>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap gap-2 text-xs" aria-label="מקרא">
      {(["pending", "confirmed", "staying", "past", "block", "external"] as Tone[]).map((t) => (
        <li key={t} className={cn("rounded border px-2 py-1", TONE_CLASS[t])}>
          {TONE_LABELS[t]}
        </li>
      ))}
      <li className={cn("rounded border px-2 py-1", VIA_CLASS)}>דרך "כל המתחם"</li>
    </ul>
  );
}

function Board(props: {
  view: CalendarView;
  filters: Filters;
  /** יומנים חיצוניים (להתנגשויות); undefined — עוד לא נטען / אין הרשאה */
  channels?: ChannelUnit[] | undefined;
  onBooking: (b: CalendarBooking) => void;
  onBlock: (k: CalendarBlock) => void;
  onSelectRange: (unitId: string, from: string, to: string) => void;
}) {
  const { view } = props;
  // סוגי חדרים (מלונות) — לקיבוץ השורות; בלי הרשאת קטלוג / בלי סוגים — לוח רגיל
  const roomTypes = useQuery({
    queryKey: [...manageKeys.all, "room-types"],
    queryFn: () => hospitalityRoomTypes(),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const groups = roomTypes.data;
  const rows = useMemo(
    () => buildRows(view, props.filters, groups ?? []),
    [view, props.filters, groups],
  );
  const days = useMemo(() => daysOf(view.from, view.to), [view.from, view.to]);
  // מבט אחד: כמה יחידות פנויות בכל לילה (לפי המתחם / היחידה שנבחרו, בלי סינון המצב)
  const free = useMemo(
    () => freeByNight(buildRows(view, { ...props.filters, tone: "" }, groups ?? []), days.length),
    [view, props.filters, groups, days.length],
  );
  const fullNights = days.filter((_, i) => free[i]!.total > 0 && free[i]!.free === 0);
  // התנגשויות עם יומנים חיצוניים בטווח (D3) — לכל יחידה
  const marks = useMemo(
    () => conflictMarks(props.channels ?? [], view.from, view.to),
    [props.channels, view.from, view.to],
  );
  const marksByUnit = useMemo(() => {
    const m = new Map<string, ConflictMark[]>();
    for (const x of marks) (m.get(x.unitId) ?? m.set(x.unitId, []).get(x.unitId)!).push(x);
    return m;
  }, [marks]);
  const scroller = useRef<HTMLDivElement>(null);
  // וירטואליזציה: רק השורות שעל המסך (ועוד מרווח) מצוירות — מאות יחידות בלי האטה
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  const [pick, setPick] = useState<{ unitId: string; index: number } | null>(null);
  const measure = () => {
    const el = scroller.current;
    if (el) setViewport({ top: el.scrollTop, height: el.clientHeight });
  };
  useEffect(() => {
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() =>
      setViewport({ top: el.scrollTop, height: el.clientHeight }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const win = visibleWindow(viewport.top, viewport.height, ROW_H, rows.length);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPick(null);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);
  const todayIdx = diffDays(view.from, view.today);
  const weekend = new Set(view.weekend_nights);
  const width = NAME_W + days.length * COL_W;
  const shown = rows.slice(win.first, win.last);

  const clickCell = (row: Extract<Row, { type: "unit" }>, index: number) => {
    if (!isFreeNight(row, index)) return;
    if (!pick || pick.unitId !== row.unit.id) {
      setPick({ unitId: row.unit.id, index });
      return;
    }
    const a = Math.min(pick.index, index);
    const b = Math.max(pick.index, index);
    setPick(null);
    props.onSelectRange(row.unit.id, days[a]!, addDays(days[b]!, 1));
  };

  return (
    <div className="flex flex-col gap-1">
      {marks.length > 0 && (
        <p
          role="status"
          data-testid="calendar-conflicts"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--hm-danger-bg)] bg-[var(--hm-danger-bg)] px-3 py-2 text-sm text-[var(--hm-danger)]"
        >
          <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            {marks.length === 1
              ? "התנגשות אחת עם יומן חיצוני בטווח הזה"
              : `${marks.length} התנגשויות עם יומנים חיצוניים בטווח הזה`}{" "}
            — תאריכים שתפוסים אצלכם וגם בערוץ. לא נוצרה הזמנה כפולה; כדאי לסגור אותם בערוץ.
          </span>
          <Link to="/manage/channels" className="font-semibold underline underline-offset-2">
            לבדיקה בערוצים
          </Link>
        </p>
      )}
      {fullNights.length > 0 && (
        <p className="sr-only">
          לילות שבהם אין יחידה פנויה: {fullNights.map((d) => dayLabel(d)).join(", ")}
        </p>
      )}
      {/* שורה אחת שהטקסט שלה מתחלף — בלי להזיז את הלוח בין הלחיצה הראשונה לשנייה */}
      <p
        className={cn(
          "min-h-12 text-xs sm:min-h-8",
          pick ? "font-medium text-foreground" : "text-muted-foreground",
        )}
        id="board-help"
        role="status"
        data-testid="board-help"
      >
        {pick
          ? "נבחר לילה ראשון — לחצו על הלילה האחרון בשורה (Escape מבטל)."
          : 'לחיצה על לילה פנוי ואז על הלילה האחרון באותה שורה — חסימת התאריכים. Escape מבטל. אפשר גם בכפתור "חסימת תאריכים".'}
      </p>
      <div
        ref={scroller}
        onScroll={measure}
        className="relative max-h-[70vh] overflow-auto rounded-md border"
        data-testid="calendar-board"
        role="region"
        aria-label="לוח התפוסה"
        aria-describedby="board-help"
        tabIndex={0}
      >
        <div style={{ width, height: rows.length * ROW_H + ROW_H + SUM_H }} className="relative">
          {/* כותרת התאריכים ושורת "פנויות" — קבועות למעלה */}
          <div className="sticky top-0 z-20 bg-background">
            <div className="flex bg-background" style={{ height: ROW_H }}>
              <div
                className="sticky start-0 z-30 flex items-center border-b border-e bg-background px-2 text-xs font-medium"
                style={{ width: NAME_W }}
              >
                יחידה
              </div>
              {days.map((d, i) => (
                <div
                  key={d}
                  className={cn(
                    "flex flex-col items-center justify-center border-b border-e text-[11px] leading-tight",
                    weekend.has(dow(d)) && "bg-muted",
                    i === todayIdx && "bg-primary/15 font-bold",
                  )}
                  style={{ width: COL_W }}
                  data-day={d}
                  aria-current={i === todayIdx ? "date" : undefined}
                >
                  <span>{DAY_SHORT[dow(d)]}</span>
                  <span>{Number(d.slice(8))}</span>
                </div>
              ))}
            </div>
            <div className="flex bg-background" style={{ height: SUM_H }} data-testid="free-row">
              <div
                className="sticky start-0 z-30 flex items-center border-b border-e bg-background px-2 text-[11px] font-medium text-muted-foreground"
                style={{ width: NAME_W }}
              >
                פנויות
              </div>
              {free.map((f, i) => (
                <div
                  key={days[i]}
                  aria-hidden="true"
                  title={
                    f.total === 0
                      ? undefined
                      : f.free === 0
                        ? `${dayLabel(days[i]!)}: הכול תפוס`
                        : `${dayLabel(days[i]!)}: ${f.free} מתוך ${f.total} פנויות`
                  }
                  className={cn(
                    "flex items-center justify-center border-b border-e text-[11px] font-semibold",
                    f.total === 0
                      ? "text-muted-foreground"
                      : f.free === 0
                        ? "bg-[var(--hm-danger-bg)] text-[var(--hm-danger)]"
                        : f.free === f.total
                          ? "text-[var(--hm-success)]"
                          : "text-foreground",
                  )}
                  style={{ width: COL_W }}
                  data-free={f.free}
                >
                  {f.total === 0 ? "" : f.free === 0 ? "מלא" : f.free}
                </div>
              ))}
            </div>
          </div>
          <div style={{ height: win.first * ROW_H }} />
          {shown.map((row) =>
            row.type === "property" ? (
              <div
                key={row.key}
                className="sticky start-0 flex items-center bg-muted/60 px-2 text-sm font-semibold"
                style={{ height: ROW_H, width }}
              >
                <span className="sticky start-2">{row.name}</span>
              </div>
            ) : (
              <div
                key={row.key}
                className="relative flex"
                style={{ height: ROW_H }}
                data-unit-row={row.unit.name}
              >
                <div
                  className="sticky start-0 z-10 flex items-center border-b border-e bg-background px-2 text-sm"
                  style={{ width: NAME_W }}
                >
                  <span className="truncate">
                    {row.unit.kind === "whole_property"
                      ? `כל ${row.unit.name.replace(/^כל המתחם —?\s*/, "")}`
                      : row.unit.name}
                  </span>
                </div>
                {days.map((d, i) => {
                  const free = isFreeNight(row, i);
                  const picked = pick?.unitId === row.unit.id && pick.index === i;
                  return (
                    <div
                      key={d}
                      onClick={() => clickCell(row, i)}
                      aria-hidden="true"
                      className={cn(
                        "border-b border-e",
                        weekend.has(dow(d)) && "bg-muted/50",
                        i === todayIdx && "bg-primary/5",
                        free && "cursor-pointer hover:bg-primary/10",
                        picked && "bg-primary/30",
                      )}
                      style={{ width: COL_W }}
                      data-cell={d}
                    />
                  );
                })}
                {row.bars.map((b) => (
                  <BarView
                    key={b.key}
                    bar={b}
                    onBooking={props.onBooking}
                    onBlock={props.onBlock}
                  />
                ))}
                {(marksByUnit.get(row.unit.id) ?? []).map((m) => (
                  <Link
                    key={m.key}
                    to="/manage/channels"
                    data-conflict=""
                    className="absolute bottom-0.5 z-[6] h-2 rounded-full bg-[var(--hm-danger-dot)] ring-1 ring-white hover:h-3"
                    style={{
                      insetInlineStart: NAME_W + m.start * COL_W + 2,
                      width: m.span * COL_W - 4,
                    }}
                    aria-label={`התנגשות עם ${m.label}: ${shortDate(m.from)}–${shortDate(m.to)} — לבדיקה במסך הערוצים`}
                    title={`התנגשות עם ${m.label}: ${shortDate(m.from)}–${shortDate(m.to)}`}
                  />
                ))}
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function BarView({
  bar,
  onBooking,
  onBlock,
}: {
  bar: Bar;
  onBooking: (b: CalendarBooking) => void;
  onBlock: (k: CalendarBlock) => void;
}) {
  // D3: מקור התפוסה — באתר / טלפון / ערוץ / חסימה ידנית / סנכרון (לקורא מסך ובריחוף)
  const source = bar.booking ? bookingSource(bar.booking) : blockSource(bar.block!);
  // Calendar Pro: גם תאריכי ההגעה והעזיבה (או החסימה) — בריחוף ולקורא מסך
  const text =
    bar.kind === "block"
      ? `${bar.label} · ${source.label} · ${shortDate(bar.block!.start_date)}–${shortDate(bar.block!.end_date)}`
      : `${bar.label} · ${STATUS_LABELS[bar.booking!.status]} · מקור: ${source.label} · הגעה ${shortDate(bar.booking!.check_in)} · עזיבה ${shortDate(bar.booking!.check_out)}`;
  return (
    <button
      type="button"
      onClick={() => (bar.booking ? onBooking(bar.booking) : onBlock(bar.block!))}
      className={cn(
        "absolute top-1.5 z-[5] flex h-8 items-center overflow-hidden whitespace-nowrap rounded border px-1.5 text-start text-xs font-medium",
        bar.via ? VIA_CLASS : TONE_CLASS[bar.tone],
        bar.clippedStart && "rounded-s-none",
        bar.clippedEnd && "rounded-e-none",
      )}
      style={{ insetInlineStart: NAME_W + bar.start * COL_W + 2, width: bar.span * COL_W - 4 }}
      data-bar={bar.kind}
      data-status={bar.booking?.status ?? "block"}
      aria-label={`${text}${bar.via ? " (דרך כל המתחם)" : ""}`}
      title={text}
    >
      {bar.kind === "block" &&
        (bar.tone === "external" ? (
          <RefreshCw className="me-1 size-3 shrink-0" aria-hidden="true" />
        ) : (
          <Lock className="me-1 size-3 shrink-0" aria-hidden="true" />
        ))}
      <span className="truncate">{bar.label}</span>
    </button>
  );
}

// ---------- תצוגת יחידות (Calendar Pro) ----------

const STRIP_CLASS: Record<NightState, string> = {
  free: "bg-card border-[var(--hm-line-soft)]",
  booked: TONE_CLASS.confirmed,
  pending: TONE_CLASS.pending,
  block: TONE_CLASS.block,
  external: TONE_CLASS.external,
};

/** כרטיס לכל יחידה: הלילה (פנוי / תפוס / חסום), מי מגיע ומי עוזב היום, ההגעה הבאה, ו-14 הלילות */
function UnitsView({
  view,
  filters,
  onBooking,
  onBlock,
  onOpenUnit,
  onNewBlock,
}: {
  view: CalendarView;
  filters: Filters;
  onBooking: (b: CalendarBooking) => void;
  onBlock: (k: CalendarBlock) => void;
  onOpenUnit: (unitId: string) => void;
  onNewBlock: (unitId: string) => void;
}) {
  const roomTypes = useQuery({
    queryKey: [...manageKeys.all, "room-types"],
    queryFn: () => hospitalityRoomTypes(),
    retry: false,
    staleTime: 5 * 60_000,
  });
  const cards = useMemo(
    () => unitCards(view, filters, roomTypes.data ?? []),
    [view, filters, roomTypes.data],
  );
  const days = daysOf(view.from, view.to);
  const freeTonight = cards.filter((c) => c.tonight === "free").length;
  if (cards.length === 0)
    return (
      <p className="rounded-md border p-4 text-sm text-muted-foreground">אין יחידות לפי הסינון.</p>
    );
  return (
    <section
      aria-labelledby="units-view-title"
      className="flex flex-col gap-3"
      data-testid="calendar-units"
    >
      <h2 id="units-view-title" className="text-base font-semibold">
        {freeTonight === 0
          ? "הלילה הכול תפוס"
          : `הלילה ${freeTonight === 1 ? "יחידה אחת פנויה" : `${freeTonight} יחידות פנויות`} מתוך ${cards.length}`}
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <UnitCardView
            key={c.unit.id}
            card={c}
            days={days}
            today={view.today}
            onBooking={onBooking}
            onBlock={onBlock}
            onOpenUnit={onOpenUnit}
            onNewBlock={onNewBlock}
          />
        ))}
      </ul>
    </section>
  );
}

function UnitCardView({
  card: c,
  days,
  today,
  onBooking,
  onBlock,
  onOpenUnit,
  onNewBlock,
}: {
  card: UnitCard;
  days: string[];
  today: string;
  onBooking: (b: CalendarBooking) => void;
  onBlock: (k: CalendarBlock) => void;
  onOpenUnit: (unitId: string) => void;
  onNewBlock: (unitId: string) => void;
}) {
  const titleId = `unit-card-${c.unit.id}`;
  const pct = days.length ? Math.round(((days.length - c.freeNights) / days.length) * 100) : 0;
  const guest = (b: CalendarBooking) => `#${b.number}${b.guest_name ? ` ${b.guest_name}` : ""}`;
  return (
    <li
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-[var(--hm-shadow-card)]"
      data-unit-card={c.unit.name}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={titleId} className="truncate font-semibold">
            {c.unit.name}
          </h3>
          <p className="truncate text-xs text-muted-foreground">{c.propertyName}</p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
            c.tonight === "free"
              ? "border-[var(--hm-success-bg)] bg-[var(--hm-success-bg)] text-[var(--hm-success)]"
              : STRIP_CLASS[c.tonight],
          )}
        >
          {c.tonight === "free" ? "פנוי הלילה" : `${NIGHT_LABELS[c.tonight]} הלילה`}
        </span>
      </div>

      <div className="flex flex-col gap-1 text-sm">
        {c.stay ? (
          <button
            type="button"
            onClick={() => onBooking(c.stay!)}
            className="min-h-10 rounded-lg px-2 text-start hover:bg-[var(--hm-surface-2)]"
          >
            {guest(c.stay)} · עד {shortDate(c.stay.check_out)}
          </button>
        ) : c.block ? (
          <button
            type="button"
            onClick={() => onBlock(c.block!)}
            className="min-h-10 rounded-lg px-2 text-start hover:bg-[var(--hm-surface-2)]"
          >
            {c.block.synced
              ? `מ-${blockSource(c.block).label}`
              : c.block.reason
                ? `חסום — ${c.block.reason}`
                : "חסום"}{" "}
            · עד {shortDate(c.block.end_date)}
          </button>
        ) : (
          <p className="px-2 text-muted-foreground">
            {c.next
              ? `ההגעה הבאה: ${dayLabel(c.next.check_in)} (${guest(c.next)})`
              : "אין הגעות קרובות בטווח"}
          </p>
        )}
        {(c.arriving || c.leaving) && (
          <div className="flex flex-wrap gap-1.5 px-2">
            {c.arriving && (
              <button
                type="button"
                onClick={() => onBooking(c.arriving!)}
                className="inline-flex min-h-9 items-center gap-1 rounded-full bg-[var(--hm-success-bg)] px-2.5 text-xs font-semibold text-[var(--hm-success)]"
              >
                <LogIn className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />
                {c.arriving.check_in === today ? "מגיעים היום" : "מגיעים"}: {guest(c.arriving)}
              </button>
            )}
            {c.leaving && (
              <button
                type="button"
                onClick={() => onBooking(c.leaving!)}
                className="inline-flex min-h-9 items-center gap-1 rounded-full bg-[var(--hm-warning-bg)] px-2.5 text-xs font-semibold text-[var(--hm-warning)]"
              >
                <LogOut className="size-3.5 rtl:-scale-x-100" aria-hidden="true" />
                {c.leaving.check_out === today ? "עוזבים היום" : "עוזבים"}: {guest(c.leaving)}
              </button>
            )}
          </div>
        )}
      </div>

      <div>
        <ol
          className="grid gap-0.5"
          style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
          aria-label={`${days.length} הלילות מ-${dayLabel(days[0]!)}: ${c.freeNights} פנויים, ${days.length - c.freeNights} תפוסים או חסומים`}
        >
          {c.strip.map((n, i) => (
            <li
              key={days[i]}
              title={`${dayLabel(days[i]!)}: ${NIGHT_LABELS[n]}`}
              className={cn(
                "h-6 rounded-sm border",
                STRIP_CLASS[n],
                days[i] === today && "ring-2 ring-[var(--hm-lagoon-500)]",
              )}
            >
              <span className="sr-only">
                {dayLabel(days[i]!)}: {NIGHT_LABELS[n]}
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
          <span>{dayLabel(days[0]!)}</span>
          <span>תפוסה {pct}%</span>
          <span>{dayLabel(days[days.length - 1]!)}</span>
        </div>
      </div>

      <div className="mt-auto flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-10"
          onClick={() => onOpenUnit(c.unit.id)}
        >
          היומן של היחידה
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-10"
          onClick={() => onNewBlock(c.unit.id)}
        >
          חסימת תאריכים
        </Button>
      </div>
    </li>
  );
}

function Agenda({
  view,
  filters,
  onBooking,
  onBlock,
}: {
  view: CalendarView;
  filters: Filters;
  onBooking: (b: CalendarBooking) => void;
  onBlock: (k: CalendarBlock) => void;
}) {
  const unitName = new Map(view.units.map((u) => [u.id, u.name]));
  const days = agenda(view, filters);
  const line = (b: CalendarBooking, what: string) => (
    <li key={`${what}-${b.id}`}>
      <button type="button" className="min-h-11 w-full text-start" onClick={() => onBooking(b)}>
        <span className="font-medium">{what}</span> · {unitName.get(b.unit_id)} · #{b.number}{" "}
        {b.guest_name} ·{" "}
        <span className={cn("rounded border px-1 text-xs", TONE_CLASS[toneOf(b.status)])}>
          {STATUS_LABELS[b.status]}
        </span>
      </button>
    </li>
  );
  return (
    <ol className="flex flex-col gap-3" data-testid="calendar-agenda">
      {days.map((d) => {
        const empty =
          !d.arrivals.length && !d.departures.length && !d.staying.length && !d.blocks.length;
        return (
          <li
            key={d.date}
            className={cn("rounded-md border p-3", d.date === view.today && "border-primary")}
          >
            <h2 className="text-sm font-semibold">
              {dayLabel(d.date)}
              {d.date === view.today ? " — היום" : ""}
            </h2>
            {empty ? (
              <p className="text-sm text-muted-foreground">אין תנועה.</p>
            ) : (
              <ul className="flex flex-col text-sm">
                {d.arrivals.map((b) => line(b, "מגיעים"))}
                {d.departures.map((b) => line(b, "עוזבים"))}
                {d.staying.map((b) => line(b, "שוהים"))}
                {d.blocks.map((k) => (
                  <li key={k.id}>
                    <button
                      type="button"
                      className="min-h-11 w-full text-start"
                      onClick={() => onBlock(k)}
                    >
                      {k.synced ? (
                        <>
                          <span className="font-medium">מ-{blockSource(k).label}</span> (סנכרון) ·{" "}
                          {k.unit_name}
                        </>
                      ) : (
                        <>
                          <span className="font-medium">חסום</span> · {k.unit_name}
                          {k.reason ? ` · ${k.reason}` : ""}
                        </>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function UpcomingBlocks({ onOpen }: { onOpen: (k: CalendarBlock) => void }) {
  const q = useQuery({
    queryKey: [...manageKeys.all, "blocks-upcoming"],
    queryFn: () => hospitalityUpcomingBlocks(),
    refetchOnWindowFocus: false,
  });
  return (
    <Card data-section="upcoming-blocks">
      <CardHeader>
        <CardTitle className="text-lg">
          <h2>חסימות קרובות</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {(q.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">אין חסימות פעילות.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {(q.data ?? []).map((k) => (
              <li key={k.id}>
                <button
                  type="button"
                  className="min-h-11 text-start hover:underline"
                  onClick={() => onOpen(k)}
                >
                  {k.unit_name} · {dayLabel(k.start_date)} – {dayLabel(addDays(k.end_date, -1))} ·{" "}
                  {nightsText({ check_in: k.start_date, check_out: k.end_date })}
                  {k.reason ? ` · ${k.reason}` : ""}
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SidePanel(props: {
  title: string;
  description: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  return (
    <Sheet open onOpenChange={(o) => !o && props.onClose()}>
      <SheetContent
        side={isMobile ? "bottom" : "left"}
        className="max-h-[92dvh] w-full overflow-y-auto sm:max-w-md"
      >
        <SheetHeader className="ps-10 text-start sm:text-start">
          <SheetTitle>{props.title}</SheetTitle>
          <SheetDescription>{props.description}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 flex flex-col gap-3">{props.children}</div>
      </SheetContent>
    </Sheet>
  );
}

function BookingPanel({
  booking: b,
  view,
  onClose,
}: {
  booking: CalendarBooking;
  view: CalendarView;
  onClose: () => void;
}) {
  const unit = view.units.find((u) => u.id === b.unit_id);
  const money = new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: view.currency,
  }).format(b.total);
  return (
    <SidePanel
      title={`הזמנה #${b.number}`}
      description="אישור, שינוי, הגעה וביטול — בעמוד ההזמנה."
      onClose={onClose}
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm" data-testid="booking-panel">
        <dt className="text-muted-foreground">אורח</dt>
        <dd>{b.guest_name ?? "—"}</dd>
        <dt className="text-muted-foreground">יחידה</dt>
        <dd>{unit?.name ?? "—"}</dd>
        <dt className="text-muted-foreground">תאריכים</dt>
        <dd>
          {dayLabel(b.check_in)} – {dayLabel(b.check_out)} ({nightsText(b)})
        </dd>
        <dt className="text-muted-foreground">אורחים</dt>
        <dd>
          {b.adults} מבוגרים{b.children ? `, ${b.children} ילדים` : ""}
        </dd>
        <dt className="text-muted-foreground">מצב</dt>
        <dd>{STATUS_LABELS[b.status]}</dd>
        <dt className="text-muted-foreground">סכום</dt>
        <dd>{money}</dd>
        <dt className="text-muted-foreground">מקור</dt>
        <dd>{bookingSource(b).label}</dd>
      </dl>
      <QuickActions bookingId={b.id} />
      <Link
        to="/manage/bookings/$bookingId"
        params={{ bookingId: b.id }}
        className="inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium hover:bg-muted"
      >
        לעמוד ההזמנה
      </Link>
    </SidePanel>
  );
}

function BlockPanel({
  block: k,
  today,
  onClose,
  onDone,
}: {
  block: CalendarBlock;
  today: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [from, setFrom] = useState(k.start_date);
  const [to, setTo] = useState(k.end_date);
  const [reason, setReason] = useState(k.reason ?? "");
  const [error, setError] = useState<string | null>(null);
  const changed = from !== k.start_date || to !== k.end_date || reason !== (k.reason ?? "");
  const invalid = blockError(from, to, reason, today);
  // D3: תאריכים מסנכרון — מתעדכנים רק מהיומן החיצוני (שינוי כאן היה נדרס בסנכרון הבא)
  if (k.synced) {
    const channel = blockSource(k).label;
    return (
      <SidePanel
        title={`${channel} — ${k.unit_name}`}
        description={`${dayLabel(k.start_date)} – ${dayLabel(addDays(k.end_date, -1))} (${nightsText({ check_in: k.start_date, check_out: k.end_date })})`}
        onClose={onClose}
      >
        <div className="flex flex-col gap-3 text-sm" data-testid="synced-block-panel">
          <p className="flex items-center gap-2 rounded-md border border-violet-300 bg-violet-50 p-3 text-violet-950">
            <RefreshCw className="size-4 shrink-0" aria-hidden="true" />
            התאריכים האלה תפוסים ב-{channel} ומגיעים מסנכרון היומן (iCal).
          </p>
          <p className="text-muted-foreground">
            כדי לשנות או לבטל אותם — עושים את זה ב-{channel}; הלוח כאן מתעדכן בסנכרון הבא (עד 30
            דקות). שום הזמנה שלכם לא משתנה בגלל הסנכרון.
          </p>
          <Link
            to="/manage/channels"
            className="inline-flex min-h-11 items-center justify-center rounded-md border px-4 font-medium hover:bg-muted"
          >
            ליומנים החיצוניים
          </Link>
        </div>
      </SidePanel>
    );
  }
  const save = async () => {
    setError(null);
    try {
      await hospitalityUpdateBlock({ data: { id: k.id, from, to, reason } });
      toast.success("החסימה עודכנה");
      onDone();
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <SidePanel
      title={`חסימה — ${k.unit_name}`}
      description={`${dayLabel(k.start_date)} – ${dayLabel(addDays(k.end_date, -1))} (${nightsText({ check_in: k.start_date, check_out: k.end_date })})`}
      onClose={onClose}
    >
      <div className="grid grid-cols-2 gap-2" data-testid="block-panel">
        <div className="flex flex-col gap-1">
          <Label htmlFor="bp-from">הלילה הראשון</Label>
          <Input
            id="bp-from"
            type="date"
            dir="ltr"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="min-h-11"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="bp-to">היציאה (לא כולל)</Label>
          <Input
            id="bp-to"
            type="date"
            dir="ltr"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="min-h-11"
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="bp-reason">סיבה (לא חובה)</Label>
        <Input
          id="bp-reason"
          value={reason}
          maxLength={300}
          onChange={(e) => setReason(e.target.value)}
          className="min-h-11"
        />
      </div>
      {changed && invalid && <p className="text-sm text-destructive">{invalid}</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {changed && (
          <Button
            type="button"
            className="min-h-11"
            disabled={Boolean(invalid)}
            onClick={() => void save()}
          >
            שמירת השינוי
          </Button>
        )}
        <ConfirmButton
          label="שחרור החסימה"
          title="לשחרר את החסימה?"
          description={<p>התאריכים יתפנו מיד להזמנות.</p>}
          confirmLabel="שחרור"
          onConfirm={async () => {
            try {
              await hospitalityReleaseBlock({ data: { id: k.id } });
              toast.success("החסימה שוחררה — התאריכים פנויים");
              onDone();
              onClose();
            } catch (e) {
              setError(errorText(e));
            }
          }}
        />
      </div>
    </SidePanel>
  );
}

function BlockSheet(props: {
  view: CalendarView;
  initial: { unitId: string; from: string; to: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [f, setF] = useState({ ...props.initial, reason: "" });
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const error = !f.unitId ? "יש לבחור יחידה" : blockError(f.from, f.to, f.reason, props.view.today);
  const submit = async () => {
    setSubmitted(true);
    if (error) return;
    setBusy(true);
    setServerError(null);
    try {
      await hospitalityCreateBlock({
        data: { unitId: f.unitId, from: f.from, to: f.to, reason: f.reason },
      });
      toast.success("התאריכים נחסמו");
      props.onDone();
      props.onClose();
    } catch (e) {
      setServerError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormSheet
      open
      title="חסימת תאריכים"
      description="בתאריכים החסומים אי אפשר להזמין את היחידה (וחסימה של כל המתחם — את כל היחידות שבו)."
      dirty={false}
      busy={busy}
      submitLabel="חסימה"
      serverError={serverError}
      notice={null}
      hasErrors={Boolean(error)}
      submitted={submitted}
      onSubmit={() => void submit()}
      onClose={props.onClose}
    >
      {/* 3b: אותם תאריכים — כהזמנה במקום חסימה */}
      {props.view.units.some((u) => u.id === f.unitId && u.is_active) && f.to > f.from && (
        <Link
          to="/manage/bookings/new"
          search={{ unit: f.unitId, from: f.from, to: f.to }}
          className="inline-flex min-h-11 w-fit items-center rounded-md border px-3 text-sm font-medium text-primary hover:bg-primary/5"
        >
          הוספת הזמנה בתאריכים האלה במקום חסימה
        </Link>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="bs-unit">יחידה</Label>
        <select
          id="bs-unit"
          className="min-h-11 rounded-md border border-input bg-background px-3"
          value={f.unitId}
          onChange={(e) => setF((x) => ({ ...x, unitId: e.target.value }))}
        >
          {props.view.units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.kind === "whole_property" ? `${u.name} (כל המתחם)` : u.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bs-from">הלילה הראשון</Label>
          <Input
            id="bs-from"
            type="date"
            dir="ltr"
            value={f.from}
            onChange={(e) => setF((x) => ({ ...x, from: e.target.value }))}
            className="min-h-11"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bs-to">היציאה (לא כולל)</Label>
          <Input
            id="bs-to"
            type="date"
            dir="ltr"
            value={f.to}
            onChange={(e) => setF((x) => ({ ...x, to: e.target.value }))}
            className="min-h-11"
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="bs-reason">סיבה (לא חובה)</Label>
        <Input
          id="bs-reason"
          value={f.reason}
          maxLength={300}
          placeholder="למשל: שיפוץ, שימוש פרטי"
          onChange={(e) => setF((x) => ({ ...x, reason: e.target.value }))}
          className="min-h-11"
        />
      </div>
      {f.from && f.to && f.to > f.from && (
        <p className="text-sm">{nightsText({ check_in: f.from, check_out: f.to })}</p>
      )}
      {submitted && error && <p className="text-sm text-destructive">{error}</p>}
    </FormSheet>
  );
}

/**
 * פעולות מהיר מהיומן (3b): אישור, הגיעו / לא הגיעו / עזבו — עם הגרסה העדכנית של ההזמנה
 * (נטענת כאן); דחייה, שינוי וביטול — בעמוד ההזמנה.
 */
function QuickActions({ bookingId }: { bookingId: string }) {
  const refresh = useBookingRefresh(bookingId);
  const detail = useQuery({
    queryKey: bookingKey(bookingId),
    queryFn: () => hospitalityBookingDetail({ data: { id: bookingId } }),
  });
  const [error, setError] = useState<string | null>(null);
  const d = detail.data;
  if (!d) return null;
  const can = actionsFor(d);
  const run = async (what: () => Promise<unknown>, done: string) => {
    setError(null);
    try {
      await what();
      toast.success(done);
    } catch (e) {
      setError(errorText(e));
    } finally {
      refresh();
    }
  };
  const stay = (status: "checked_in" | "checked_out" | "no_show", done: string) =>
    run(() => hospitalitySetStayStatus({ data: { id: d.id, status, revision: d.revision } }), done);
  return (
    <div className="flex flex-col gap-2" data-testid="quick-actions">
      <p className="text-sm">
        מצב: <span className="font-medium">{BOOKING_STATE[d.state]}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {can.approve && (
          <ConfirmButton
            label="אישור ההזמנה"
            title={`לאשר את הזמנה #${d.number}?`}
            description={<p>האורח יקבל מייל אישור.</p>}
            confirmLabel="אישור"
            onConfirm={() =>
              run(
                () =>
                  hospitalityApproveBooking({
                    data: { id: d.id, revision: d.revision, reason: null },
                  }),
                "ההזמנה אושרה",
              )
            }
          />
        )}
        {can.checkIn && (
          <ConfirmButton
            label="הגיעו"
            title="לסמן שהאורחים הגיעו?"
            description={<p>ההזמנה תעבור ל"שוהים עכשיו".</p>}
            confirmLabel="הגיעו"
            onConfirm={() => stay("checked_in", "סומן: האורחים הגיעו")}
          />
        )}
        {can.noShow && (
          <ConfirmButton
            label="לא הגיעו"
            title="לסמן שהאורחים לא הגיעו?"
            description={<p>דמי אי-ההגעה לפי המדיניות שנשמרה עם ההזמנה.</p>}
            confirmLabel="לא הגיעו"
            destructive
            onConfirm={() => stay("no_show", "סומן: האורחים לא הגיעו")}
          />
        )}
        {can.checkOut && (
          <ConfirmButton
            label="עזבו"
            title="לסמן שהאורחים עזבו?"
            description={<p>ההזמנה תעבור ל"עבר".</p>}
            confirmLabel="עזבו"
            onConfirm={() => stay("checked_out", "סומן: האורחים עזבו")}
          />
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** תצוגת יום (3b): לכל יחידה — מגיעים, עוזבים, שוהים, חסום או פנוי הלילה */
function DayView(props: {
  view: CalendarView;
  date: string;
  filters: Filters;
  onBooking: (b: CalendarBooking) => void;
  onBlock: (k: CalendarBlock) => void;
  onNewBlock: (unitId: string) => void;
}) {
  const rows = dayOverview(props.view, props.date, props.filters);
  const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  const bookingButton = (b: CalendarBooking, what: string) => (
    <button
      type="button"
      className="min-h-11 text-start font-medium text-primary hover:underline"
      onClick={() => props.onBooking(b)}
    >
      {what}: #{b.number} {b.guest_name} ({nightsText(b)})
    </button>
  );
  return (
    <section className="flex flex-col gap-3" data-testid="calendar-day" aria-label="תצוגת יום">
      <p className="flex flex-wrap gap-x-4 text-sm">
        <span>מגיעים: {count((r) => Boolean(r.arriving))}</span>
        <span>עוזבים: {count((r) => Boolean(r.leaving))}</span>
        <span>תפוסות הלילה: {count((r) => r.night === "booked")}</span>
        <span>פנויות הלילה: {count((r) => r.night === "free")}</span>
        <span>חסומות: {count((r) => r.night === "blocked")}</span>
      </p>
      <ul className="grid gap-2 md:grid-cols-2">
        {rows.map((r) => (
          <li
            key={r.unit.id}
            className="flex flex-col gap-1 rounded-md border p-3 text-sm"
            data-day-unit={r.unit.name}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{r.unit.name}</span>
              <span
                className={cn(
                  "rounded px-2 py-0.5 text-xs",
                  r.night === "free" && "bg-emerald-100 text-emerald-900",
                  r.night === "booked" && "bg-sky-100 text-sky-900",
                  r.night === "blocked" && "bg-slate-200 text-slate-900",
                )}
              >
                {r.night === "free"
                  ? "פנויה הלילה"
                  : r.night === "booked"
                    ? "תפוסה הלילה"
                    : "חסומה"}
              </span>
            </div>
            {r.leaving && bookingButton(r.leaving, "עוזבים")}
            {r.arriving && bookingButton(r.arriving, "מגיעים")}
            {r.staying &&
              r.staying !== r.arriving &&
              r.staying.unit_id === r.unit.id &&
              bookingButton(r.staying, "שוהים")}
            {r.staying && r.staying.unit_id !== r.unit.id && (
              <span className="text-muted-foreground">
                {r.unit.kind === "whole_property"
                  ? `חלק מהמתחם תפוס — #${r.staying.number}`
                  : `תפוסה דרך "כל המתחם" — #${r.staying.number}`}
              </span>
            )}
            {r.block && (
              <button
                type="button"
                className="min-h-11 text-start hover:underline"
                onClick={() => props.onBlock(r.block!)}
              >
                חסום{r.block.reason ? ` — ${r.block.reason}` : ""}
              </button>
            )}
            {r.night === "free" && (
              <div className="flex flex-wrap gap-2">
                <Link
                  to="/manage/bookings/new"
                  search={{ unit: r.unit.id, from: props.date, to: addDays(props.date, 1) }}
                  className="inline-flex min-h-11 items-center rounded-md border px-3 font-medium text-primary hover:bg-primary/5"
                >
                  הוספת הזמנה
                </Link>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center rounded-md border px-3 hover:bg-muted"
                  onClick={() => props.onNewBlock(r.unit.id)}
                >
                  חסימה
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
