// לוח הבקרה של בעל העסק (שלב F3, "Deep Lagoon & Champagne"):
//   ברכה עם השם, בחירת תקופה (היום / השבוע / החודש / 30 יום / החודש הקודם / טווח מותאם — בכתובת),
//   פעולות מהירות, כרטיסי מספרים עם השוואה לתקופה הקודמת, גרף, "דורש טיפול", לוח תפוסה ל-14
//   לילות, "היום בעסק", רשימת ההקמה (כל עוד לא הושלמה), היחידות, מצב האתר והחבילה.
// כל מה שמוצג — לפי ההרשאות; הנתונים הכספיים נאכפים במסד (dashboard_overview).
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  Ban,
  BedDouble,
  CheckCircle2,
  Circle,
  ExternalLink,
  Globe,
  Lock,
  Palette,
  Plus,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/platform/ui";
import { hospitalityDashboardOverview } from "../../api/dashboard.functions";
import { CHECKLIST_STEPS, checklistProgress } from "../lib/checklist";
import { formatDate, usageText } from "../lib/format";
import { useManagement } from "../shell/management-context";
import {
  ErrorState,
  IconTile,
  MeterBar,
  PageHeader,
  SectionCard,
  SkeletonBlock,
  StatusPill,
} from "../ui/kit";
import type { Tone } from "../ui/tones";
import { KpiGrid } from "./KpiGrid";
import { OccupancyBoard } from "./OccupancyBoard";
import { PeriodPicker } from "./PeriodPicker";
import { TasksCard } from "./TasksCard";
import { TodayPanel } from "./TodayPanel";
import { TrendChart } from "./TrendChart";
import { UnitsCard } from "./UnitsCard";
import {
  type PeriodKey,
  businessHour,
  businessToday,
  dashboardKeys,
  greeting,
  longDate,
  parseDashboardSearch,
  periodRange,
  periodText,
} from "./model";

export function Dashboard() {
  const ctx = useManagement();
  const search = parseDashboardSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const navigate = useNavigate();
  const tz = ctx.business.timezone;
  const today = businessToday(tz);
  const period: PeriodKey = search.period ?? "d30";
  const range = periodRange(
    period,
    today,
    search.from && search.to ? { from: search.from, to: search.to } : null,
  );
  const canReports = ctx.permissions["reports"] === true;
  const canBookings = ctx.permissions["bookings"] === true;
  const overview = useQuery({
    queryKey: dashboardKeys.overview(range.from, range.to),
    queryFn: () => hospitalityDashboardOverview({ data: range }),
    enabled: canReports,
    placeholderData: keepPreviousData,
    refetchInterval: 120_000,
  });
  const firstName = overview.data?.me.first_name;
  const label = periodText(period, range);

  const setPeriod = (key: PeriodKey, custom?: { from: string; to: string }) =>
    void navigate({
      to: "/manage",
      search:
        key === "custom" && custom
          ? { period: key, ...custom }
          : key === "d30"
            ? {}
            : { period: key },
      replace: true,
    });

  return (
    <div className="mx-auto flex max-w-[88rem] flex-col gap-6">
      <PageHeader
        display
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            <span>{longDate(today)}</span>
            <StatusPill tone={ctx.flags.frontend ? "success" : "neutral"}>
              {ctx.flags.frontend ? "האתר פתוח לאורחים" : "האתר עוד סגור לאורחים"}
            </StatusPill>
          </span>
        }
        title={
          <span data-testid="dashboard-greeting">{`${greeting(businessHour(tz))}, ${firstName ?? ctx.business.name}`}</span>
        }
        description={
          <>
            כך נראה <span className="font-semibold text-foreground">{ctx.business.name}</span>
            {canReports ? ` — ${label}` : ""}
          </>
        }
        actions={
          canReports ? (
            <PeriodPicker
              key={`${range.from}:${range.to}`}
              value={period}
              range={range}
              onChange={setPeriod}
            />
          ) : undefined
        }
      />

      <SetupChecklist />

      <QuickActions />

      {canReports &&
        (overview.data ? (
          <div
            className={cn(
              "flex flex-col gap-6 transition-opacity",
              overview.isPlaceholderData && "opacity-60",
            )}
          >
            <KpiGrid data={overview.data} period={period} />
            <div className="grid gap-6 xl:grid-cols-3">
              <div className="min-w-0 xl:col-span-2">
                <TrendChart data={overview.data} periodLabel={label} />
              </div>
              {canBookings && <TasksCard canBookings={canBookings} />}
            </div>
          </div>
        ) : overview.isError ? (
          <ErrorState
            message={overview.error instanceof Error ? overview.error.message : undefined}
            onRetry={() => void overview.refetch()}
          />
        ) : (
          <div className="flex flex-col gap-6" aria-busy="true" aria-label="טוען את הנתונים">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {[0, 1, 2, 3, 4].map((i) => (
                <SkeletonBlock key={i} className="h-36" />
              ))}
            </div>
            <SkeletonBlock className="h-80" />
          </div>
        ))}
      {!canReports && canBookings && <TasksCard canBookings={canBookings} />}

      {canBookings && (
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="min-w-0 xl:col-span-2">
            <OccupancyBoard today={today} />
          </div>
          <TodayPanel />
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {ctx.permissions["catalog"] && <UnitsCard />}
        <SiteStatusCard />
        {ctx.permissions["billing.manage"] && <PlanCard />}
      </div>
    </div>
  );
}

// ---------- פעולות מהירות ----------

function QuickActions() {
  const ctx = useManagement();
  const p = ctx.permissions;
  const cls =
    "group flex h-full min-h-[4.5rem] items-center gap-2.5 rounded-2xl border bg-card px-3 py-3 shadow-[var(--hm-shadow-card)] transition-shadow hover:shadow-[var(--hm-shadow-lift)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hm-lagoon-500)] sm:gap-3 sm:px-4";
  const body = (label: string, hint: string, icon: LucideIcon, tone: Tone) => (
    <>
      <IconTile icon={icon} tone={tone} size="lg" />
      <span className="min-w-0">
        <span className="block text-sm font-bold">{label}</span>
        <span className="hidden truncate text-xs text-muted-foreground sm:block">{hint}</span>
      </span>
    </>
  );
  // כל פעולה — רק למי שמורשה למסך שהיא פותחת
  const actions: { key: string; node: ReactNode }[] = [];
  if (p["bookings"])
    actions.push({
      key: "booking",
      node: (
        <Link to="/manage/bookings/new" className={cls} data-lift="">
          {body("הזמנה חדשה", "טלפון, דלפק או ערוץ", Plus, "brand")}
        </Link>
      ),
    });
  if (p["catalog"])
    actions.push({
      key: "unit",
      node: (
        <Link to="/manage/units" search={{ add: "unit" }} className={cls} data-lift="">
          {body("הוספת יחידה", "חדר, צימר או סוויטה", BedDouble, "champagne")}
        </Link>
      ),
    });
  if (p["bookings"])
    actions.push({
      key: "block",
      node: (
        <Link to="/manage/calendar" search={{ block: "1" }} className={cls} data-lift="">
          {body("חסימת תאריכים", "שיפוץ או שימוש פרטי", Ban, "neutral")}
        </Link>
      ),
    });
  if (p["settings"])
    actions.push({
      key: "site",
      node: (
        <Link to="/manage/website" className={cls} data-lift="">
          {body("עריכת האתר", "תמונות, טקסטים ועיצוב", Palette, "info")}
        </Link>
      ),
    });
  if (actions.length === 0) return null;
  return (
    <nav aria-label="פעולות מהירות">
      <ul className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        {actions.map((a) => (
          <li key={a.key} data-action={a.key}>
            {a.node}
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ---------- רשימת ההקמה ----------

function SetupChecklist() {
  const ctx = useManagement();
  const progress = checklistProgress(ctx.checklist);
  const list = (
    <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
      {CHECKLIST_STEPS.map((step) => {
        const done = ctx.checklist[step.key];
        return (
          <li
            key={step.key}
            data-step={step.key}
            className={cn(
              "flex flex-col gap-2 rounded-xl border p-3",
              done ? "border-[var(--hm-success-bg)] bg-[var(--hm-success-bg)]/40" : "bg-card",
            )}
          >
            <p className="flex items-center gap-2 text-sm font-semibold">
              {done ? (
                <CheckCircle2
                  className="size-5 shrink-0 text-[var(--hm-success)]"
                  aria-hidden="true"
                />
              ) : (
                <Circle className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
              {step.title}
              <span className="sr-only">{done ? " — הושלם" : " — עוד לא הושלם"}</span>
            </p>
            <p className="text-xs text-muted-foreground">{step.hint}</p>
            {!done && step.to && (
              <Link
                to={step.to}
                className="mt-auto inline-flex min-h-10 w-fit items-center rounded-lg bg-[var(--hm-lagoon-100)] px-3 text-xs font-bold text-[var(--hm-lagoon-700)] hover:underline"
              >
                להשלמה<span className="sr-only"> — {step.title}</span>
              </Link>
            )}
          </li>
        );
      })}
    </ol>
  );
  if (progress.complete)
    return (
      <details className="group rounded-2xl border bg-card px-5 py-3 shadow-[var(--hm-shadow-card)]">
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-sm font-semibold">
          <CheckCircle2 className="size-5 text-[var(--hm-success)]" aria-hidden="true" />
          העסק מוכן — {progress.done} מתוך {progress.total} צעדים הושלמו
        </summary>
        {list}
      </details>
    );
  return (
    <SectionCard
      title="הקמת העסק"
      description={`${progress.done} מתוך ${progress.total} צעדים הושלמו`}
      actions={
        <span className="text-sm font-bold text-[var(--hm-lagoon-700)]" data-num="">
          {progress.percent}%
        </span>
      }
      className="border-[var(--hm-champagne-100)] bg-[linear-gradient(180deg,#fffdf8,#fff)]"
    >
      <MeterBar value={progress.percent} label="התקדמות ההקמה" tone="champagne" />
      {list}
    </SectionCard>
  );
}

// ---------- מצב האתר ----------

function SiteStatusCard() {
  const ctx = useManagement();
  return (
    <SectionCard title="מצב האתר">
      <div className="flex flex-col gap-3 text-sm">
        <p className="flex items-center gap-2 font-medium">
          {ctx.flags.frontend ? (
            <Globe className="size-4 text-[var(--hm-success)]" aria-hidden="true" />
          ) : (
            <Lock className="size-4 text-muted-foreground" aria-hidden="true" />
          )}
          {ctx.flags.frontend ? "האתר הציבורי פתוח לאורחים" : "האתר הציבורי עדיין סגור לאורחים"}
        </p>
        <p className="text-muted-foreground">
          {ctx.flags.booking
            ? "קבלת הזמנות מהאתר פעילה."
            : "קבלת הזמנות מהאתר עדיין לא פעילה — אפשר להכין הכול מראש."}
        </p>
        {ctx.flags.frontend && (
          <a
            href="/stay"
            target="_blank"
            rel="noopener"
            className="inline-flex min-h-10 w-fit items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold hover:bg-[var(--hm-surface-2)]"
          >
            צפייה באתר
            <ExternalLink className="size-4" aria-hidden="true" />
            <span className="sr-only">(נפתח בחלון חדש)</span>
          </a>
        )}
      </div>
    </SectionCard>
  );
}

// ---------- החבילה ----------

function PlanCard() {
  const ctx = useManagement();
  const e = ctx.entitlements;
  const status =
    e.status === "trialing"
      ? `ניסיון עד ${formatDate(e.trial_ends_at, ctx.business.timezone)}`
      : e.active
        ? "פעיל"
        : "לא פעיל";
  return (
    <SectionCard id="plan" title="החבילה שלי" description={e.plan_name}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">מצב</dt>
        <dd>
          <StatusPill
            tone={e.active ? (e.status === "trialing" ? "champagne" : "success") : "danger"}
          >
            {status}
          </StatusPill>
        </dd>
        <dt className="text-muted-foreground">יחידות</dt>
        <dd>{usageText(e.units_used, e.max_units)}</dd>
        <dt className="text-muted-foreground">מנהלים</dt>
        <dd>{usageText(e.managers_used ?? 0, e.max_managers)}</dd>
        {e.max_properties !== undefined && (
          <>
            <dt className="text-muted-foreground">מתחמים</dt>
            <dd>{usageText(e.properties_used ?? 0, e.max_properties)}</dd>
          </>
        )}
        {e.max_media !== undefined && (
          <>
            <dt className="text-muted-foreground">תמונות לגלריה</dt>
            <dd>עד {e.max_media}</dd>
          </>
        )}
      </dl>
      {e.features && (
        <ul className="mt-3 flex flex-col gap-1 text-sm" aria-label="מה כלול בחבילה">
          {(
            [
              ["channels", "סנכרון Airbnb / Booking.com"],
              ["room_types", "סוגי חדרים"],
              ["promotions", "קופונים ומבצעים"],
            ] as const
          ).map(([key, text]) => (
            <li key={key} className={e.features?.[key] ? "" : "text-muted-foreground"}>
              <span aria-hidden="true">{e.features?.[key] ? "✓ " : "— "}</span>
              {text}
              {!e.features?.[key] && <span> (בפרימיום)</span>}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
