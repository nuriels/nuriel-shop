// מיגרציה 44: הזמנה שהיא חלק מבקשה אחת לכמה חדרים — החדרים של הבקשה (עם קישור לכל אחד), ואישור /
// דחייה של כל החדרים שממתינים בלחיצה אחת. האורח מקבל מייל אחד (במקום מייל לכל חדר), ולכל חדר נשמרת
// הזמנה משלו — תשלומים, ביטול ושינוי לכל חדר בנפרד.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BedDouble, Check, X } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, Input, Label, cn } from "@/platform/ui";
import { hospitalityBookingGroup, hospitalityDecideGroup } from "../../api/bookings.functions";
import type { BookingState } from "../../types/bookings";
import { ConfirmButton } from "../catalog/parts";
import { errorText } from "../catalog/refresh";
import { manageKeys } from "../lib/query-keys";
import { money } from "../pricing/model";
import { STATE_LABELS, TONE_CLASS, guestsText, stateTone } from "./model";

export function GroupCard({
  bookingId,
  onError,
}: {
  bookingId: string;
  onError: (e: string | null) => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const query = useQuery({
    queryKey: [...manageKeys.all, "booking-group", bookingId],
    queryFn: () => hospitalityBookingGroup({ data: { id: bookingId } }),
    retry: false,
  });
  const group = query.data;
  if (!group) return null;
  const pending = group.bookings.filter((x) => x.status === "pending_approval");
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: manageKeys.all });
  };
  const decide = async (approve: boolean) => {
    onError(null);
    try {
      const r = await hospitalityDecideGroup({
        data: { id: bookingId, approve, reason: approve ? null : reason.trim() || null },
      });
      toast.success(
        approve
          ? `${r.decided} החדרים אושרו — נשלח מייל אחד לאורח`
          : `${r.decided} החדרים נדחו — נשלח מייל אחד לאורח`,
      );
    } catch (e) {
      onError(errorText(e));
    } finally {
      refresh();
    }
  };
  const total = group.bookings.reduce((s, x) => s + x.total, 0);
  const currency = group.bookings[0]?.currency ?? "ILS";

  return (
    <Card data-section="booking-group">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BedDouble className="size-5" aria-hidden="true" />
          בקשה אחת ל-{group.bookings.length} חדרים
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          האורח שלח בקשה אחת לכל החדרים. לכל חדר יש הזמנה משלו — תשלומים, ביטול ושינוי לכל חדר
          בנפרד.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-1.5" data-testid="group-rooms">
          {group.bookings.map((x) => (
            <li
              key={x.id}
              className={cn(
                "flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                x.id === bookingId && "border-primary bg-primary/5",
              )}
              data-group-booking={x.number}
            >
              {x.id === bookingId ? (
                <span className="font-semibold">#{x.number}</span>
              ) : (
                <Link
                  to="/manage/bookings/$bookingId"
                  params={{ bookingId: x.id }}
                  className="font-semibold text-primary hover:underline"
                >
                  #{x.number}
                </Link>
              )}
              <span className="min-w-0 flex-1 truncate">
                {x.unit_name} · {guestsText(x)}
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-semibold",
                  TONE_CLASS[stateTone(x.status as BookingState)],
                )}
              >
                {STATE_LABELS[x.status as BookingState] ?? x.status}
              </span>
              <span className="tabular-nums">{money(x.total, x.currency)}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm font-medium">סה״כ לכל החדרים: {money(total, currency)}</p>
        {pending.length > 0 && (
          <div className="flex flex-col gap-3 border-t pt-3">
            <div className="flex flex-wrap gap-2">
              <ConfirmButton
                label={`אישור כל החדרים (${pending.length})`}
                title={`לאשר את ${pending.length} החדרים?`}
                description={
                  <p>כל החדרים שממתינים יאושרו, והאורח יקבל מייל אחד עם קישור אישי לכל חדר.</p>
                }
                confirmLabel="אישור כל החדרים"
                icon={<Check className="size-4" aria-hidden="true" />}
                onConfirm={() => decide(true)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="group-reason" className="text-xs">
                סיבה לאורח (לא חובה — אם דוחים)
              </Label>
              <Input
                id="group-reason"
                value={reason}
                maxLength={1000}
                onChange={(e) => setReason(e.target.value)}
                className="min-h-11"
              />
              <ConfirmButton
                label={`דחיית כל החדרים (${pending.length})`}
                title={`לדחות את ${pending.length} החדרים?`}
                description={<p>כל החדרים שממתינים יידחו, והאורח יקבל מייל אחד.</p>}
                confirmLabel="דחיית כל החדרים"
                destructive
                icon={<X className="size-4" aria-hidden="true" />}
                onConfirm={() => decide(false)}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
