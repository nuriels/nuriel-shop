// הגרף של לוח הבקרה (שלב F3): הכנסות (רק עם הרשאה כספית) / הזמנות / תפוסה, לפי יום / שבוע /
// חודש, עם התקופה הקודמת בקו מקווקו. SVG משלנו (בלי ספרייה), מראה ב-RTL: הזמן רץ מימין לשמאל.
// נגישות: לשוניות עם role="tab", תיאור הגרף, וטבלת נתונים לקוראי מסך.
import { useId, useMemo, useState } from "react";
import { cn } from "@/platform/ui";
import type { DashboardOverview } from "../../types/dashboard";
import { formatMoney, formatNumber } from "../lib/format";
import { SectionCard } from "../ui/kit";
import { CHART_H, CHART_W, type ChartMetric, chartGeometry } from "./chart";

const TITLES: Record<ChartMetric, { title: string; sub: string; tab: string }> = {
  revenue: { title: "הכנסות מאירוח", sub: "לפי לילות האירוח בתקופה, אחרי הנחות", tab: "הכנסות" },
  bookings: { title: "הזמנות חדשות", sub: "לפי תאריך יצירת ההזמנה", tab: "הזמנות" },
  occupancy: {
    title: "תפוסה",
    sub: "לילות תפוסים מתוך הזמינים, כולל Airbnb ו-Booking",
    tab: "תפוסה",
  },
};

const BUCKET_TEXT = { day: "לפי יום", week: "לפי שבוע", month: "לפי חודש" } as const;

export function TrendChart({
  data,
  periodLabel,
}: {
  data: DashboardOverview;
  periodLabel: string;
}) {
  const metrics: ChartMetric[] = data.finance
    ? ["revenue", "bookings", "occupancy"]
    : ["bookings", "occupancy"];
  const [picked, setPicked] = useState<ChartMetric>(metrics[0]!);
  const metric = metrics.includes(picked) ? picked : metrics[0]!;
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const g = useMemo(
    () =>
      chartGeometry(data.series, data.previous_series, metric, data.period.bucket, data.currency),
    [data, metric],
  );
  const fmt = (v: number | null) =>
    v === null
      ? "—"
      : metric === "revenue"
        ? formatMoney(Math.round(v), data.currency)
        : metric === "occupancy"
          ? `${Math.round(v)}%`
          : formatNumber(v);
  const t = TITLES[metric];
  const total =
    metric === "occupancy"
      ? data.current.occupancy === null
        ? "—"
        : `${Math.round(data.current.occupancy)}%`
      : metric === "revenue"
        ? formatMoney(g.total ?? 0, data.currency)
        : `${formatNumber(g.total ?? 0)} הזמנות`;
  const hp = hover === null ? null : g.points[hover];

  return (
    <SectionCard
      title={t.title}
      description={`${t.sub} · ${BUCKET_TEXT[data.period.bucket]}`}
      actions={
        <div
          role="tablist"
          aria-label="מה מוצג בגרף"
          className="flex rounded-[10px] bg-[var(--hm-surface-2)] p-1"
        >
          {metrics.map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              id={`${id}-tab-${m}`}
              aria-selected={m === metric}
              aria-controls={`${id}-panel`}
              onClick={() => {
                setPicked(m);
                setHover(null);
              }}
              className={cn(
                "min-h-9 rounded-lg px-3 text-[13px] transition-colors",
                m === metric
                  ? "bg-card font-bold text-[var(--hm-lagoon-900)] shadow-sm"
                  : "font-medium text-muted-foreground hover:text-foreground",
              )}
            >
              {TITLES[m].tab}
            </button>
          ))}
        </div>
      }
    >
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${metric}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-2xl font-bold text-[var(--hm-lagoon-900)]" data-num="">
            {total}
          </p>
          <ul className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn(
                  "inline-block h-2.5 w-4 rounded-sm",
                  metric === "revenue"
                    ? "bg-[var(--hm-champagne-600)]"
                    : metric === "occupancy"
                      ? "bg-[var(--hm-info)]"
                      : "bg-[var(--hm-lagoon-700)]",
                )}
              />
              {periodLabel}
            </li>
            {g.prevLine && (
              <li className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="inline-block w-4 border-t-2 border-dashed border-[#9aa6a3]"
                />
                התקופה הקודמת
              </li>
            )}
          </ul>
        </div>

        {g.empty ? (
          <p className="mt-6 rounded-xl bg-[var(--hm-surface-2)] px-4 py-10 text-center text-sm text-muted-foreground">
            {metric === "bookings"
              ? "לא נוצרו הזמנות בתקופה הזו."
              : metric === "revenue"
                ? "אין הכנסות מלילות אירוח בתקופה הזו."
                : "אין לילות תפוסים בתקופה הזו."}
          </p>
        ) : (
          <figure className="mt-4">
            <figcaption className="sr-only">
              {t.title} — {periodLabel}, {BUCKET_TEXT[data.period.bucket]}. הנתונים בטבלה שאחרי
              הגרף.
            </figcaption>
            <div className="grid grid-cols-[auto_1fr] gap-x-2">
              {/* ציר Y — בתחילת השורה (ימין) */}
              <div aria-hidden="true" className="relative w-12 text-[11px] text-muted-foreground">
                {g.yTicks.map((y) => (
                  <span
                    key={y.label + y.y}
                    className="absolute end-0 -translate-y-1/2 whitespace-nowrap"
                    style={{ top: `${(y.y / CHART_H) * 100}%` }}
                    data-num=""
                  >
                    {y.label}
                  </span>
                ))}
              </div>
              <div className="relative">
                <svg
                  viewBox={`0 0 ${CHART_W} ${CHART_H}`}
                  preserveAspectRatio="none"
                  className="block h-52 w-full overflow-visible sm:h-60"
                  aria-hidden="true"
                  onMouseLeave={() => setHover(null)}
                  onMouseMove={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    const x = ((e.clientX - r.left) / r.width) * CHART_W;
                    let best = 0;
                    g.points.forEach((p, i) => {
                      if (Math.abs(p.x - x) < Math.abs(g.points[best]!.x - x)) best = i;
                    });
                    setHover(best);
                  }}
                >
                  <defs>
                    <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor={metric === "revenue" ? "#b8935a" : "#1f4e8c"}
                        stopOpacity="0.22"
                      />
                      <stop
                        offset="100%"
                        stopColor={metric === "revenue" ? "#b8935a" : "#1f4e8c"}
                        stopOpacity="0"
                      />
                    </linearGradient>
                  </defs>
                  {g.yTicks.map((y) => (
                    <line
                      key={y.y}
                      x1={0}
                      x2={CHART_W}
                      y1={y.y}
                      y2={y.y}
                      stroke="#efeae2"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                  {g.bars.map((b, i) => (
                    <rect
                      key={i}
                      x={b.x}
                      y={b.y}
                      width={b.w}
                      height={Math.max(0, b.h)}
                      rx={3}
                      fill={hover === i ? "#1f6f6b" : "#0e3b3a"}
                    />
                  ))}
                  {g.area && <path d={g.area} fill={`url(#${id}-fill)`} />}
                  {g.prevLine && (
                    <path
                      d={g.prevLine}
                      fill="none"
                      stroke="#9aa6a3"
                      strokeWidth={2}
                      strokeDasharray="6 5"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {g.line && (
                    <path
                      d={g.line}
                      fill="none"
                      stroke={metric === "revenue" ? "#b8935a" : "#1f4e8c"}
                      strokeWidth={2.5}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {hp && (
                    <line
                      x1={hp.x}
                      x2={hp.x}
                      y1={0}
                      y2={CHART_H}
                      stroke="#0c302f"
                      strokeOpacity={0.25}
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {g.points.length === 1 && g.line && (
                    <circle cx={g.points[0]!.x} cy={g.points[0]!.y} r={5} fill="#1f4e8c" />
                  )}
                </svg>
                {hp && (
                  <div
                    className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 rounded-lg border bg-card px-2.5 py-1.5 text-xs whitespace-nowrap shadow-[var(--hm-shadow-lift)]"
                    style={{ left: `${Math.min(88, Math.max(12, (hp.x / CHART_W) * 100))}%` }}
                  >
                    <p className="font-semibold">{hp.longLabel}</p>
                    <p data-num="">{fmt(hp.value)}</p>
                    {hp.previous !== null && (
                      <p className="text-muted-foreground" data-num="">
                        קודם: {fmt(hp.previous)}
                      </p>
                    )}
                  </div>
                )}
                <div
                  aria-hidden="true"
                  className="relative mt-1 h-5 text-[11px] text-muted-foreground"
                >
                  {g.xLabels.map((x) => (
                    <span
                      key={x.left}
                      className="absolute -translate-x-1/2 whitespace-nowrap"
                      style={{ left: `${x.left}%` }}
                      data-num=""
                    >
                      {x.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </figure>
        )}
        <table className="sr-only">
          <caption>
            {t.title} — {periodLabel}
          </caption>
          <thead>
            <tr>
              <th scope="col">תקופה</th>
              <th scope="col">{t.tab}</th>
              {data.previous_series && <th scope="col">התקופה הקודמת</th>}
            </tr>
          </thead>
          <tbody>
            {g.points.map((p) => (
              <tr key={p.longLabel}>
                <th scope="row">{p.longLabel}</th>
                <td>{fmt(p.value)}</td>
                {data.previous_series && <td>{fmt(p.previous)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
