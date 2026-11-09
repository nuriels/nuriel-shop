// "אירועים" (/manage/events) — מתחם הבריכה לאירועים בלי לינה (מיגרציה 63), נפרד מ"הזמנות":
// לשוניות (קרובים · ממתינים · עבר · בוטלו · הכל) עם ספירות, חיפוש לפי שם / טלפון / אימייל / מספר,
// סינון לפי סוג ותאריכים, ותנאי החוזה בראש העמוד (פיקדון, איחור, שעות הבריכה, עד 50 משתתפים).
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PartyPopper, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Card, CardContent, Input, Label, cn } from "@/platform/ui";
import { hospitalityEvents } from "../../api/events.functions";
import { EVENT_TYPES, EVENT_TYPE_LABEL, type EventTab, type StaffEvent } from "../../types/events";
import { LoadError, PageSkeleton } from "../catalog/parts";
import { formatMoney } from "../lib/format";
import { useManagement } from "../shell/management-context";
import { EmptyState } from "../ui/kit";
import {
  EVENT_STATUS_LABEL,
  EVENT_TABS,
  PAYMENT_STATUS_LABEL,
  STATUS_TONE,
  dayText,
  eventsKey,
  hoursText,
} from "./model";

const PAGE = 30;
const SELECT = "min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm";

export function EventsPage() {
  const ctx = useManagement();
  const [tab, setTab] = useState<EventTab>("upcoming");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => setLimit(PAGE), [tab, q, type, from, to]);
  const shownTab: EventTab = q ? "all" : tab;
  const query = useQuery({
    queryKey: [...eventsKey(shownTab, q, type, from, to), limit],
    queryFn: () =>
      hospitalityEvents({
        data: {
          tab: shownTab,
          q: q || null,
          type: type || null,
          from: from || null,
          to: to || null,
          limit,
          offset: 0,
        },
      }),
    placeholderData: keepPreviousData,
  });
  if (!ctx.permissions["bookings"])
    return <p className="p-4">אין לכם הרשאה לראות אירועים באתר הזה.</p>;
  if (query.isError && !query.data) return <LoadError error={query.error} />;
  if (!query.data) return <PageSkeleton label="טוען אירועים…" />;
  const data = query.data;
  const t = data.terms;
  const current = EVENT_TABS.find((x) => x.key === shownTab)!;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">אירועים</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            הזמנת מתחם הבריכה לאירוע, בלי לינה בצימרים — נפרד מהזמנות הלינה. אין שני אירועים באותו
            מתחם באותו זמן.
          </p>
        </div>
        <Link
          to="/manage/events/new"
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" aria-hidden="true" />
          אירוע חדש
        </Link>
      </header>

      <p
        className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground"
        data-testid="event-terms"
      >
        לפי החוזה: עד <strong>{t.max_event_guests}</strong> משתתפים · פיקדון / ערבות{" "}
        <strong>{formatMoney(t.deposit_amount)}</strong> · איחור בפינוי{" "}
        <strong>{formatMoney(t.event_late_fee_per_hour)}</strong> לשעה · שעות הבריכה{" "}
        <strong>
          {t.pool_open_time}–{t.pool_close_time}
        </strong>
        .{" "}
        <Link to="/manage/client-documents" search={{ tab: "terms" }} className="underline">
          תנאי העסק לחוזים
        </Link>
      </p>

      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-1">
          <Label htmlFor="ev-search">חיפוש — שם, טלפון, אימייל או מספר</Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute start-3 top-3.5 size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="ev-search"
              type="search"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-h-11 ps-9"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ev-type">סוג</Label>
          <select
            id="ev-type"
            className={SELECT}
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">כל הסוגים</option>
            {EVENT_TYPES.map((k) => (
              <option key={k} value={k}>
                {EVENT_TYPE_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ev-from">מתאריך</Label>
          <Input
            id="ev-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="min-h-11"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ev-to">עד תאריך</Label>
          <Input
            id="ev-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="min-h-11"
          />
        </div>
      </div>

      {!q && (
        <div role="tablist" aria-label="סוג האירועים" className="flex gap-1 overflow-x-auto pb-1">
          {EVENT_TABS.map((x) => (
            <button
              key={x.key}
              type="button"
              role="tab"
              aria-selected={tab === x.key}
              onClick={() => setTab(x.key)}
              className={cn(
                "flex min-h-11 shrink-0 items-center gap-2 rounded-md border px-3 text-sm",
                tab === x.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background",
              )}
            >
              {x.label}
              <span
                className={cn(
                  "rounded-full px-2 text-xs",
                  tab === x.key ? "bg-primary-foreground/20" : "bg-muted",
                  x.key === "pending" &&
                    data.counts.pending > 0 &&
                    tab !== x.key &&
                    "bg-amber-200 text-amber-950",
                )}
              >
                {data.counts[x.key]}
              </span>
            </button>
          ))}
        </div>
      )}

      <section aria-live="polite" aria-busy={query.isFetching}>
        {q && (
          <p className="mb-2 text-sm text-muted-foreground">
            {data.total === 0 ? `לא נמצאו אירועים עבור "${q}".` : `נמצאו ${data.total} אירועים.`}
          </p>
        )}
        {data.rows.length === 0 ? (
          !q && <EmptyState icon={PartyPopper} title={current.empty} />
        ) : (
          <ul className="flex flex-col gap-2" data-testid="events-list">
            {data.rows.map((e) => (
              <EventCard key={e.id} e={e} />
            ))}
          </ul>
        )}
        {data.rows.length < data.total && (
          <Button
            type="button"
            variant="outline"
            className="mt-3 min-h-11 w-full"
            disabled={query.isFetching}
            onClick={() => setLimit((l) => Math.min(l + PAGE, 200))}
          >
            הצגת עוד ({data.total - data.rows.length})
          </Button>
        )}
      </section>
    </div>
  );
}

function EventCard({ e }: { e: StaffEvent }) {
  return (
    <li>
      <Link
        to="/manage/events/$eventId"
        params={{ eventId: e.id }}
        className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Card
          className="transition-[border-color,box-shadow] hover:border-[var(--hm-lagoon-500)] hover:shadow-[var(--hm-shadow-lift)]"
          data-event={e.number}
        >
          <CardContent className="flex flex-col gap-1.5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">
                #{e.number} · {e.event_type_label} · {e.customer?.full_name ?? "—"}
              </p>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  STATUS_TONE[e.status],
                )}
              >
                {EVENT_STATUS_LABEL[e.status]}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {dayText(e.event_date)} · {hoursText(e)} · {e.participants} משתתפים
              {e.property_name ? ` · ${e.property_name}` : ""}
            </p>
            <p className="text-sm text-muted-foreground">
              {e.pool_start_time && e.pool_end_time
                ? `בריכה ${e.pool_start_time}–${e.pool_end_time} בלבד`
                : "בלי שימוש בבריכה"}
              {e.outside_pool_hours ? " · האירוע חורג משעות הבריכה" : ""}
            </p>
            <p className="text-sm">
              {formatMoney(e.price)} · {PAYMENT_STATUS_LABEL[e.payment_status]}
            </p>
          </CardContent>
        </Card>
      </Link>
    </li>
  );
}
