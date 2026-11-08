// החוזה של ההזמנה (חוזה אירוח — מיגרציה 64): החוזים שנשלחו להזמנה הזו (או לקבוצת החדרים שלה),
// ושליחה לחתימה — במסך "מסמכי לקוחות". סוג החוזה נקבע לפי ההזמנה: הזמנת לינה → חוזה אירוח, תמיד.
import { Link } from "@tanstack/react-router";
import { FileSignature } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/platform/ui";
import type { BookingDetail } from "../../types/bookings";
import { ContractsForLink } from "../client-documents/ContractsForLink";
import { useManagement } from "../shell/management-context";

const CLOSED = new Set(["declined", "cancelled", "expired", "no_show"]);

export function BookingContractsCard({ b }: { b: BookingDetail }) {
  const ctx = useManagement();
  const allowed = Boolean(ctx.permissions["contracts"]);
  return (
    <Card data-section="contracts">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 pb-2">
        <div>
          <CardTitle className="text-lg">
            <h2>החוזה</h2>
          </CardTitle>
          <p className="mt-1 text-[13px] text-muted-foreground">
            חוזה אירוח — נשלח ללקוח לחתימה במייל
          </p>
        </div>
        {allowed && !CLOSED.has(b.state) && (
          <Link
            to="/manage/client-documents"
            search={{ tab: "send", booking: b.id }}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted"
          >
            <FileSignature className="size-4" aria-hidden="true" />
            שליחת חוזה לחתימה
          </Link>
        )}
      </CardHeader>
      <CardContent>
        {allowed ? (
          <ContractsForLink bookingId={b.id} />
        ) : (
          <p className="text-sm text-muted-foreground">
            צפייה בחוזים — לבעלים ולמנהלים שקיבלו הרשאה.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
