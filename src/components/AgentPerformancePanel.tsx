import { staffName } from "@/lib/staff";
import { useCallback, useEffect, useMemo, useState } from "react";
import { WarehousePerformance } from "@/components/WarehousePerformance";
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";
import {
  Briefcase,
  CircleHelp,
  RefreshCw,
  ShieldCheck,
  Sigma,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { GroupSidebarLayout, type SideGroup } from "@/components/GroupSidebarLayout";
import { PeriodPicker } from "@/components/PeriodPicker";
import { currentPeriod, monthName, periodLabel, previousPeriod, type Period } from "@/lib/period";
import { formatIls } from "@/lib/catalog";
import { cn } from "@/lib/utils";

type StatRow = { agent_id: string | null; month: number; orders: number; revenue: number };
type Staff = {
  user_id: string;
  /** השם המלא בעברית, ואם אין — שם המשתמש */
  label: string;
  /** שם המשתמש במערכת (מוצג מתחת לשם בעברית) */
  username: string | null;
  role: "agent" | "admin";
  agentNumber: string | null;
};
type Totals = { orders: number; revenue: number };

/** "total" = כל הצוות, "none" = הזמנות בלי מטפל, אחרת user_id */
type Selection = string;
const TOTAL = "total";
const NONE = "none";

const chartConfig: ChartConfig = {
  revenue: { label: "סכום", color: "var(--accent)" },
};

function sum(rows: StatRow[]): Totals {
  return rows.reduce(
    (acc, row) => ({
      orders: acc.orders + Number(row.orders),
      revenue: acc.revenue + Number(row.revenue),
    }),
    { orders: 0, revenue: 0 },
  );
}

function average(t: Totals): number {
  return t.orders > 0 ? t.revenue / t.orders : 0;
}

function matches(row: StatRow, who: Selection): boolean {
  if (who === TOTAL) return true;
  if (who === NONE) return row.agent_id === null;
  return row.agent_id === who;
}

/** שינוי באחוזים לעומת התקופה הקודמת; null כשאין בסיס להשוואה */
function change(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function Kpi({
  label,
  value,
  delta,
  compareLabel,
}: {
  label: string;
  value: string;
  delta: number | null;
  compareLabel: string;
}) {
  const up = delta !== null && delta >= 0;
  return (
    <Card className="shadow-card">
      <CardContent className="space-y-1 p-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="numeric text-2xl font-bold text-foreground">{value}</p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          {delta === null ? (
            <span>אין נתונים ב{compareLabel} להשוואה</span>
          ) : (
            <>
              {up ? (
                <TrendingUp className="size-3.5 text-accent" />
              ) : (
                <TrendingDown className="size-3.5 text-destructive" />
              )}
              <span
                className={cn("numeric font-semibold", up ? "text-accent" : "text-destructive")}
              >
                {up ? "+" : ""}
                {delta.toFixed(0)}%
              </span>
              <span>לעומת {compareLabel}</span>
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * ביצועי צוות: סרגל בצד ימין עם כל סוכן ומנהל (אוטומטית לפי התפקיד),
 * "ללא טיפול משויך" ושורה אחרונה "סה"כ של כולם". לכל אחד: מספר הזמנות,
 * סכום וממוצע להזמנה בתקופה, השוואה לתקופה הקודמת, גרף חודשי של השנה,
 * וסיכומים שנתיים לשנים קודמות. הסכומים מחושבים במסד (handler_monthly_stats).
 */
export function AgentPerformancePanel() {
  const [period, setPeriod] = useState<Period>(currentPeriod());
  const [selected, setSelected] = useState<Selection>(TOTAL);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [statsByYear, setStatsByYear] = useState<Map<number, StatRow[]>>(new Map());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [rolesResult, yearsResult] = await Promise.all([
      supabase
        .from("user_roles")
        .select("user_id, email, username, role, agent_number, display_name"),
      supabase.rpc("order_activity_years"),
    ]);
    if (yearsResult.error) toast.error(yearsResult.error.message);

    type RoleRow = {
      user_id: string;
      email: string;
      username: string | null;
      role: string;
      agent_number: string | null;
      display_name: string | null;
    };
    const people = ((rolesResult.data ?? []) as RoleRow[])
      .filter((r) => r.role === "agent" || r.role === "admin")
      .map((r): Staff => ({
        user_id: r.user_id,
        label: staffName(r),
        username: r.display_name?.trim() ? r.username || r.email : null,
        role: r.role as "agent" | "admin",
        agentNumber: r.agent_number,
      }))
      .sort(
        (a, b) =>
          (a.agentNumber ?? "~").localeCompare(b.agentNumber ?? "~") ||
          a.label.localeCompare(b.label, "he"),
      );
    setStaff(people);

    const thisYear = currentPeriod().year;
    const activeYears = [
      ...new Set([thisYear, ...(yearsResult.data ?? []).map((y) => Number(y.year))]),
    ].sort((a, b) => b - a);
    setYears(activeYears);

    // כל שנה = קריאה אחת מסוכמת (לכל היותר מטפלים × 12 שורות)
    const perYear = await Promise.all(
      activeYears.map(async (year) => {
        const { data, error } = await supabase.rpc("handler_monthly_stats", { _year: year });
        if (error) toast.error(error.message);
        return [year, (data ?? []) as StatRow[]] as const;
      }),
    );
    setStatsByYear(new Map(perYear));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rowsIn = useCallback(
    (p: Period, who: Selection) =>
      (statsByYear.get(p.year) ?? []).filter(
        (row) => matches(row, who) && (p.month === null || Number(row.month) === p.month),
      ),
    [statsByYear],
  );

  const prev = previousPeriod(period);
  const current = sum(rowsIn(period, selected));
  const before = sum(rowsIn(prev, selected));
  const compareLabel = periodLabel(prev);

  const hasUnassigned = useMemo(
    () => [...statsByYear.values()].some((rows) => rows.some((r) => r.agent_id === null)),
    [statsByYear],
  );

  // ---------- סרגל הצד ----------
  const agents = staff.filter((s) => s.role === "agent");
  const admins = staff.filter((s) => s.role === "admin");
  const personGroup = (person: Staff, index: number, section: string): SideGroup<Selection> => {
    const t = sum(rowsIn(period, person.user_id));
    return {
      id: person.user_id,
      label: person.agentNumber ? `${person.agentNumber} · ${person.label}` : person.label,
      sublabel: person.username
        ? `${person.username} · ${formatIls(t.revenue)}`
        : formatIls(t.revenue),
      count: t.orders,
      icon: person.role === "admin" ? ShieldCheck : Briefcase,
      ...(index === 0 ? { section } : {}),
    };
  };
  const unassigned = sum(rowsIn(period, NONE));
  const all = sum(rowsIn(period, TOTAL));
  const sideGroups: SideGroup<Selection>[] = [
    ...agents.map((p, i) => personGroup(p, i, "סוכנים")),
    ...admins.map((p, i) => personGroup(p, i, "מנהלים")),
    ...(hasUnassigned
      ? [
          {
            id: NONE,
            label: "ללא טיפול משויך",
            sublabel: formatIls(unassigned.revenue),
            count: unassigned.orders,
            icon: CircleHelp,
            section: "אחר",
          },
        ]
      : []),
    {
      id: TOTAL,
      label: 'סה"כ של כולם',
      sublabel: formatIls(all.revenue),
      count: all.orders,
      icon: Sigma,
      divider: true,
    },
  ];

  const person = staff.find((s) => s.user_id === selected);
  const title =
    selected === TOTAL
      ? 'סה"כ של כולם'
      : selected === NONE
        ? "הזמנות ללא טיפול משויך"
        : person
          ? person.label
          : "עובד";

  // ---------- גרף: 12 חודשי השנה של הנבחר ----------
  const chartData = Array.from({ length: 12 }, (_, i) => {
    const t = sum(rowsIn({ year: period.year, month: i + 1 }, selected));
    return {
      month: i + 1,
      name: monthName(i + 1).slice(0, 3),
      revenue: t.revenue,
      orders: t.orders,
    };
  });

  // ---------- טבלת פירוט ----------
  const breakdown =
    selected === TOTAL
      ? [
          ...staff.map((s) => ({
            key: s.user_id,
            name: s.agentNumber ? `${s.agentNumber} · ${s.label}` : s.label,
            role: s.role === "admin" ? "מנהל" : "סוכן",
            ...sum(rowsIn(period, s.user_id)),
          })),
          { key: NONE, name: "ללא טיפול משויך", role: "", ...unassigned },
        ]
          .filter((r) => r.orders > 0)
          .sort((a, b) => b.revenue - a.revenue)
      : [];

  const monthsWithData = (year: number) =>
    new Set(
      (statsByYear.get(year) ?? [])
        .filter((row) => matches(row, selected) && Number(row.orders) > 0)
        .map((row) => Number(row.month)),
    );

  const thisYear = currentPeriod().year;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl text-foreground">ביצועי סוכנים ועובדים</h2>
          <p className="text-sm text-muted-foreground">
            הזמנות שלא בוטלו (ללא בקשות הצעת מחיר), לפי מי שמטפל בהן
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker
            value={period}
            onChange={setPeriod}
            years={years}
            monthsWithData={monthsWithData}
          />
          <Button variant="outline" size="icon" onClick={() => void load()} aria-label="רענון">
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      <GroupSidebarLayout title="צוות" groups={sideGroups} value={selected} onChange={setSelected}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-xl text-foreground">{title}</h3>
          {person?.username && (
            <span dir="ltr" className="text-sm text-muted-foreground">
              {person.username}
            </span>
          )}
          {person && (
            <Badge variant="secondary">
              {person.role === "admin"
                ? "מנהל"
                : `סוכן${person.agentNumber ? ` ${person.agentNumber}` : ""}`}
            </Badge>
          )}
          <span className="text-sm text-muted-foreground">{periodLabel(period)}</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Kpi
            label="הזמנות"
            value={String(current.orders)}
            delta={change(current.orders, before.orders)}
            compareLabel={compareLabel}
          />
          <Kpi
            label="סכום הזמנות"
            value={formatIls(current.revenue)}
            delta={change(current.revenue, before.revenue)}
            compareLabel={compareLabel}
          />
          <Kpi
            label="ממוצע להזמנה"
            value={formatIls(average(current))}
            delta={change(average(current), average(before))}
            compareLabel={compareLabel}
          />
        </div>

        <Card className="shadow-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              סכום הזמנות לפי חודש, {period.year}
              <span className="ms-2 text-xs font-normal text-muted-foreground">
                לחיצה על עמודה בוחרת את החודש
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-56 w-full">
              <BarChart data={chartData} margin={{ left: 8, right: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} reversed />
                <YAxis
                  orientation="right"
                  width={48}
                  tickFormatter={(v: number) => (v >= 1000 ? `₪${Math.round(v / 1000)}K` : `₪${v}`)}
                  tick={{ fontSize: 10 }}
                />
                <ChartTooltip
                  content={<ChartTooltipContent formatter={(v) => formatIls(Number(v))} />}
                />
                <Bar
                  dataKey="revenue"
                  radius={4}
                  onClick={(entry: { month?: number }) => {
                    if (entry.month) setPeriod({ year: period.year, month: entry.month });
                  }}
                  className="cursor-pointer"
                >
                  {chartData.map((entry) => (
                    <Cell
                      key={entry.month}
                      fill={
                        period.month === null || period.month === entry.month
                          ? "var(--accent)"
                          : "color-mix(in oklab, var(--accent) 35%, transparent)"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        {selected === TOTAL ? (
          <Card className="shadow-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">פירוט לפי עובד, {periodLabel(period)}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-right text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">עובד</th>
                    <th className="px-4 py-2.5 font-medium">הזמנות</th>
                    <th className="px-4 py-2.5 font-medium">סכום</th>
                    <th className="px-4 py-2.5 font-medium">ממוצע להזמנה</th>
                    <th className="px-4 py-2.5 font-medium">חלק מהסה"כ</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        אין הזמנות ב{periodLabel(period)}
                      </td>
                    </tr>
                  ) : (
                    breakdown.map((row) => (
                      <tr
                        key={row.key}
                        className="cursor-pointer border-b border-border/60 hover:bg-secondary/50"
                        onClick={() => setSelected(row.key)}
                      >
                        <td className="px-4 py-2.5">
                          <span className="font-medium text-foreground">{row.name}</span>
                          {row.role && (
                            <span className="ms-2 text-xs text-muted-foreground">{row.role}</span>
                          )}
                        </td>
                        <td className="numeric px-4 py-2.5">{row.orders}</td>
                        <td className="numeric px-4 py-2.5 font-semibold">
                          {formatIls(row.revenue)}
                        </td>
                        <td className="numeric px-4 py-2.5">{formatIls(average(row))}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary">
                              <div
                                className="h-full rounded-full bg-accent"
                                style={{
                                  width: `${all.revenue > 0 ? (row.revenue / all.revenue) * 100 : 0}%`,
                                }}
                              />
                            </div>
                            <span className="numeric text-xs text-muted-foreground">
                              {all.revenue > 0 ? ((row.revenue / all.revenue) * 100).toFixed(0) : 0}
                              %
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {breakdown.length > 0 && (
                  <tfoot>
                    <tr className="bg-secondary/60 font-semibold">
                      <td className="px-4 py-2.5">סה"כ של כולם</td>
                      <td className="numeric px-4 py-2.5">{all.orders}</td>
                      <td className="numeric px-4 py-2.5">{formatIls(all.revenue)}</td>
                      <td className="numeric px-4 py-2.5">{formatIls(average(all))}</td>
                      <td className="px-4 py-2.5">100%</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </CardContent>
          </Card>
        ) : (
          <Card className="shadow-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">פירוט חודשי, {period.year}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[28rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-right text-xs text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">חודש</th>
                    <th className="px-4 py-2.5 font-medium">הזמנות</th>
                    <th className="px-4 py-2.5 font-medium">סכום</th>
                    <th className="px-4 py-2.5 font-medium">ממוצע להזמנה</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData
                    .filter((m) => !(period.year === thisYear && m.month > currentPeriod().month!))
                    .map((m) => (
                      <tr
                        key={m.month}
                        onClick={() => setPeriod({ year: period.year, month: m.month })}
                        className={cn(
                          "cursor-pointer border-b border-border/60 hover:bg-secondary/50",
                          period.month === m.month && "bg-secondary font-semibold",
                        )}
                      >
                        <td className="px-4 py-2">{monthName(m.month)}</td>
                        <td className="numeric px-4 py-2">{m.orders}</td>
                        <td className="numeric px-4 py-2">{formatIls(m.revenue)}</td>
                        <td className="numeric px-4 py-2">
                          {formatIls(m.orders > 0 ? m.revenue / m.orders : 0)}
                        </td>
                      </tr>
                    ))}
                </tbody>
                <tfoot>
                  {(() => {
                    const yearTotal = sum(rowsIn({ year: period.year, month: null }, selected));
                    return (
                      <tr className="bg-secondary/60 font-semibold">
                        <td className="px-4 py-2.5">סה"כ {period.year}</td>
                        <td className="numeric px-4 py-2.5">{yearTotal.orders}</td>
                        <td className="numeric px-4 py-2.5">{formatIls(yearTotal.revenue)}</td>
                        <td className="numeric px-4 py-2.5">{formatIls(average(yearTotal))}</td>
                      </tr>
                    );
                  })()}
                </tfoot>
              </table>
            </CardContent>
          </Card>
        )}

        {/* ---------- סיכומים שנתיים: שורה לכל שנה, נוצרת אוטומטית ---------- */}
        <Card className="shadow-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">סיכומים שנתיים — {title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {years.map((year) => {
              const t = sum(rowsIn({ year, month: null }, selected));
              const active = period.month === null && period.year === year;
              return (
                <button
                  key={year}
                  type="button"
                  onClick={() => setPeriod({ year, month: null })}
                  className={cn(
                    "grid w-full grid-cols-[6rem_1fr_1fr_1fr] items-center gap-2 rounded-lg border px-3 py-2.5 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "border-accent bg-secondary"
                      : "border-border hover:border-accent/60 hover:bg-secondary/40",
                  )}
                >
                  <span className="font-display text-base font-bold text-foreground">
                    {year}
                    {year === thisYear && (
                      <span className="block font-sans text-[11px] font-normal text-muted-foreground">
                        עד היום
                      </span>
                    )}
                  </span>
                  <span>
                    <span className="block text-[11px] text-muted-foreground">הזמנות</span>
                    <span className="numeric font-semibold">{t.orders}</span>
                  </span>
                  <span>
                    <span className="block text-[11px] text-muted-foreground">סכום</span>
                    <span className="numeric font-semibold">{formatIls(t.revenue)}</span>
                  </span>
                  <span>
                    <span className="block text-[11px] text-muted-foreground">ממוצע להזמנה</span>
                    <span className="numeric font-semibold">{formatIls(average(t))}</span>
                  </span>
                </button>
              );
            })}
          </CardContent>
        </Card>
      </GroupSidebarLayout>

      <WarehousePerformance />
    </section>
  );
}
