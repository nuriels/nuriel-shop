import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { fetchPickingStats, type PickingStat } from "@/lib/picking";

const monthName = new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" });
const monthShort = new Intl.DateTimeFormat("he-IL", { month: "short" });
const dayShort = new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "numeric" });

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * כמה הזמנות ליקט עובד: החודש הנבחר (עם דפדוף), גרף חודשי (12 חודשים —
 * החודש הכי חזק מודגש) וגרף שבועי (16 שבועות).
 */
export function PickingStats({ userId, title }: { userId?: string; title?: string }) {
  const [stats, setStats] = useState<PickingStat[] | null>(null);
  const [offset, setOffset] = useState(0); // 0 = החודש הנוכחי, 1 = חודש קודם...

  useEffect(() => {
    setStats(null);
    fetchPickingStats(userId)
      .then(setStats)
      .catch(() => setStats([]));
  }, [userId]);

  const months = useMemo(() => {
    const out: { key: string; label: string; orders: number; lines: number; date: Date }[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = monthKey(date);
      const row = stats?.find((s) => s.period === "month" && s.period_start === key);
      out.push({
        key,
        label: monthShort.format(date),
        orders: row?.orders ?? 0,
        lines: row?.lines ?? 0,
        date,
      });
    }
    return out;
  }, [stats]);

  const weeks = useMemo(
    () =>
      (stats ?? [])
        .filter((s) => s.period === "week")
        .map((s) => ({
          key: s.period_start,
          label: dayShort.format(new Date(s.period_start)),
          orders: s.orders,
        })),
    [stats],
  );

  const selected = useMemo(() => {
    const now = new Date();
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const row = stats?.find((s) => s.period === "month" && s.period_start === monthKey(date));
    return { date, orders: row?.orders ?? 0, lines: row?.lines ?? 0 };
  }, [stats, offset]);

  const best = Math.max(0, ...months.map((m) => m.orders));

  if (stats === null) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> טוען נתונים...
      </p>
    );
  }

  return (
    <div className="space-y-4" dir="rtl">
      {title && <h3 className="text-lg font-bold text-foreground">{title}</h3>}

      {/* החודש הנבחר, עם דפדוף */}
      <Card className="shadow-card">
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <Button
            variant="outline"
            size="icon"
            aria-label="חודש קודם"
            disabled={offset >= 23}
            onClick={() => setOffset((o) => o + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
          <div className="text-center">
            <p className="text-sm text-muted-foreground">{monthName.format(selected.date)}</p>
            <p className="numeric text-4xl font-extrabold text-foreground">{selected.orders}</p>
            <p className="text-sm text-muted-foreground">
              הזמנות לוקטו · <span className="numeric">{selected.lines}</span> שורות
            </p>
          </div>
          <Button
            variant="outline"
            size="icon"
            aria-label="חודש הבא"
            disabled={offset === 0}
            onClick={() => setOffset((o) => o - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
        </CardContent>
      </Card>

      {/* גרף חודשי — החודש הכי חזק מודגש */}
      <Card className="shadow-card">
        <CardContent className="p-4">
          <p className="mb-2 text-sm font-semibold text-foreground">
            לפי חודשים (12 אחרונים){best > 0 ? ` · השיא: ${best}` : ""}
          </p>
          <div className="h-48" dir="ltr">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={months} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value: number) => [`${value} הזמנות`, ""]}
                  labelFormatter={(label) => String(label)}
                />
                <Bar dataKey="orders" radius={[6, 6, 0, 0]}>
                  {months.map((m) => (
                    <Cell
                      key={m.key}
                      fill={
                        best > 0 && m.orders === best
                          ? "var(--accent)"
                          : "color-mix(in oklab, var(--primary) 70%, transparent)"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* גרף שבועי */}
      <Card className="shadow-card">
        <CardContent className="p-4">
          <p className="mb-2 text-sm font-semibold text-foreground">לפי שבועות (16 אחרונים)</p>
          {weeks.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              עוד אין ליקוטים בשבועות האחרונים
            </p>
          ) : (
            <div className="h-40" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeks} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value: number) => [`${value} הזמנות`, ""]}
                    labelFormatter={(label) => `שבוע מ-${String(label)}`}
                  />
                  <Bar dataKey="orders" fill="var(--primary)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
