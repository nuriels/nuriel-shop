// אירועים במתחם בזמן השהייה (מיגרציה 63): הכיוון ההפוך של "אורחים בצימרים בזמן האירוע" — מי שמנהל את
// ההזמנה רואה שבאותו זמן יש אירוע במתחם (הבריכה והחצר משותפות), כולל שעות השימוש בבריכה באירוע.
// רק מוצג כשיש אירוע; ההזמנה עצמה לא משתנה.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PartyPopper } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/platform/ui";
import { hospitalityBookingEvents } from "../../api/events.functions";
import type { BookingDetail } from "../../types/bookings";
import { manageKeys } from "../lib/query-keys";
import { useManagement } from "../shell/management-context";
import { EVENT_STATUS_LABEL, dayText } from "../events/model";

export function BookingEventsCard({ b }: { b: BookingDetail }) {
  const ctx = useManagement();
  const allowed = Boolean(ctx.permissions["bookings"]);
  const events = useQuery({
    queryKey: [...manageKeys.all, "booking-events", b.id],
    queryFn: () => hospitalityBookingEvents({ data: { id: b.id } }),
    enabled: allowed,
  });
  if (!allowed || !events.data || events.data.length === 0) return null;
  return (
    <Card data-section="booking-events" data-testid="booking-events">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">
          <h2 className="flex items-center gap-2">
            <PartyPopper className="size-5" aria-hidden="true" />
            אירועים במתחם בזמן השהייה
          </h2>
        </CardTitle>
        <p className="text-[13px] text-muted-foreground">
          האורחים בהזמנה הזו חולקים את הבריכה והחצר עם האירוע — כדאי לעדכן אותם מראש.
        </p>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2 text-sm">
          {events.data.map((e) => (
            <li key={e.id} className="flex flex-col gap-0.5">
              <Link
                to="/manage/events/$eventId"
                params={{ eventId: e.id }}
                className="font-medium underline"
              >
                אירוע #{e.number} — {e.event_type_label}
              </Link>
              <span className="text-muted-foreground">
                {dayText(e.event_date)} · {e.start_time}–{e.end_time}
                {e.ends_next_day ? " (למחרת)" : ""} · {e.participants} משתתפים ·{" "}
                {e.pool_start_time && e.pool_end_time
                  ? `בריכה ${e.pool_start_time}–${e.pool_end_time}`
                  : "בלי שימוש בבריכה"}{" "}
                · {EVENT_STATUS_LABEL[e.status]}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
