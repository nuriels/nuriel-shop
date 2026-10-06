import { Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useStoreAdminSeats } from "@/hooks/useStoreAdminSeats";
import {
  EXTRA_ADMIN_YEARLY_PRICE,
  formatSeatDate,
  PLAN_USERS_TEXT,
  planLabel,
} from "@/lib/admin-seats";

/** "המנוי שלי": משתמשים לפי חבילה, תוקף החבילה ותוקף המנהלים הנוספים */
export function AdminSeatsSummary() {
  const { seats } = useStoreAdminSeats(true);
  if (!seats) return null;
  const planEnd = seats.plan === "trial" ? seats.trial_ends_at : seats.current_period_end;
  return (
    <Card data-admin-seats-summary="">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Users className="size-5" aria-hidden="true" />
          משתמשים (מנהלים) בחבילה
        </CardTitle>
        <CardDescription>
          חבילה בסיסית: {PLAN_USERS_TEXT.basic} · חבילת פרימיום: {PLAN_USERS_TEXT.premium} · מנהל
          נוסף: {EXTRA_ADMIN_YEARLY_PRICE}₪ לשנה
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">החבילה שלך</dt>
            <dd className="font-semibold">
              {planLabel(seats.plan)} — <span className="numeric">{seats.plan_limit}</span>{" "}
              {seats.plan_limit === 1 ? "משתמש" : "משתמשים"}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">
              {seats.plan === "trial" ? "הניסיון מסתיים" : "חידוש / תוקף החבילה"}
            </dt>
            <dd className="numeric font-semibold">{formatSeatDate(planEnd)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">מנהלים בשימוש</dt>
            <dd className="numeric font-semibold">
              {seats.used} מתוך {seats.limit}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">מנהלים נוספים</dt>
            <dd className="numeric font-semibold">{seats.extra}</dd>
          </div>
        </dl>
        {seats.extra_seats.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
            {seats.extra_seats.map((seat, index) => (
              <li key={seat.approved_at} className="numeric flex justify-between gap-3">
                <span>מנהל נוסף {index + 1}</span>
                <span className="text-muted-foreground">
                  בתוקף עד {formatSeatDate(seat.renews_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
