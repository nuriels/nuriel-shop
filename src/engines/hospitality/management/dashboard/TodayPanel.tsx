// "היום בעסק" בלוח הבקרה (שלב F3): מגיעים ועוזבים היום (עם כפתור "הגיעו" / "עזבו"), שוהים,
// וצ'ק-אין בשבוע הקרוב. שמות — שם פרטי ואות (המסד מקצר). הפעולות — אותן פונקציות כמו בעמוד
// ההזמנה, עם בדיקת גרסה (מצב ישן לא נדרס), הודעה על הצלחה ורענון הלוח.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { LogIn, LogOut, Moon, Sunrise } from "lucide-react";
import { toast } from "sonner";
import { Button, cn } from "@/platform/ui";
import { hospitalitySetStayStatus } from "../../api/bookings.functions";
import { hospitalityDashboardToday } from "../../api/dashboard.functions";
import type { DashboardStay } from "../../types/dashboard";
import { useBookingRefresh } from "../bookings/refresh";
import { errorText } from "../catalog/refresh";
import { ErrorState, SectionCard, SkeletonBlock, StatusPill } from "../ui/kit";
import { dashboardKeys, initials, longDate, shortDate } from "./model";

const PAYMENT: Record<
  DashboardStay["payment_status"],
  { text: string; tone: "success" | "warning" | "neutral" }
> = {
  paid: { text: "שולם", tone: "success" },
  deposit_paid: { text: "מקדמה שולמה", tone: "warning" },
  unpaid: { text: "לא שולם", tone: "neutral" },
};

const guestsText = (s: DashboardStay) => {
  const n = s.adults + s.children;
  return n === 1 ? "אורח אחד" : `${n} אורחים`;
};
const nightsText = (n: number) => (n === 1 ? "לילה אחד" : `${n} לילות`);

export function TodayPanel() {
  const query = useQuery({
    queryKey: dashboardKeys.today,
    queryFn: () => hospitalityDashboardToday(),
    refetchInterval: 60_000,
  });
  const d = query.data;
  return (
    <SectionCard
      title="היום בעסק"
      description={d ? longDate(d.today) : undefined}
      className="h-full"
      id="today"
    >
      {query.isPending ? (
        <div className="flex flex-col gap-2">
          <SkeletonBlock className="h-16" />
          <SkeletonBlock className="h-14" />
          <SkeletonBlock className="h-14" />
        </div>
      ) : query.isError || !d ? (
        <ErrorState message="הנתונים של היום לא נטענו." onRetry={() => void query.refetch()} />
      ) : (
        <div className="flex flex-col gap-5">
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "מגיעים", value: d.arrivals.length, icon: LogIn },
              { label: "עוזבים", value: d.departures.length, icon: LogOut },
              { label: "שוהים", value: d.staying, icon: Moon },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-[var(--hm-surface-2)] px-2 py-3">
                <dt className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                  <s.icon className="size-3.5" aria-hidden="true" />
                  {s.label}
                </dt>
                <dd className="mt-1 text-xl font-bold text-[var(--hm-lagoon-900)]" data-num="">
                  {s.value}
                </dd>
              </div>
            ))}
          </dl>

          <StayList
            title={`מגיעים היום${d.check_in_time ? ` · צ'ק-אין מ-${d.check_in_time}` : ""}`}
            empty="אין הגעות היום."
            stays={d.arrivals}
            action="in"
          />
          <StayList
            title={`עוזבים היום${d.check_out_time ? ` · צ'ק-אאוט עד ${d.check_out_time}` : ""}`}
            empty="אין עזיבות היום."
            stays={d.departures}
            action="out"
          />
          {d.upcoming.length > 0 && (
            <StayList
              title="מגיעים בשבוע הקרוב"
              empty=""
              stays={d.upcoming}
              action="none"
              upcoming
            />
          )}
        </div>
      )}
    </SectionCard>
  );
}

function StayList({
  title,
  empty,
  stays,
  action,
  upcoming = false,
}: {
  title: string;
  empty: string;
  stays: DashboardStay[];
  action: "in" | "out" | "none";
  upcoming?: boolean;
}) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-[var(--hm-ink-2)]">
        {upcoming && <Sunrise className="size-4" aria-hidden="true" />}
        {title}
      </h3>
      {stays.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border">
          {stays.map((s) => (
            <StayRow key={s.id} stay={s} action={action} upcoming={upcoming} />
          ))}
        </ul>
      )}
    </section>
  );
}

function StayRow({
  stay,
  action,
  upcoming,
}: {
  stay: DashboardStay;
  action: "in" | "out" | "none";
  upcoming: boolean;
}) {
  const refresh = useBookingRefresh(stay.id);
  const [busy, setBusy] = useState(false);
  const pay = PAYMENT[stay.payment_status];
  const canIn = action === "in" && stay.status === "confirmed";
  const canOut = action === "out" && stay.status === "checked_in";
  const done =
    (action === "in" && stay.status === "checked_in") ||
    (action === "out" && stay.status === "checked_out");

  const run = async (status: "checked_in" | "checked_out") => {
    setBusy(true);
    try {
      await hospitalitySetStayStatus({
        data: { id: stay.id, status, revision: stay.revision },
      });
      toast.success(
        status === "checked_in" ? `${stay.guest} — סומנו כהגיעו` : `${stay.guest} — סומנו כעזבו`,
      );
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span
        aria-hidden="true"
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--hm-lagoon-100)] text-xs font-bold text-[var(--hm-lagoon-700)]"
      >
        {initials(stay.guest)}
      </span>
      <div className="min-w-0 flex-1">
        <Link
          to="/manage/bookings/$bookingId"
          params={{ bookingId: stay.id }}
          className="block truncate text-sm font-semibold hover:underline"
        >
          {stay.guest} · {stay.unit_name}
        </Link>
        <p className="truncate text-xs text-muted-foreground">
          {upcoming ? `${shortDate(stay.check_in)} · ` : ""}#{stay.number} ·{" "}
          {nightsText(stay.nights)} · {guestsText(stay)}
        </p>
      </div>
      {!upcoming && (
        <StatusPill tone={pay.tone} className="hidden sm:inline-flex">
          {pay.text}
        </StatusPill>
      )}
      {(canIn || canOut) && (
        <Button
          type="button"
          size="sm"
          variant={canIn ? "default" : "outline"}
          className={cn("min-h-10 shrink-0 gap-1.5")}
          disabled={busy}
          onClick={() => void run(canIn ? "checked_in" : "checked_out")}
        >
          {canIn ? (
            <LogIn className="size-4" aria-hidden="true" />
          ) : (
            <LogOut className="size-4" aria-hidden="true" />
          )}
          {canIn ? "הגיעו" : "עזבו"}
          <span className="sr-only"> — {stay.guest}</span>
        </Button>
      )}
      {done && (
        <StatusPill tone="success" className="shrink-0">
          {action === "in" ? "הגיעו" : "עזבו"}
        </StatusPill>
      )}
    </li>
  );
}
