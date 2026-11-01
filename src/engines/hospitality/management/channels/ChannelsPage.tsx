// "ערוצי הזמנה" (תשתית Stage 12): סנכרון זמינות עם Airbnb, Booking.com ואחרים דרך iCal.
//   • ייצוא — לכל יחידה קישור סודי (מדביקים אותו בערוץ), עם לילות תפוסים בלבד; אפשר להחליף;
//   • ייבוא — קישורי היומן של הערוץ; כל 30 דקות (וגם "סנכרן עכשיו") הלילות שנתפסו שם נחסמים כאן.
//     חפיפה עם הזמנה / חסימה קיימת לא נכתבת — מופיעה כ"התנגשות" לטיפול. הזמנות שלנו לא משתנות.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Link2, Plus, RefreshCw, Trash2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from "@/platform/ui";
import {
  hospitalityChannelCalendarAdd,
  hospitalityChannelCalendarRemove,
  hospitalityChannelFeedToken,
  hospitalityChannelSyncNow,
  hospitalityChannels,
} from "../../api/channels.functions";
import type { ChannelCalendar, ChannelKind, ChannelUnit } from "../../types/channels";
import { errorText } from "../catalog/refresh";
import { formatDate, formatDateTime } from "../lib/format";
import { planFeatureOpen } from "../lib/plan-features";
import { PremiumNotice } from "../lib/PremiumNotice";
import { manageKeys } from "../lib/query-keys";
import { useManagement } from "../shell/management-context";

const KEY = [...manageKeys.all, "channels"] as const;
const CHANNEL_LABELS: Record<ChannelKind, string> = {
  airbnb: "Airbnb",
  booking: "Booking.com",
  vrbo: "Vrbo",
  google: "Google",
  other: "אחר",
};

export function ChannelsPage() {
  const ctx = useManagement();
  const query = useQuery({ queryKey: KEY, queryFn: () => hospitalityChannels() });
  // שלב E3: בחבילה בלי סנכרון — אין הוספה; מה שכבר מחובר ממשיך (ומוצג)
  const locked = !planFeatureOpen(ctx, "channels");
  if (!ctx.permissions["bookings"]) return <p className="p-4">אין לכם הרשאה לנהל ערוצי הזמנה.</p>;
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">ערוצי הזמנה</h1>
        <p className="mt-1 text-muted-foreground">
          סנכרון זמינות עם Airbnb, Booking.com ואתרים אחרים (iCal), כדי שלא תהיה הזמנה כפולה.
        </p>
        <p className="mt-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
          iCal לא מתעדכן ברגע: הערוצים מושכים את היומן שלנו בכל כמה שעות (לפי הערוץ), ואנחנו מושכים
          את שלהם כל 30 דקות. בימים עמוסים כדאי לסנכרן ידנית ולבדוק "התנגשויות".
        </p>
      </div>
      {locked && <PremiumNotice feature="סנכרון יומנים עם Airbnb / Booking.com" />}
      {query.isError ? (
        <p role="alert" className="rounded-md border border-destructive/40 p-4 text-destructive">
          {errorText(query.error)}
        </p>
      ) : !query.data ? (
        <Skeleton className="h-56 w-full" />
      ) : query.data.length === 0 ? (
        <p className="text-muted-foreground">עוד אין יחידות.</p>
      ) : (
        query.data.map((u) => <UnitChannels key={u.unit_id} unit={u} locked={locked} />)
      )}
    </div>
  );
}

function UnitChannels({ unit, locked }: { unit: ChannelUnit; locked: boolean }) {
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: KEY });
  const [adding, setAdding] = useState(false);
  return (
    <Card data-channel-unit={unit.unit_id}>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">
          {unit.name}
          {!unit.is_active && (
            <span className="ms-2 text-sm font-normal text-muted-foreground">(לא פעילה)</span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 text-sm">
        <ExportLink unit={unit} locked={locked} onChange={refresh} />
        <section className="flex flex-col gap-2" aria-label={`יומנים לייבוא — ${unit.name}`}>
          <h3 className="font-medium">יומנים מהערוצים (ייבוא)</h3>
          {unit.calendars.length === 0 && !adding && !locked && (
            <p className="text-muted-foreground">
              בכל ערוץ יש "ייצוא יומן" / "Export calendar" — מעתיקים משם את הקישור ומוסיפים כאן.
            </p>
          )}
          {unit.calendars.map((c) => (
            <CalendarRow key={c.id} calendar={c} onChange={refresh} />
          ))}
          {adding ? (
            <AddCalendar
              unitId={unit.unit_id}
              onDone={() => {
                setAdding(false);
                refresh();
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            !locked &&
            unit.calendars.length < 5 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-10 gap-1.5 self-start"
                onClick={() => setAdding(true)}
              >
                <Plus className="size-4" aria-hidden="true" />
                הוספת יומן מערוץ
              </Button>
            )
          )}
        </section>
      </CardContent>
    </Card>
  );
}

function ExportLink({
  unit,
  locked,
  onChange,
}: {
  unit: ChannelUnit;
  locked: boolean;
  onChange: () => void;
}) {
  const url = unit.feed_token ? `${window.location.origin}/ical/${unit.feed_token}` : null;
  const make = useMutation({
    mutationFn: (rotate: boolean) =>
      hospitalityChannelFeedToken({ data: { unitId: unit.unit_id, rotate } }),
    onSuccess: (_t, rotate) => {
      toast.success(
        rotate ? "נוצר קישור חדש — הקודם הפסיק לעבוד. עדכנו אותו בערוצים." : "הקישור נוצר",
      );
      onChange();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("הקישור הועתק");
    } catch {
      toast.error("ההעתקה נכשלה — סמנו את הקישור והעתיקו ידנית");
    }
  };
  return (
    <section className="flex flex-col gap-2" aria-label={`קישור לייצוא — ${unit.name}`}>
      <h3 className="font-medium">הקישור שלנו (ייצוא לערוצים)</h3>
      {url ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              readOnly
              value={url}
              dir="ltr"
              className="min-w-0 flex-1 font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-10 gap-1.5"
              onClick={() => void copy()}
            >
              <Copy className="size-4" aria-hidden="true" />
              העתקה
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-10"
              disabled={make.isPending}
              onClick={() => make.mutate(true)}
            >
              קישור חדש
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            מדביקים בערוץ ב"ייבוא יומן" / "Import calendar". הקישור מראה רק לילות תפוסים — בלי פרטי
            אורחים. מי שיש לו את הקישור רואה את הזמינות; אם דלף — "קישור חדש".
          </p>
        </>
      ) : locked ? (
        <p className="text-muted-foreground">הקישור לייצוא זמין בחבילת פרימיום.</p>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-10 gap-1.5 self-start"
          disabled={make.isPending}
          onClick={() => make.mutate(false)}
        >
          <Link2 className="size-4" aria-hidden="true" />
          יצירת קישור לייצוא
        </Button>
      )}
    </section>
  );
}

function CalendarRow({
  calendar: c,
  onChange,
}: {
  calendar: ChannelCalendar;
  onChange: () => void;
}) {
  const sync = useMutation({
    mutationFn: () => hospitalityChannelSyncNow({ data: { id: c.id } }),
    onSuccess: (r) => {
      if (r.status === "ok") toast.success(`סונכרן — ${r.events ?? 0} אירועים`);
      else toast.error("הסנכרון נכשל — ראו את השגיאה");
      onChange();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const remove = useMutation({
    mutationFn: () => hospitalityChannelCalendarRemove({ data: { id: c.id } }),
    onSuccess: (r) => {
      toast.success(r.released ? `היומן הוסר; ${r.released} חסימות שוחררו` : "היומן הוסר");
      onChange();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="font-medium">{CHANNEL_LABELS[c.channel]}</span>
          <span className="block truncate text-xs text-muted-foreground" dir="ltr">
            {c.url}
          </span>
        </span>
        <span className="flex gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-10 gap-1.5"
            disabled={sync.isPending}
            onClick={() => sync.mutate()}
          >
            <RefreshCw
              className={sync.isPending ? "size-4 animate-spin" : "size-4"}
              aria-hidden="true"
            />
            סנכרן עכשיו
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-10 text-destructive"
            aria-label={`הסרת היומן של ${CHANNEL_LABELS[c.channel]}`}
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </span>
      </div>
      <p className="text-xs text-muted-foreground" role="status">
        {c.last_status === "never"
          ? "עוד לא סונכרן — יסונכרן בדקות הקרובות"
          : c.last_status === "ok"
            ? `סונכרן ${c.last_sync_at ? formatDateTime(c.last_sync_at) : ""} · ${c.events} תאריכים חסומים`
            : `נכשל ${c.last_sync_at ? formatDateTime(c.last_sync_at) : ""}: ${c.last_error ?? ""}`}
      </p>
      {c.conflicts.length > 0 && (
        <div role="alert" className="rounded-md bg-amber-50 p-2 text-xs text-amber-950">
          <p className="flex items-center gap-1.5 font-medium">
            <TriangleAlert className="size-4" aria-hidden="true" />
            {c.conflicts.length} התנגשויות — תאריכים שתפוסים בערוץ וגם אצלנו (לא נחסמו):
          </p>
          <ul className="mt-1 list-inside list-disc">
            {c.conflicts.map((x) => (
              <li key={`${x.uid}-${x.from}`}>
                {formatDate(`${x.from}T12:00:00Z`)} – {formatDate(`${x.to}T12:00:00Z`)}
              </li>
            ))}
          </ul>
          <p className="mt-1">
            לא שינינו ולא ביטלנו שום הזמנה. בדקו אם יש הזמנה כפולה וסגרו את התאריכים בערוץ; על
            התנגשות חדשה נשלח גם מייל לבעל העסק.
          </p>
        </div>
      )}
    </div>
  );
}

function AddCalendar({
  unitId,
  onDone,
  onCancel,
}: {
  unitId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [channel, setChannel] = useState<ChannelKind>("airbnb");
  const [url, setUrl] = useState("");
  const add = useMutation({
    mutationFn: () => hospitalityChannelCalendarAdd({ data: { unitId, channel, url } }),
    onSuccess: () => {
      toast.success("היומן נוסף — הסנכרון הראשון בדקות הקרובות");
      onDone();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="הערוץ"
          value={channel}
          onChange={(e) => setChannel(e.target.value as ChannelKind)}
          className="min-h-10 rounded-md border bg-background px-2"
        >
          {(Object.keys(CHANNEL_LABELS) as ChannelKind[]).map((k) => (
            <option key={k} value={k}>
              {CHANNEL_LABELS[k]}
            </option>
          ))}
        </select>
        <Input
          aria-label="הקישור ליומן (iCal)"
          dir="ltr"
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="min-w-0 flex-1"
        />
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          className="min-h-10"
          disabled={!url.startsWith("https://") || add.isPending}
          onClick={() => add.mutate()}
        >
          הוספה
        </Button>
        <Button type="button" size="sm" variant="ghost" className="min-h-10" onClick={onCancel}>
          ביטול
        </Button>
      </div>
    </div>
  );
}
