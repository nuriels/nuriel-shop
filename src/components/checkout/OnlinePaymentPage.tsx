import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  CircleAlert,
  Clock,
  CreditCard,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { AppFooter } from "@/components/AppFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuthState } from "@/hooks/useAuthState";
import { trackPurchase } from "@/lib/marketing";
import { guestPaymentToken, ORDER_ID_FORMAT } from "@/lib/online-payments";
import { getOnlinePaymentStatus, startOnlinePayment } from "@/lib/online-payments.functions";
import { PAYMENT_MESSAGES } from "@/platform/payments/max/messages";
import {
  ONLINE_OVER_DEMO_CAP,
  agorotText,
  onlinePaymentStage,
  type OnlinePaymentView,
} from "@/platform/payments/tenant-views";
import { DemoBanner } from "@/platform/payments/ui/DemoBanner";

type Stage =
  | "loading"
  | "ready"
  | "redirecting"
  | "checking"
  | "paid"
  | "review"
  | "failed"
  | "expired"
  | "unavailable"
  | "not_found"
  | "no_access";

const POLL_MS = 2000;
const POLL_LIMIT = 15;

/**
 * MAX/Hyp DEMO — the store's online card payment page and its result page (/checkout/pay/<order id>).
 * Opens Hyp's page (autoStart; the flag is removed from the address first, so "back" lands here without opening a
 * second page), and after Hyp's return shows only what the server verified. Texts are fixed and gender-neutral;
 * nothing from Hyp is shown. No terminal, signature or card data beyond the last 4 digits ever reaches this page.
 */
export function OnlinePaymentPage({
  orderId,
  autoStart,
  returned,
}: {
  orderId: string;
  autoStart: boolean;
  returned: boolean;
}) {
  const { session, role } = useAuthState();
  const getStatus = useServerFn(getOnlinePaymentStatus);
  const start = useServerFn(startOnlinePayment);
  const [view, setView] = useState<OnlinePaymentView | null>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const started = useRef(false);
  const tracked = useRef(false);
  const validId = ORDER_ID_FORMAT.test(orderId);

  const goToPayment = useCallback(async () => {
    setError(null);
    setStage("redirecting");
    try {
      // "back" from Hyp's page must not start a second page
      window.history.replaceState(window.history.state, "", window.location.pathname);
      const { url } = await start({ data: { orderId, guestToken: guestPaymentToken(orderId) } });
      window.location.assign(url);
    } catch (e) {
      const message = e instanceof Error ? e.message : PAYMENT_MESSAGES.unavailable;
      setError(message);
      // above the DEMO cap a retry cannot succeed: no "try again" button (L9)
      setStage(message === ONLINE_OVER_DEMO_CAP ? "unavailable" : "failed");
    }
  }, [start, orderId]);

  useEffect(() => {
    if (!validId) {
      setStage("not_found");
      return;
    }
    let alive = true;
    let polls = 0;
    const tick = async () => {
      try {
        const token = guestPaymentToken(orderId);
        const status = await getStatus({ data: { orderId, guestToken: token } });
        if (!alive) return;
        if (!status) {
          setStage(!token && !session ? "no_access" : "not_found");
          return;
        }
        setView(status);
        const next = onlinePaymentStage(status);
        if (next === "ready" && autoStart && !started.current) {
          started.current = true;
          void goToPayment();
          return;
        }
        if (next === "checking" && polls < POLL_LIMIT) {
          polls += 1;
          setStage("checking");
          window.setTimeout(() => void tick(), POLL_MS);
          return;
        }
        setStage(next);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : null);
        setStage("unavailable");
      }
    };
    void tick();
    return () => {
      alive = false;
    };
  }, [getStatus, orderId, validId, autoStart, goToPayment, session, round]);

  const amount = view?.attempt?.amountMinor ?? null;
  const test = view?.attempt?.test === true;
  useEffect(() => {
    // conversion tracking: real payments only (never a DEMO / test payment)
    if (stage === "paid" && view && !test && !tracked.current) {
      tracked.current = true;
      if (amount !== null) trackPurchase(view.orderNumber ?? "", amount / 100);
    }
  }, [stage, view, test, amount]);

  const orderLine = view?.orderNumber ? (
    <p className="text-sm text-muted-foreground">
      הזמנה{" "}
      <span dir="ltr" data-testid="online-pay-order-number">
        {view.orderNumber}
      </span>
      {amount !== null && (
        <>
          {" · "}
          <span data-testid="online-pay-amount">{agorotText(amount)}</span>
        </>
      )}
    </p>
  ) : null;
  const testBadge = test ? (
    <Badge variant="outline" data-testid="online-pay-test-badge">
      בדיקה
    </Badge>
  ) : null;
  const backHome = (
    <Button asChild variant="outline">
      <Link to="/">חזרה לחנות</Link>
    </Button>
  );
  const payButton = (label: string) => (
    <Button onClick={() => void goToPayment()} data-testid="online-pay-retry">
      <CreditCard className="size-4" aria-hidden="true" />
      {label}
      {amount !== null ? ` · ${agorotText(amount)}` : ""}
    </Button>
  );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader
        role={role}
        email={session?.user.email ?? null}
        onSignOut={async () => undefined}
      />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
        <Card data-testid="online-pay-page" data-stage={stage}>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            {view?.demo && <DemoBanner />}
            {testBadge}
            {stage === "loading" || stage === "redirecting" || stage === "checking" ? (
              <>
                {stage === "checking" && returned && view ? orderLine : null}
                <Loader2 className="size-9 animate-spin text-muted-foreground" aria-hidden="true" />
                <p role="status" className="font-medium" data-testid="online-pay-message">
                  {stage === "redirecting"
                    ? "מעבירים לדף התשלום המאובטח…"
                    : stage === "checking"
                      ? "בודקים את התשלום מול ספק התשלומים… אפשר להישאר בעמוד."
                      : "טוענים את פרטי התשלום…"}
                </p>
                {stage === "checking" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRound((n) => n + 1)}
                    data-testid="online-pay-check-again"
                  >
                    <RefreshCw className="size-4" aria-hidden="true" />
                    לבדוק שוב
                  </Button>
                )}
              </>
            ) : stage === "paid" ? (
              <>
                <CheckCircle2 className="size-12 text-green-600" aria-hidden="true" />
                <h1 className="text-xl font-bold">התשלום התקבל — תודה!</h1>
                {orderLine}
                <p className="text-sm text-muted-foreground" data-testid="online-pay-message">
                  אישור ההזמנה נשלח למייל.
                </p>
                {backHome}
              </>
            ) : stage === "review" ? (
              <>
                <Clock className="size-12 text-amber-600" aria-hidden="true" />
                <h1 className="text-xl font-bold">התשלום בבדיקה</h1>
                {orderLine}
                <p className="text-sm text-muted-foreground" data-testid="online-pay-message">
                  {PAYMENT_MESSAGES.needs_review}
                </p>
                {backHome}
              </>
            ) : stage === "ready" || stage === "failed" ? (
              <>
                <CircleAlert className="size-12 text-amber-600" aria-hidden="true" />
                <h1 className="text-xl font-bold">
                  {stage === "failed" ? "התשלום לא הושלם" : "ההזמנה ממתינה לתשלום"}
                </h1>
                {orderLine}
                <p className="text-sm text-muted-foreground" data-testid="online-pay-message">
                  {error ??
                    (stage === "failed"
                      ? PAYMENT_MESSAGES.declined
                      : "ההזמנה נשמרה. אפשר להמשיך לתשלום מאובטח בכרטיס אשראי.")}
                </p>
                {payButton(stage === "failed" ? "לנסות שוב" : "לתשלום מאובטח")}
              </>
            ) : stage === "expired" ? (
              <>
                <XCircle className="size-12 text-muted-foreground" aria-hidden="true" />
                <h1 className="text-xl font-bold">הזמן לתשלום עבר</h1>
                {orderLine}
                <p className="text-sm text-muted-foreground" data-testid="online-pay-message">
                  ההזמנה בוטלה. אפשר לבצע הזמנה חדשה.
                </p>
                {backHome}
              </>
            ) : stage === "unavailable" ? (
              <>
                <CircleAlert className="size-12 text-muted-foreground" aria-hidden="true" />
                <h1 className="text-xl font-bold">התשלום המקוון אינו זמין כרגע</h1>
                <p className="text-sm text-muted-foreground" data-testid="online-pay-message">
                  {error ?? PAYMENT_MESSAGES.unavailable}
                </p>
                <Button variant="outline" onClick={() => setRound((n) => n + 1)}>
                  לבדוק שוב
                </Button>
              </>
            ) : stage === "no_access" ? (
              <>
                <CircleAlert className="size-12 text-muted-foreground" aria-hidden="true" />
                <h1 className="text-xl font-bold">אי אפשר להציג את מצב התשלום כאן</h1>
                <p className="text-sm text-muted-foreground" data-testid="online-pay-message">
                  כדי לראות את מצב התשלום יש לחזור לחלון שבו בוצעה ההזמנה. אישור יישלח למייל אחרי
                  התשלום.
                </p>
                {backHome}
              </>
            ) : (
              <>
                <XCircle className="size-12 text-muted-foreground" aria-hidden="true" />
                <h1 className="text-xl font-bold">לא הצלחנו לזהות את התשלום</h1>
                <p className="text-sm text-muted-foreground" data-testid="online-pay-message">
                  אם בוצע חיוב, כדאי לפנות לחנות.
                </p>
                {backHome}
              </>
            )}
          </CardContent>
        </Card>
      </main>
      <AppFooter />
    </div>
  );
}
