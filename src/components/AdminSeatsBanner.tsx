import { useState } from "react";
import { CreditCard, Hourglass, Send, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  EXTRA_ADMIN_YEARLY_PRICE,
  requestExtraAdmin,
  seatsFull,
  type StoreAdminSeats,
} from "@/lib/admin-seats";

/**
 * ניהול הצוות: כמה מנהלים מותרים בחבילה. בהגעה למגבלה — באנר שיווקי עם "שלח בקשת
 * שדרוג"; אחרי השליחה — "ממתין לקישור תשלום"; כשמנהל הפלטפורמה שלח קישור — "שלם עכשיו".
 */
export function AdminSeatsBanner({
  seats,
  onChanged,
}: {
  seats: StoreAdminSeats | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!seats) return null;
  const full = seatsFull(seats);
  const request = seats.request;

  const send = async () => {
    setBusy(true);
    try {
      await requestExtraAdmin();
      toast.success("הבקשה נשלחה — נחזור אליך עם קישור תשלום");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שליחת הבקשה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  if (!full && !request) {
    return (
      <p data-admin-seats="ok" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Users className="size-4" aria-hidden="true" />
        מנהלים בחנות: <span className="numeric font-semibold text-foreground">
          {seats.used}
        </span>{" "}
        מתוך <span className="numeric font-semibold text-foreground">{seats.limit}</span> בחבילה שלך
      </p>
    );
  }

  return (
    <div
      role="status"
      data-admin-seats={request?.status ?? "full"}
      className="flex flex-col gap-3 rounded-xl border-2 border-accent/50 bg-accent/10 p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
          {request?.status === "pending" ? (
            <Hourglass className="size-5" aria-hidden="true" />
          ) : request?.status === "payment_link_sent" ? (
            <CreditCard className="size-5" aria-hidden="true" />
          ) : (
            <Users className="size-5" aria-hidden="true" />
          )}
        </div>
        <div className="space-y-1">
          <p className="font-bold text-foreground">
            {request?.status === "pending"
              ? "הבקשה נשלחה, ממתין לקישור תשלום"
              : request?.status === "payment_link_sent"
                ? "קישור התשלום מוכן"
                : "הגעת למגבלת המנהלים בחבילה שלך."}
          </p>
          <p className="text-sm text-muted-foreground">
            {request?.status === "pending"
              ? "מנהל הפלטפורמה יכין קישור תשלום, והוא יופיע כאן."
              : request?.status === "payment_link_sent"
                ? `אחרי התשלום ואישור ההנהלה יתווסף לחבילה מנהל נוסף (${EXTRA_ADMIN_YEARLY_PRICE}₪ לשנה).`
                : `שדרג את החבילה או הוסף מנהל נוסף ב-${EXTRA_ADMIN_YEARLY_PRICE}₪ לשנה.`}{" "}
            <span className="numeric whitespace-nowrap">
              (מנהלים: {seats.used} מתוך {seats.limit})
            </span>
          </p>
        </div>
      </div>
      {request?.status === "payment_link_sent" && request.payment_url ? (
        <Button asChild className="shrink-0">
          <a href={request.payment_url} target="_blank" rel="noopener noreferrer">
            <CreditCard className="size-4" aria-hidden="true" />
            שלם עכשיו
          </a>
        </Button>
      ) : !request ? (
        <Button className="shrink-0" disabled={busy} onClick={() => void send()}>
          <Send className="size-4" aria-hidden="true" />
          שלח בקשת שדרוג
        </Button>
      ) : null}
    </div>
  );
}
