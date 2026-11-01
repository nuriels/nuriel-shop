// לוח הבקרה — "היום בעסק" (2k): הגעות ועזיבות היום, שוהים, בקשות ממתינות ובקשות ביטול,
// תפוסה הלילה / 7 / 30 ימים, יחידות פנויות הלילה, הכנסות החודש, מיילים שנכשלו.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/platform/ui";
import { hospitalityDashboard } from "../../api/emails.functions";
import { manageKeys } from "../lib/query-keys";
import { money } from "../pricing/model";

export function TodayCard() {
  const query = useQuery({
    queryKey: [...manageKeys.all, "dashboard"],
    queryFn: () => hospitalityDashboard(),
    refetchInterval: 60_000,
  });
  const d = query.data;
  if (!d) return null;
  const free = Math.max(0, d.units - d.occupied_tonight - d.blocked_tonight);
  const tiles: {
    label: string;
    value: string;
    warn?: boolean;
    to?: "/manage/bookings" | "/manage/emails" | "/manage/calendar";
  }[] = [
    { label: "מגיעים היום", value: String(d.arrivals_today), to: "/manage/calendar" },
    { label: "עוזבים היום", value: String(d.departures_today), to: "/manage/calendar" },
    { label: "שוהים עכשיו", value: String(d.staying) },
    {
      label: "ממתינות לאישור",
      value: String(d.pending),
      warn: d.pending > 0,
      to: "/manage/bookings",
    },
    ...(d.cancel_requests > 0
      ? [
          {
            label: "בקשות ביטול",
            value: String(d.cancel_requests),
            warn: true,
            to: "/manage/bookings" as const,
          },
        ]
      : []),
    { label: "פנויות הלילה", value: `${free} מתוך ${d.units}` },
    { label: "תפוסה 7 ימים", value: `${d.occupancy_7}%` },
    { label: "תפוסה 30 ימים", value: `${d.occupancy_30}%` },
    { label: "הכנסות החודש", value: money(d.revenue_month, d.currency) },
    ...(d.failed_emails > 0
      ? [
          {
            label: "מיילים שנכשלו",
            value: String(d.failed_emails),
            warn: true,
            to: "/manage/emails" as const,
          },
        ]
      : []),
  ];
  return (
    <Card data-section="today">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">
          <h2>היום בעסק</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {tiles.map((t) => {
            const body = (
              <>
                <span className="text-xs text-muted-foreground">{t.label}</span>
                <span
                  className={
                    t.warn ? "text-lg font-semibold text-amber-800" : "text-lg font-semibold"
                  }
                >
                  {t.value}
                </span>
              </>
            );
            return (
              <li key={t.label} className="rounded-md border p-3">
                {t.to ? (
                  <Link to={t.to} className="flex flex-col hover:underline">
                    {body}
                  </Link>
                ) : (
                  <div className="flex flex-col">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
