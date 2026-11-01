// כרטיסי המספרים של לוח הבקרה (שלב F3): הזמנות חדשות, הכנסות מאירוח, גבייה בפועל, תפוסה,
// ממתינות לאישור. הכנסות וגבייה — רק למי שיש לו הרשאת "נתונים כספיים" (המסד מחזיר null לאחרים);
// במקומן — לילות שנמכרו. כל כרטיס: ערך, שינוי מול התקופה הקודמת ומיני-גרף מאותה חלוקה.
import { Link } from "@tanstack/react-router";
import {
  BedDouble,
  Banknote,
  CalendarCheck,
  ChartPie,
  Clock,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/platform/ui";
import type { DashboardOverview } from "../../types/dashboard";
import { formatMoney, formatNumber } from "../lib/format";
import { IconTile, MeterBar, Sparkline, StatusPill, TrendBadge } from "../ui/kit";
import type { Tone } from "../ui/tones";
import { collectedShare, deltas, dueText, type PeriodKey, compareText } from "./model";

interface Kpi {
  key: string;
  label: string;
  value: string;
  icon: LucideIcon;
  tone: Tone;
  trend: ReactNode;
  note: string;
  spark?: number[] | undefined;
  sparkColor?: string | undefined;
  meter?: { value: number; label: string } | undefined;
  finance?: boolean | undefined;
  /** לאן הכרטיס מוביל */
  link?: "bookings" | "pending" | "calendar" | undefined;
}

export function KpiGrid({ data, period }: { data: DashboardOverview; period: PeriodKey }) {
  const c = data.current;
  const d = deltas(c, data.previous);
  const cmp = data.previous ? compareText(period) : "אין נתונים לתקופה הקודמת";
  const series = data.series;
  const spark = (pick: (p: (typeof series)[number]) => number | null) =>
    series.length > 1 ? series.map((p) => pick(p) ?? 0) : undefined;
  const share = collectedShare(c);

  const items: Kpi[] = [
    {
      key: "bookings",
      label: "הזמנות חדשות",
      value: formatNumber(c.bookings),
      icon: CalendarCheck,
      tone: "brand",
      trend: <TrendBadge value={d.bookings} />,
      note: c.cancellations ? `${cmp} · ${c.cancellations} בוטלו` : cmp,
      spark: spark((p) => p.bookings),
      sparkColor: "var(--hm-lagoon-700)",
      link: "bookings",
    },
  ];
  if (data.finance) {
    items.push(
      {
        key: "revenue",
        label: "הכנסות מאירוח",
        value: formatMoney(c.revenue ?? 0, data.currency),
        icon: WalletCards,
        tone: "champagne",
        trend: <TrendBadge value={d.revenue} />,
        note: c.adr
          ? `לילות בתקופה, אחרי הנחות · ממוצע ${formatMoney(Math.round(c.adr), data.currency)} ללילה`
          : "לילות בתקופה, אחרי הנחות",
        spark: spark((p) => p.revenue),
        sparkColor: "var(--hm-champagne-600)",
        finance: true,
      },
      {
        key: "collected",
        label: "גבייה בפועל",
        value: formatMoney(c.collected ?? 0, data.currency),
        icon: Banknote,
        tone: "success",
        trend: <TrendBadge value={d.collected} />,
        note: share === null ? "תשלומים שנרשמו בתקופה, בניכוי החזרים" : `${share}% מההכנסות נגבו`,
        meter: share === null ? undefined : { value: share, label: "חלק ההכנסות שנגבה" },
        finance: true,
      },
    );
  } else {
    items.push({
      key: "nights",
      label: "לילות שנמכרו",
      value: formatNumber(c.nights_sold),
      icon: BedDouble,
      tone: "champagne",
      trend: null,
      note: "לילות הזמנה בתוך התקופה",
    });
  }
  items.push(
    {
      key: "occupancy",
      label: "תפוסה",
      value: c.occupancy === null ? "—" : `${Math.round(c.occupancy)}%`,
      icon: ChartPie,
      tone: "info",
      trend: <TrendBadge value={d.occupancy} unit="pp" />,
      note:
        c.channel_nights > 0
          ? `כולל ${formatNumber(c.channel_nights)} לילות מ-Airbnb / Booking`
          : "כולל Airbnb ו-Booking",
      spark: spark((p) => p.occupancy),
      sparkColor: "var(--hm-info)",
      link: "calendar",
    },
    {
      key: "pending",
      label: "ממתינות לאישור",
      value: formatNumber(data.pending.count),
      icon: Clock,
      tone: data.pending.count ? "warning" : "neutral",
      trend: (
        <StatusPill tone={data.pending.count ? "warning" : "neutral"} dot={false}>
          עכשיו
        </StatusPill>
      ),
      note: data.pending.next_expiry
        ? `הקרובה פוקעת ${dueText(data.pending.next_expiry)}`
        : "אין בקשות שמחכות",
      link: "pending",
    },
  );

  return (
    <ul
      className={cn(
        "grid gap-3 sm:grid-cols-2",
        items.length === 5 ? "xl:grid-cols-5" : "xl:grid-cols-4",
      )}
      aria-label="המספרים של התקופה"
    >
      {items.map((k, i) => (
        <li key={k.key} data-kpi={k.key} data-rise="" style={{ animationDelay: `${i * 40}ms` }}>
          <KpiCard k={k} />
        </li>
      ))}
    </ul>
  );
}

function KpiCard({ k }: { k: Kpi }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2.5 text-[13px] font-semibold text-[var(--hm-ink-2)]">
          <IconTile icon={k.icon} tone={k.tone} size="sm" />
          {k.label}
        </span>
        {k.finance && (
          <span className="rounded-full bg-[var(--hm-champagne-100)] px-2 py-0.5 text-[11px] font-semibold text-[var(--hm-champagne-700)]">
            כספי
          </span>
        )}
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p
            className="text-[1.75rem] leading-none font-bold tracking-tight text-[var(--hm-lagoon-900)]"
            data-num=""
          >
            {k.value}
          </p>
          <div className="mt-2 min-h-6">{k.trend}</div>
        </div>
        {k.spark && <Sparkline values={k.spark} color={k.sparkColor} className="mb-1" />}
      </div>
      {k.meter && (
        <MeterBar value={k.meter.value} label={k.meter.label} tone="success" className="mt-3" />
      )}
      <p className="mt-2 text-xs text-muted-foreground">{k.note}</p>
    </>
  );
  const cls =
    "flex h-full flex-col rounded-2xl border bg-card p-4 shadow-[var(--hm-shadow-card)] sm:p-5";
  if (!k.link) return <div className={cls}>{body}</div>;
  const linkCls = cn(
    cls,
    "transition-shadow hover:shadow-[var(--hm-shadow-lift)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hm-lagoon-500)]",
  );
  if (k.link === "pending")
    return (
      <Link to="/manage/bookings" search={{ tab: "pending" }} data-lift="" className={linkCls}>
        {body}
      </Link>
    );
  return (
    <Link
      to={k.link === "calendar" ? "/manage/calendar" : "/manage/bookings"}
      data-lift=""
      className={linkCls}
    >
      {body}
    </Link>
  );
}
