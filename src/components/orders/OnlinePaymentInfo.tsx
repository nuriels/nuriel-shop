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
  agorotText,
  reviewReasonLabel,
  type OnlinePaymentView,
} from "@/platform/payments/tenant-views";

/**
 * MAX/Hyp DEMO — an order's online card payment in the order card (store staff). The state comes from the DB
 * (max_order_payment_status): "paid" only after the server's VERIFY. Card data: brand and last 4 digits only.
 * Store admins can cancel the live attempt (to edit the order) and close a review with a note.
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
  const review = state === "needs_review";
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
        paid
          ? "border-green-300 bg-green-50 text-green-900 dark:border-green-700 dark:bg-green-950/40 dark:text-green-200"
          : review
            ? "border-red-300 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-950/40 dark:text-red-200"
            : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
      }`}
      data-testid="online-payment-info"
      data-state={state ?? (paid ? "paid" : "none")}
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
          {review && attempt?.id && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              data-testid="online-payment-resolve"
              onClick={() => {
                const note = window.prompt("הערה לטיפול (לא חובה):") ?? "";
                void act(
                  () => resolve({ data: { orderId: order.id, attemptId: attempt.id ?? "", note } }),
                  "הבדיקה סומנה כטופלה.",
                );
              }}
            >
              סימון כטופל
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
