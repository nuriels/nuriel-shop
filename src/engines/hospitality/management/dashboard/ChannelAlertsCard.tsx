// לוח הבקרה — התראות היומנים החיצוניים (D3): התנגשויות (אירוע ב-Airbnb / Booking.com על תאריכים
// שתפוסים אצלנו — לא נכתב, ושום הזמנה לא שונתה) ויומנים שלא מסתנכרנים. מוצג רק כשיש מה לטפל.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/platform/ui";
import { hospitalityChannels } from "../../api/channels.functions";
import { CHANNEL_LABELS } from "../calendar/model";
import { formatDate } from "../lib/format";
import { manageKeys } from "../lib/query-keys";
import { channelAlerts } from "./channel-alerts";

export function ChannelAlertsCard() {
  const query = useQuery({
    queryKey: [...manageKeys.all, "channels"],
    queryFn: () => hospitalityChannels(),
    staleTime: 60_000,
  });
  const alerts = channelAlerts(query.data ?? []);
  if (!alerts.conflicts.length && !alerts.failing.length) return null;
  return (
    <Card data-section="channel-alerts" className="border-amber-400">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <TriangleAlert className="size-5 text-amber-700" aria-hidden="true" />
          יומנים חיצוניים — דורש בדיקה
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {alerts.conflicts.length > 0 && (
          <div>
            <p className="font-medium">
              התנגשויות: תאריכים שתפוסים אצלכם וגם ביומן חיצוני. לא שינינו שום הזמנה — כדאי לסגור
              אותם בערוץ כדי למנוע הזמנה כפולה.
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {alerts.conflicts.slice(0, 6).map((c) => (
                <li key={`${c.calendarId}-${c.uid}`}>
                  {c.unit} · {CHANNEL_LABELS[c.channel] ?? c.channel} ·{" "}
                  {formatDate(`${c.from}T12:00:00Z`, "Asia/Jerusalem")} –{" "}
                  {formatDate(`${c.to}T12:00:00Z`, "Asia/Jerusalem")}
                </li>
              ))}
              {alerts.conflicts.length > 6 && <li>ועוד {alerts.conflicts.length - 6}…</li>}
            </ul>
          </div>
        )}
        {alerts.failing.length > 0 && (
          <p className="flex items-start gap-2">
            <RefreshCw className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {alerts.failing.length === 1
              ? `היומן של ${alerts.failing[0]!.unit} (${CHANNEL_LABELS[alerts.failing[0]!.channel] ?? ""}) לא מסתנכרן.`
              : `${alerts.failing.length} יומנים לא מסתנכרנים.`}
          </p>
        )}
        <Link
          to="/manage/channels"
          className="inline-flex min-h-11 items-center justify-center self-start rounded-md border px-4 font-medium hover:bg-muted"
        >
          ליומנים החיצוניים
        </Link>
      </CardContent>
    </Card>
  );
}
