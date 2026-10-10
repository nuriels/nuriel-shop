import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Banknote,
  Calculator,
  ClipboardList,
  Eye,
  Inbox,
  LayoutDashboard,
  Loader2,
  Minus,
  PackageX,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatIls } from "@/lib/catalog";
import {
  formatMoneyTile,
  loadDashboard,
  periodDelta,
  relativeTime,
  shortDay,
  type DashboardData,
  type DashboardDay,
  type Delta,
} from "@/lib/dashboard";
import { ORDER_KIND_LABEL, ORDER_STATUS_BADGE, ORDER_STATUS_LABEL } from "@/lib/orders";
import { cn } from "@/lib/utils";
import { ComplianceAlert } from "@/components/ComplianceAlert";
import {
  ANALYTICS_PERIODS,
  fetchStoreAnalytics,
  type AnalyticsPeriod,
  type StoreAnalytics,
} from "@/lib/analytics";

/** רענון אוטומטי כשהלשונית פתוחה — הסטטוסים ברשימה מתעדכנים לבד */
const REFRESH_MS = 30_000;

/**
 * לוח הבקרה — המסך הראשון של מנהל החנות: ארבע כרטיסיות (הכנסות החודש,
 * הזמנות החודש, הזמנות פתוחות, לקוחות רשומים) ו-5 ההזמנות האחרונות.
 * כל הנתונים בקריאה אחת למסד (admin_dashboard), ומתרעננים כל 30 שניות.
 */
export function AdminDashboard({
  onOpenOrder,
  onOpenTab,
  showCompliance = false,
}: {
  /** "צפה בהזמנה" — מעבר לניהול ההזמנות עם ההזמנה פתוחה */
  onOpenOrder: (orderId: string) => void;
  onOpenTab: (tab: string) => void;
  /** חלק 37: התראת פרטי העסק / תקנון — למי שמנהל את הגדרות החנות */
  showCompliance?: boolean;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    try {
      setData(await loadDashboard());
      setError(null);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "טעינת לוח הבקרה נכשלה");
    } finally {
      busy.current = false;
      setRefreshing(false);
      setNow(new Date());
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, REFRESH_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const updatedAt = data?.generatedAt
    ? new Date(data.generatedAt).toLocaleTimeString("he-IL", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 font-display text-2xl text-foreground">
            <LayoutDashboard className="size-6 text-accent" aria-hidden="true" />
            לוח בקרה
          </h1>
          <p className="text-sm text-muted-foreground">
            {new Date().toLocaleDateString("he-IL", {
              weekday: "long",
              day: "numeric",
              month: "long",
              timeZone: "Asia/Jerusalem",
            })}
            {updatedAt && ` · עודכן ב-${updatedAt}`}
          </p>
        </div>
        <Button variant="outline" onClick={() => void refresh()} disabled={refreshing}>
          <RefreshCw className={cn("size-4", refreshing && "animate-spin")} aria-hidden="true" />
          רענון
        </Button>
      </div>

      {showCompliance && <ComplianceAlert onOpenTab={onOpenTab} />}

      {error && !data ? (
        <Card className="border-destructive/40">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <TriangleAlert className="size-7 text-destructive" aria-hidden="true" />
            <p className="text-sm text-foreground">{error}</p>
            <Button variant="outline" onClick={() => void refresh()}>
              ניסיון נוסף
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ---------- כרטיסיות ---------- */}
          <SalesAnalytics onOpenProducts={() => onOpenTab("stock")} />
          {/* ---------- תפעול ---------- */}
          <div className="grid gap-3 sm:grid-cols-2">
            <StatTile
              icon={Inbox}
              label="הזמנות פתוחות"
              loading={!data}
              value={data ? data.openOrders.total.toLocaleString("he-IL") : ""}
              highlight={(data?.openOrders.total ?? 0) > 0}
              note={
                data
                  ? `${data.openOrders.new} חדשות · ${data.openOrders.awaitingCourier} ממתינות לשליח`
                  : ""
              }
              action={{ label: "לניהול ההזמנות", onClick: () => onOpenTab("orders") }}
            />
            <StatTile
              icon={Users}
              label="לקוחות רשומים"
              loading={!data}
              value={data ? data.customers.total.toLocaleString("he-IL") : ""}
              note={
                data
                  ? [
                      `${data.customers.newMonth} הצטרפו החודש`,
                      data.customers.awaitingApproval > 0
                        ? `${data.customers.awaitingApproval} ממתינים לאישור`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : ""
              }
              action={{ label: "למשתמשים", onClick: () => onOpenTab("users") }}
            />
          </div>

          {/* ---------- 5 ההזמנות האחרונות ---------- */}
          <Card className="overflow-hidden shadow-card">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <h2 className="font-bold text-foreground">הזמנות אחרונות</h2>
              <Button variant="ghost" size="sm" onClick={() => onOpenTab("orders")}>
                לכל ההזמנות
                <ArrowLeft className="size-4" aria-hidden="true" />
              </Button>
            </div>
            {!data ? (
              <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" /> טוען…
              </p>
            ) : data.recent.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                עוד לא התקבלו הזמנות בחנות.
              </p>
            ) : (
              <RecentOrders orders={data.recent} now={now} onOpenOrder={onOpenOrder} />
            )}
          </Card>
          {error && data && <p className="text-xs text-destructive">הרענון האחרון נכשל: {error}</p>}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// כרטיסייה
// ------------------------------------------------------------

function StatTile({
  icon: Icon,
  label,
  value,
  loading,
  delta,
  deltaContext,
  note,
  trend,
  trendValue,
  highlight = false,
  action,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  loading: boolean;
  delta?: Delta | null;
  deltaContext?: string;
  note?: string;
  trend?: DashboardDay[] | undefined;
  trendValue?: "revenue" | "orders";
  highlight?: boolean;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <Card className={cn("shadow-card", highlight && "border-accent/60")}>
      <CardContent className="flex h-full flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-lg",
              highlight ? "bg-accent/15 text-accent" : "bg-secondary text-foreground/70",
            )}
          >
            <Icon className="size-[18px]" aria-hidden="true" />
          </span>
        </div>
        {loading ? (
          <div className="space-y-2" aria-hidden="true">
            <div className="h-8 w-28 animate-pulse rounded bg-secondary" />
            <div className="h-3 w-36 animate-pulse rounded bg-secondary" />
          </div>
        ) : (
          <>
            <p className="text-3xl font-semibold leading-none text-foreground">{value}</p>
            {delta && <DeltaLine delta={delta} context={deltaContext ?? ""} />}
            {note && <p className="text-xs text-muted-foreground">{note}</p>}
          </>
        )}
        {trend && trend.length > 1 && trendValue && (
          <Sparkline days={trend} valueKey={trendValue} label={label} />
        )}
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-auto inline-flex items-center gap-1 self-start rounded text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {action.label}
            <ArrowLeft className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </CardContent>
    </Card>
  );
}

/** השינוי מול החודש הקודם: חץ + אחוז + מול מה (לא רק צבע) */
function DeltaLine({ delta, context }: { delta: Delta; context: string }) {
  if (delta.percent === null) {
    return (
      <p className="text-xs text-muted-foreground">
        {delta.direction === "up" ? "אין נתון להשוואה" : "—"} {context}
      </p>
    );
  }
  const Icon =
    delta.direction === "up" ? TrendingUp : delta.direction === "down" ? TrendingDown : Minus;
  const tone =
    delta.direction === "up"
      ? "text-emerald-700 dark:text-emerald-400"
      : delta.direction === "down"
        ? "text-red-700 dark:text-red-400"
        : "text-muted-foreground";
  const sign = delta.percent > 0 ? "+" : "";
  return (
    <p className="flex flex-wrap items-center gap-1 text-xs">
      <span className={cn("inline-flex items-center gap-0.5 font-semibold", tone)}>
        <Icon className="size-3.5" aria-hidden="true" />
        <span dir="ltr">
          {sign}
          {delta.percent}%
        </span>
      </span>
      <span className="text-muted-foreground">{context}</span>
    </p>
  );
}

// ------------------------------------------------------------
// גרף קטן: 14 ימים, היום מודגש, ריחוף = הערך של אותו יום
// ------------------------------------------------------------

const SPARK_W = 280;
const SPARK_H = 44;
const SPARK_PAD = 4;

function Sparkline({
  days,
  valueKey,
  label,
}: {
  days: DashboardDay[];
  valueKey: "revenue" | "orders";
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const values = days.map((day) => day[valueKey]);
  const max = Math.max(...values, 0);
  const stepX = (SPARK_W - SPARK_PAD * 2) / (days.length - 1);
  const x = (i: number) => SPARK_PAD + i * stepX;
  // המקסימום בראש, 0 בתחתית
  const y = (v: number) =>
    max === 0 ? SPARK_H - SPARK_PAD : SPARK_H - SPARK_PAD - (v / max) * (SPARK_H - SPARK_PAD * 2);
  // בעברית הזמן זורם מימין לשמאל: היום הראשון בימין, היום בשמאל
  const px = (i: number) => SPARK_W - x(i);
  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${px(i)},${y(v)}`).join(" ");
  const area = `${line} L${px(values.length - 1)},${SPARK_H - SPARK_PAD} L${px(0)},${SPARK_H - SPARK_PAD} Z`;
  const last = values.length - 1;
  const shown = hover ?? last;
  const shownDay = days[shown];
  const format = (v: number) =>
    valueKey === "revenue" ? formatIls(v) : `${v.toLocaleString("he-IL")} הזמנות`;

  return (
    <figure className="mt-1 space-y-1">
      <div className="relative">
        <svg
          viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
          className="h-11 w-full overflow-visible"
          role="img"
          aria-label={`${label} — 14 הימים האחרונים`}
          onMouseLeave={() => setHover(null)}
        >
          <path d={area} className="fill-primary/[0.07]" />
          <path
            d={line}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            className="stroke-muted-foreground/45"
          />
          {hover !== null && (
            <line
              x1={px(hover)}
              x2={px(hover)}
              y1={SPARK_PAD}
              y2={SPARK_H - SPARK_PAD}
              className="stroke-border"
              strokeWidth={1}
            />
          )}
          <circle
            cx={px(shown)}
            cy={y(values[shown] ?? 0)}
            r={4}
            className="fill-accent stroke-card"
            strokeWidth={2}
          />
          {/* אזורי ריחוף רחבים מהנקודה עצמה */}
          {days.map((day, i) => (
            <rect
              key={day.day}
              x={px(i) - stepX / 2}
              y={0}
              width={stepX}
              height={SPARK_H}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            >
              <title>{`${shortDay(day.day)} · ${format(day[valueKey])}`}</title>
            </rect>
          ))}
        </svg>
      </div>
      <figcaption className="text-[11px] text-muted-foreground">
        {shownDay && (
          <>
            {hover === null ? "היום" : shortDay(shownDay.day)}:{" "}
            <span className="font-semibold text-foreground">{format(shownDay[valueKey])}</span>
            {hover === null && " · 14 ימים אחרונים"}
          </>
        )}
      </figcaption>
    </figure>
  );
}

// ------------------------------------------------------------
// 5 ההזמנות האחרונות
// ------------------------------------------------------------

function RecentOrders({
  orders,
  now,
  onOpenOrder,
}: {
  orders: DashboardData["recent"];
  now: Date;
  onOpenOrder: (orderId: string) => void;
}) {
  return (
    <>
      {/* מחשב: טבלה (רוחב עמודות קבוע — השם הארוך מתקצר, הכפתור תמיד גלוי) */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[46rem] table-fixed text-sm">
          <colgroup>
            <col className="w-[8.5rem]" />
            <col />
            <col className="w-[7.5rem]" />
            <col className="w-[7rem]" />
            <col className="w-[11.5rem]" />
            <col className="w-[9.5rem]" />
          </colgroup>
          <thead className="bg-secondary/50 text-xs text-muted-foreground">
            <tr>
              <Th>מספר הזמנה</Th>
              <Th>לקוח</Th>
              <Th>התקבלה</Th>
              <Th className="text-end">סכום</Th>
              <Th>סטטוס</Th>
              <Th>
                <span className="sr-only">פעולות</span>
              </Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {orders.map((order) => (
              <tr key={order.id} className="transition-colors hover:bg-secondary/30">
                <td className="px-4 py-3">
                  <span dir="ltr" className="font-semibold tabular-nums text-foreground">
                    {order.order_number}
                  </span>
                  {order.kind === "quote" && (
                    <span className="block text-xs text-muted-foreground">הצעת מחיר</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className="block truncate text-foreground" title={order.customer_name}>
                    {order.customer_name}
                  </span>
                  {order.is_guest && <span className="text-xs text-muted-foreground">אורח</span>}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                  {relativeTime(order.created_at, now)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-end font-semibold tabular-nums">
                  {order.kind === "quote" ? (
                    <span className="font-normal text-muted-foreground">—</span>
                  ) : (
                    formatIls(order.gross)
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge order={order} />
                </td>
                <td className="px-4 py-3 text-end">
                  <Button size="sm" variant="outline" onClick={() => onOpenOrder(order.id)}>
                    <Eye className="size-4" aria-hidden="true" />
                    צפה בהזמנה
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* טלפון: שורות קומפקטיות */}
      <ul className="divide-y divide-border md:hidden">
        {orders.map((order) => (
          <li key={order.id} className="space-y-2 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p dir="ltr" className="text-right font-semibold tabular-nums text-foreground">
                  {order.order_number}
                </p>
                <p className="truncate text-sm text-foreground">
                  {order.customer_name}
                  {order.is_guest && <span className="text-xs text-muted-foreground"> · אורח</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {relativeTime(order.created_at, now)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="font-semibold tabular-nums">
                  {order.kind === "quote" ? ORDER_KIND_LABEL.quote : formatIls(order.gross)}
                </span>
                <StatusBadge order={order} />
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => onOpenOrder(order.id)}
            >
              <Eye className="size-4" aria-hidden="true" />
              צפה בהזמנה
            </Button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th scope="col" className={cn("px-4 py-2.5 text-start font-medium", className)}>
      {children}
    </th>
  );
}

function StatusBadge({ order }: { order: DashboardData["recent"][number] }) {
  // משלוח שנכשל — שורה קטנה מתחת לתג (התג עצמו נשאר קצר)
  const failed = order.status === "awaiting_courier" && order.delivery_attempts > 0;
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <Badge variant={ORDER_STATUS_BADGE[order.status]} className="whitespace-nowrap">
        {ORDER_STATUS_LABEL[order.status]}
      </Badge>
      {failed && (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-800 dark:text-amber-300">
          <TriangleAlert className="size-3" aria-hidden="true" />
          משלוח נכשל — ניסיון {order.delivery_attempts}
        </span>
      )}
    </span>
  );
}

/**
 * חלק 26: "ביצועי מכירות" — טווח (החודש / החודש שעבר / השנה), הכנסות ששולמו, הזמנות,
 * ממוצע להזמנה (עם שינוי מול התקופה המקבילה), הנמכרים ביותר והתראות מלאי.
 * הנתונים מ-GET /api/admin/analytics (store_analytics במסד).
 */
function SalesAnalytics({ onOpenProducts }: { onOpenProducts: () => void }) {
  const [period, setPeriod] = useState<AnalyticsPeriod>("month");
  const [data, setData] = useState<StoreAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    fetchStoreAnalytics(period)
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((loadError: unknown) => {
        if (alive) setError(loadError instanceof Error ? loadError.message : "טעינת הנתונים נכשלה");
      });
    return () => {
      alive = false;
    };
  }, [period]);
  const context = ANALYTICS_PERIODS.find((p) => p.value === period)?.context ?? "";
  return (
    <section aria-labelledby="sales-title" className="space-y-3" data-sales-analytics="">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="sales-title" className="font-bold text-foreground">
          ביצועי מכירות
        </h2>
        <div role="radiogroup" aria-label="טווח זמן" className="flex rounded-lg bg-secondary p-1">
          {ANALYTICS_PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              role="radio"
              aria-checked={period === p.value}
              onClick={() => setPeriod(p.value)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                period === p.value
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          {error}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          icon={Banknote}
          label="הכנסות (שולמו)"
          loading={!data && !error}
          value={data ? formatMoneyTile(data.revenue) : ""}
          delta={data ? periodDelta(data.revenue, data.prev.revenue) : null}
          deltaContext={context}
          note="ביט ששולמו, ותשלום במקום שנמסר · כולל מע״מ ומשלוח"
          trend={data?.series}
          trendValue="revenue"
        />
        <StatTile
          icon={ClipboardList}
          label="הזמנות"
          loading={!data && !error}
          value={data ? data.orders.toLocaleString("he-IL") : ""}
          delta={data ? periodDelta(data.orders, data.prev.orders) : null}
          deltaContext={context}
          note={data ? `מתוכן ${data.paidOrders.toLocaleString("he-IL")} שולמו · בלי מבוטלות` : ""}
          trend={data?.series}
          trendValue="orders"
        />
        <StatTile
          icon={Calculator}
          label="ממוצע להזמנה"
          loading={!data && !error}
          value={data ? formatMoneyTile(data.aov) : ""}
          delta={data ? periodDelta(data.aov, data.prev.aov) : null}
          deltaContext={context}
          note="הכנסות חלקי הזמנות ששולמו"
        />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="shadow-card" data-top-products="">
          <CardContent className="space-y-3 p-4">
            <h3 className="flex items-center gap-2 font-bold text-foreground">
              <Trophy className="size-4 text-accent" aria-hidden="true" />
              הנמכרים ביותר
            </h3>
            {!data ? (
              <p className="text-sm text-muted-foreground">{error ? "—" : "טוען…"}</p>
            ) : data.topProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground">עוד אין מכירות ששולמו בתקופה הזו</p>
            ) : (
              <ol className="space-y-2">
                {data.topProducts.map((product, index) => (
                  <li
                    key={product.productId}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="numeric flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold">
                        {index + 1}
                      </span>
                      <span className="truncate font-medium">{product.name}</span>
                    </span>
                    <span className="numeric shrink-0 text-muted-foreground">
                      {product.units.toLocaleString("he-IL")} יח׳
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
        <Card className="shadow-card" data-stock-alerts="">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 font-bold text-foreground">
                <PackageX className="size-4 text-destructive" aria-hidden="true" />
                התראות מלאי
                {data && data.stockAlertsTotal > 0 && (
                  <Badge variant="destructive" className="numeric">
                    {data.stockAlertsTotal}
                  </Badge>
                )}
              </h3>
              <Button variant="ghost" size="sm" onClick={onOpenProducts}>
                למסך המלאי
              </Button>
            </div>
            {!data ? (
              <p className="text-sm text-muted-foreground">{error ? "—" : "טוען…"}</p>
            ) : data.stockAlerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">אין מוצרים עם 3 יחידות או פחות 👌</p>
            ) : (
              <ul className="space-y-2">
                {data.stockAlerts.map((alert) => (
                  <li
                    key={`${alert.productId}-${alert.variant ?? ""}`}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0 truncate font-medium">
                      {alert.name}
                      {alert.variant && (
                        <span className="text-muted-foreground"> · {alert.variant}</span>
                      )}
                    </span>
                    <Badge
                      variant={alert.stock <= 0 ? "destructive" : "secondary"}
                      className="numeric shrink-0"
                    >
                      {alert.stock <= 0 ? "אזל" : `${alert.stock} יח׳`}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            {data && data.stockAlertsTotal > data.stockAlerts.length && (
              <p className="text-xs text-muted-foreground">
                ועוד {data.stockAlertsTotal - data.stockAlerts.length} מוצרים במלאי נמוך
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
