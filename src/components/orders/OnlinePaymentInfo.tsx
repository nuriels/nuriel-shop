import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  cancelOrderOnlinePayment,
  getOrderOnlinePayment,
  resolveOrderOnlinePayment,
} from "@/lib/online-payments-staff.functions";
import {
  ATTEMPT_STATE_LABELS,
  REVIEW_OUTCOME_LABELS,
  agorotText,
  reviewReasonLabel,
  type OnlinePaymentView,
  type ReviewOutcome,
} from "@/platform/payments/tenant-views";

/**
 * MAX/Hyp DEMO — an order's online card payment in the order card (store staff). The state comes from the DB
 * (max_order_payment_status): "paid" only after the server's VERIFY. Card data: brand and last 4 digits only.
 * Store admins can cancel the live attempt (to edit the order) and close a review with one of two explicit
 * decisions (X-16) and an optional note. A held order (X-14: a return came back and is unverified, in review, or
 * was charged) is shown as held: it is not cancelled automatically and cannot be paid again until a decision.
 */
export function OnlinePaymentInfo({
  order,
  canManage,
}: {
  order: { id: string; payment_method?: string | null };
  canManage: boolean;
}) {
  const load = useServerFn(getOrderOnlinePayment);
  const cancel = useServerFn(cancelOrderOnlinePayment);
  const resolve = useServerFn(resolveOrderOnlinePayment);
  const [view, setView] = useState<OnlinePaymentView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState("");
  const online = order.payment_method === "online";

  const refresh = useCallback(async () => {
    try {
      setView(await load({ data: { orderId: order.id } }));
    } catch {
      setView(null);
    } finally {
      setLoaded(true);
    }
  }, [load, order.id]);

  useEffect(() => {
    if (online) void refresh();
  }, [online, refresh]);

  if (!online) return null;
  if (!loaded) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
        טוענים את מצב התשלום המקוון…
      </div>
    );
  }

  const attempt = view?.attempt ?? null;
  const state = attempt?.state ?? null;
  const paid = view?.paymentStatus === "paid";
  const outcome = attempt?.reviewOutcome ?? null;
  const review = state === "needs_review" && outcome === null;
  const charged = outcome === "charged";
  const held = view?.held === true && !paid;
  const live = state === "created" || state === "redirected";

  const act = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      toast.success(done);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "הפעולה נכשלה. אפשר לנסות שוב.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`space-y-1 rounded-md border px-3 py-2 text-xs ${
        paid && !charged
          ? "border-green-300 bg-green-50 text-green-900 dark:border-green-700 dark:bg-green-950/40 dark:text-green-200"
          : review || charged
            ? "border-red-300 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-950/40 dark:text-red-200"
            : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
      }`}
      data-testid="online-payment-info"
      data-state={state ?? (paid ? "paid" : "none")}
      data-held={held ? "true" : "false"}
      data-mode={attempt ? (attempt.test ? "test" : "live") : ""}
    >
      <p className="flex flex-wrap items-center gap-1.5 font-bold">
        <CreditCard className="size-3.5" aria-hidden="true" />
        תשלום מקוון בכרטיס אשראי —{" "}
        {paid ? "שולם" : state ? ATTEMPT_STATE_LABELS[state] : "ממתין לתשלום"}
        {attempt?.test && (
          <Badge variant="outline" className="text-[10px]">
            בדיקה
          </Badge>
        )}
      </p>
      {attempt && (attempt.amountMinor !== null || attempt.approvalCode || attempt.cardLast4) && (
        <p>
          {attempt.amountMinor !== null && agorotText(attempt.amountMinor)}
          {attempt.approvalCode && (
            <>
              {" · "}מספר אישור:{" "}
              <span dir="ltr" className="font-semibold" data-testid="online-payment-approval">
                {attempt.approvalCode}
              </span>
            </>
          )}
          {attempt.cardLast4 && (
            <>
              {" · "}כרטיס:{" "}
              <span dir="ltr" data-testid="online-payment-card">
                •••• {attempt.cardLast4}
              </span>
            </>
          )}
        </p>
      )}
      {review && (
        <p data-testid="online-payment-review-reason">
          לבדיקה: {reviewReasonLabel(attempt?.reviewReason ?? null)}. אין לשלוח את ההזמנה לפני
          הבדיקה.
        </p>
      )}
      {held && (
        <p className="font-semibold" data-testid="online-payment-held">
          {charged
            ? "ההזמנה מוחזקת לטיפול ידני: בוצע חיוב — יש לבטל ולזכות בפורטל Hyp, או לטפל בהזמנה ידנית."
            : "ההזמנה מוחזקת: תשלום שחזר מדף התשלום עוד לא הוכרע. היא לא תבוטל אוטומטית ואי אפשר לשלם עליה שוב עד להחלטה."}
        </p>
      )}
      {canManage && (live || (review && attempt?.id)) && (
        <div className="flex flex-wrap gap-2 pt-1">
          {live && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              data-testid="online-payment-cancel-attempt"
              onClick={() =>
                void act(
                  () => cancel({ data: { orderId: order.id } }),
                  "ניסיון התשלום בוטל. אפשר לערוך את ההזמנה.",
                )
              }
            >
              ביטול ניסיון התשלום
            </Button>
          )}
          {review && attempt?.id && !resolving && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              data-testid="online-payment-resolve"
              onClick={() => setResolving(true)}
            >
              סימון כטופל
            </Button>
          )}
        </div>
      )}
      {canManage && review && attempt?.id && resolving && (
        <div className="space-y-2 pt-1" data-testid="online-payment-resolve-panel">
          <p className="font-semibold">מה קרה בפועל? אפשר לבדוק בפורטל Hyp.</p>
          <input
            type="text"
            className="w-full rounded border border-input bg-background px-2 py-1 text-xs text-foreground"
            placeholder="הערה לטיפול (לא חובה)"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            data-testid="online-payment-resolve-note"
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {(["not_charged", "charged"] as const).map((choice: ReviewOutcome) => (
              <Button
                key={choice}
                size="sm"
                variant={choice === "charged" ? "destructive" : "outline"}
                className="h-auto whitespace-normal py-1.5 text-start"
                disabled={busy}
                data-testid={`online-payment-resolve-${choice === "charged" ? "charged" : "not-charged"}`}
                onClick={() =>
                  void act(async () => {
                    await resolve({
                      data: {
                        orderId: order.id,
                        attemptId: attempt.id ?? "",
                        outcome: choice,
                        note,
                      },
                    });
                    setResolving(false);
                    setNote("");
                  }, "ההחלטה נשמרה.")
                }
              >
                {REVIEW_OUTCOME_LABELS[choice]}
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setResolving(false)}
              data-testid="online-payment-resolve-cancel"
            >
              ביטול
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
