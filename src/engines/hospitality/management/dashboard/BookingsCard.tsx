// לוח הבקרה — כרטיס ההזמנות (2h): בקשות שממתינות לטיפול (עם הזמן שנשאר לאישור), כמה הזמנות
// קרובות וכמה אורחים שוהים עכשיו, וקיצורים למסך ההזמנות ולהוספת הזמנה.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/platform/ui";
import { hospitalityBookings } from "../../api/bookings.functions";
import { STATE_LABELS, bookingsKey, holdText, stayText } from "../bookings/model";

export function BookingsCard() {
  const query = useQuery({
    queryKey: [...bookingsKey("pending", ""), "dashboard"],
    queryFn: () => hospitalityBookings({ data: { tab: "pending", q: null, limit: 5, offset: 0 } }),
    refetchInterval: 60_000,
  });
  const d = query.data;
  return (
    <Card data-section="bookings-card">
      <CardHeader>
        <CardTitle className="text-lg">
          <h2>הזמנות</h2>
        </CardTitle>
        <CardDescription>
          {d
            ? `${d.counts.pending} ממתינות לטיפול · ${d.counts.upcoming} קרובות · ${d.counts.staying} שוהים עכשיו`
            : "טוען…"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {d && d.items.length > 0 && (
          <ul className="flex flex-col divide-y text-sm">
            {d.items.map((b) => (
              <li key={b.id} className="py-2">
                <Link
                  to="/manage/bookings/$bookingId"
                  params={{ bookingId: b.id }}
                  className="flex flex-col font-medium text-primary hover:underline"
                >
                  #{b.number} · {b.guest_name} · {b.unit_name}
                </Link>
                <span className="text-muted-foreground">
                  {stayText(b)} · {STATE_LABELS[b.state]}
                </span>
                {b.hold_expires_at && (
                  <span className="block text-amber-800">{holdText(b.hold_expires_at)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Link
            to="/manage/bookings"
            className="inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium hover:bg-muted"
          >
            כל ההזמנות
          </Link>
          <Link
            to="/manage/bookings/new"
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="size-4" aria-hidden="true" />
            הוספת הזמנה
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
