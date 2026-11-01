// מסך "הזמנות" (/manage/bookings) — Stage 2h: לשוניות (ממתינות לטיפול · קרובות · שוהים
// עכשיו · עבר · בוטלו) עם ספירות, חיפוש לפי מספר / שם / טלפון / אימייל, כרטיס לכל הזמנה עם
// ספירה לאחור לאישור, ו"הצגת עוד". פרטי קשר ממוסכים ברשימה; המלאים — בכרטיס, למי שמורשה.
// לחיצה על הזמנה פותחת את עמוד ההזמנה (אישור / דחייה / הגעה / עזיבה).
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";
import { Plus, Search } from "lucide-react";
import { Button, Card, CardContent, Input, Label, cn } from "@/platform/ui";
import { hospitalityBookings } from "../../api/bookings.functions";
import type { BookingRow, BookingTab } from "../../types/bookings";
import { LoadError, PageSkeleton } from "../catalog/parts";
import { money } from "../pricing/model";
import { useManagement } from "../shell/management-context";
import {
  PAYMENT_LABELS,
  STATE_LABELS,
  TABS,
  bookingsKey,
  guestsText,
  holdText,
  parseBookingsSearch,
  sourceText,
  stateTone,
  stayText,
  TONE_CLASS,
} from "./model";

/** מצבים שבהם מוצג מצב התשלום (בקשה / הזמנה פעילה / שהייה שהסתיימה) */
const PAYMENT_SHOWN = new Set<string>([
  "pending_approval",
  "pending_payment",
  "confirmed",
  "cancel_requested",
  "checked_in",
  "checked_out",
]);

const PAGE = 30;

export function BookingsPage() {
  const ctx = useManagement();
  // ?tab= — קישור ישיר ללשונית (למשל "ממתינות לטיפול" מלוח הבקרה); ?q= — מהחיפוש המהיר
  const params = parseBookingsSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const linked = params.tab;
  const [tab, setTab] = useState<Exclude<BookingTab, "all">>(linked ?? "pending");
  useEffect(() => {
    if (linked) setTab(linked);
  }, [linked]);
  const [text, setText] = useState(params.q ?? "");
  useEffect(() => {
    if (params.q) setText(params.q);
  }, [params.q]);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  // חיפוש: מחכים רגע אחרי ההקלדה; בחיפוש מציגים את כל הלשוניות
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => setLimit(PAGE), [tab, q]);
  const shownTab: BookingTab = q ? "all" : tab;
  const query = useQuery({
    queryKey: [...bookingsKey(shownTab, q), limit],
    queryFn: () => hospitalityBookings({ data: { tab: shownTab, q: q || null, limit, offset: 0 } }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
  if (!ctx.permissions["bookings"])
    return <p className="p-4">אין לכם הרשאה לראות הזמנות באתר הזה.</p>;
  if (query.isError && !query.data) return <LoadError error={query.error} />;
  if (!query.data) return <PageSkeleton label="טוען הזמנות…" />;
  const data = query.data;
  const current = TABS.find((t) => t.key === tab)!;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">הזמנות</h1>
        <Link
          to="/manage/bookings/new"
          className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" aria-hidden="true" />
          הוספת הזמנה
        </Link>
      </header>

      <div className="flex flex-col gap-1">
        <Label htmlFor="bk-search">חיפוש — מספר הזמנה, שם, טלפון או אימייל</Label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute start-3 top-3.5 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="bk-search"
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-11 ps-9"
          />
        </div>
      </div>

      {!q && (
        <div role="tablist" aria-label="סוג ההזמנות" className="flex gap-1 overflow-x-auto pb-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "flex min-h-11 shrink-0 items-center gap-2 rounded-md border px-3 text-sm",
                tab === t.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background",
              )}
            >
              {t.label}
              <span
                className={cn(
                  "rounded-full px-2 text-xs",
                  tab === t.key ? "bg-primary-foreground/20" : "bg-muted",
                  t.key === "pending" &&
                    data.counts.pending > 0 &&
                    tab !== t.key &&
                    "bg-amber-200 text-amber-950",
                )}
              >
                {data.counts[t.key]}
              </span>
            </button>
          ))}
        </div>
      )}

      <section aria-live="polite" aria-busy={query.isFetching}>
        {q && (
          <p className="mb-2 text-sm text-muted-foreground">
            {data.total === 0 ? `לא נמצאו הזמנות עבור "${q}".` : `נמצאו ${data.total} הזמנות.`}
          </p>
        )}
        {!q && data.items.length === 0 ? (
          <p className="rounded-md border p-6 text-center text-muted-foreground">{current.empty}</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="bookings-list">
            {data.items.map((b) => (
              <BookingCard key={b.id} b={b} />
            ))}
          </ul>
        )}
        {data.items.length < data.total && (
          <Button
            type="button"
            variant="outline"
            className="mt-3 min-h-11 w-full"
            disabled={query.isFetching}
            onClick={() => setLimit((l) => Math.min(l + PAGE, 100))}
          >
            הצגת עוד ({data.total - data.items.length})
          </Button>
        )}
      </section>
    </div>
  );
}

function BookingCard({ b }: { b: BookingRow }) {
  const hold =
    b.state === "pending_approval" || b.state === "pending_payment"
      ? holdText(b.hold_expires_at)
      : null;
  return (
    <li>
      <Link
        to="/manage/bookings/$bookingId"
        params={{ bookingId: b.id }}
        className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Card className="transition-colors hover:border-primary" data-booking={b.number}>
          <CardContent className="flex flex-col gap-1.5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">
                #{b.number} · {b.guest_name}
              </p>
              <span
                className={cn(
                  "rounded px-2 py-0.5 text-xs font-medium",
                  TONE_CLASS[stateTone(b.state)],
                )}
              >
                {STATE_LABELS[b.state]}
              </span>
            </div>
            <p className="text-sm">
              {b.unit_name}
              <span className="text-muted-foreground"> · {b.property_name}</span>
            </p>
            <p className="text-sm">{stayText(b)}</p>
            <p className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
              <span>{guestsText(b)}</span>
              <span>{money(b.total, b.currency)}</span>
              <span>{sourceText(b)}</span>
              {/* D4: מצב התשלום — נפרד ממצב ההזמנה; לפי מה שנרשם בלבד */}
              {PAYMENT_SHOWN.has(b.state) && (
                <span
                  className={cn(
                    "rounded px-1.5 text-xs font-medium",
                    b.payment_status === "paid"
                      ? "bg-emerald-100 text-emerald-900"
                      : b.payment_status === "deposit_paid"
                        ? "bg-sky-100 text-sky-900"
                        : "bg-amber-100 text-amber-950",
                  )}
                >
                  {PAYMENT_LABELS[b.payment_status]}
                </span>
              )}
            </p>
            {hold && <p className="text-sm font-medium text-amber-800">{hold}</p>}
            {b.state === "cancel_requested" && (
              <p className="text-sm font-medium text-amber-800">יש להחליט על בקשת הביטול</p>
            )}
          </CardContent>
        </Card>
      </Link>
    </li>
  );
}
