import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, CircleAlert, CreditCard, Loader2, XCircle } from "lucide-react";
import { AppFooter } from "@/components/AppFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuthState } from "@/hooks/useAuthState";
import { formatIls } from "@/lib/catalog";
import { trackPurchase } from "@/lib/marketing";
import {
  getGrowPaymentStatus,
  startGrowPayment,
  type GrowPaymentStatus,
} from "@/lib/grow-payments.functions";

type Stage = "loading" | "missing" | "redirecting" | "checking" | "paid" | "unpaid" | "expired";

const POLL_MS = 3000;
const POLL_LIMIT = 20;

/**
 * חלק 43: עמוד התשלום המקוון. פותח את דף התשלום של Grow (autoStart), ובחזרה ממנו
 * ממתין לאישור מהשרת (ההתראה של Grow) לפני שמציג "שולם".
 */
export function GrowPaymentPage({
  orderId,
  autoStart,
  cancelled,
}: {
  orderId: string;
  autoStart: boolean;
  cancelled: boolean;
}) {
  const { session, role } = useAuthState();
  const getStatus = useServerFn(getGrowPaymentStatus);
  const start = useServerFn(startGrowPayment);
  const [info, setInfo] = useState<GrowPaymentStatus | null>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const tracked = useRef(false);

  const goToPayment = useCallback(async () => {
    setError(null);
    setStage("redirecting");
    try {
      const { url } = await start({ data: { orderId } });
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "פתיחת התשלום נכשלה");
      setStage("unpaid");
    }
  }, [start, orderId]);

  useEffect(() => {
    let alive = true;
    let polls = 0;
    const tick = async () => {
      try {
        const status = await getStatus({ data: { orderId } });
        if (!alive) return;
        if (!status) {
          setStage("missing");
          return;
        }
        setInfo(status);
        if (status.paid) {
          setStage("paid");
          return;
        }
        if (status.paymentStatus === "expired" || status.paymentStatus === "rejected") {
          setStage("expired");
          return;
        }
        // עוד לא שולם
        if (autoStart && !started.current) {
          started.current = true;
          void goToPayment();
          return;
        }
        if (cancelled) {
          setStage("unpaid");
          return;
        }
        // חזרה מדף התשלום: ממתינים לאישור מהשרת (ההתראה מגיעה בדרך כלל תוך שניות)
        polls += 1;
        if (polls > POLL_LIMIT) {
          setStage("unpaid");
          return;
        }
        setStage("checking");
        window.setTimeout(() => void tick(), POLL_MS);
      } catch {
        if (alive) setStage("missing");
      }
    };
    void tick();
    return () => {
      alive = false;
    };
  }, [getStatus, orderId, autoStart, cancelled, goToPayment]);

  useEffect(() => {
    if (stage === "paid" && info && !tracked.current) {
      tracked.current = true;
      trackPurchase(info.orderNumber, info.amount);
    }
  }, [stage, info]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader
        role={role}
        email={session?.user.email ?? null}
        onSignOut={async () => undefined}
      />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-8">
        <Card data-testid="grow-page" data-stage={stage}>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            {stage === "loading" || stage === "redirecting" || stage === "checking" ? (
              <>
                <Loader2 className="size-9 animate-spin text-muted-foreground" aria-hidden="true" />
                <p role="status" className="font-medium">
                  {stage === "redirecting"
                    ? "מעבירים אותך לדף התשלום המאובטח…"
                    : stage === "checking"
                      ? "מאמתים את התשלום מול חברת הסליקה… אפשר להישאר בעמוד."
                      : "טוען…"}
                </p>
              </>
            ) : stage === "paid" && info ? (
              <>
                <CheckCircle2 className="size-12 text-green-600" aria-hidden="true" />
                <h1 className="text-xl font-bold">התשלום התקבל — תודה!</h1>
                <p className="text-sm text-muted-foreground">
                  הזמנה <span dir="ltr">{info.orderNumber}</span> · {formatIls(info.amount)}
                </p>
                {info.asmachta && (
                  <p className="text-sm" data-testid="grow-asmachta">
                    מספר אישור תשלום:{" "}
                    <span dir="ltr" className="font-semibold">
                      {info.asmachta}
                    </span>
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  אישור ההזמנה נשלח למייל. חשבונית / קבלה על התשלום נשלחת מחברת הסליקה.
                </p>
                <Button asChild>
                  <Link to="/">חזרה לחנות</Link>
                </Button>
              </>
            ) : stage === "unpaid" ? (
              <>
                <CircleAlert className="size-12 text-amber-600" aria-hidden="true" />
                <h1 className="text-xl font-bold">
                  {cancelled ? "התשלום בוטל" : "התשלום עדיין לא אושר"}
                </h1>
                <p className="text-sm text-muted-foreground">
                  ההזמנה{info ? ` ${info.orderNumber}` : ""} נשמרה וממתינה לתשלום. אפשר להמשיך
                  לתשלום עכשיו.
                </p>
                {error && (
                  <p className="text-sm text-destructive" role="alert">
                    {error}
                  </p>
                )}
                <Button onClick={() => void goToPayment()} data-testid="grow-retry">
                  <CreditCard className="size-4" aria-hidden="true" />
                  המשך לתשלום{info ? ` · ${formatIls(info.amount)}` : ""}
                </Button>
                <p className="text-xs text-muted-foreground">
                  אם כבר שילמתם והעמוד לא התעדכן — רעננו אותו בעוד דקה.
                </p>
              </>
            ) : stage === "expired" ? (
              <>
                <XCircle className="size-12 text-muted-foreground" aria-hidden="true" />
                <h1 className="text-xl font-bold">ההזמנה לא שולמה בזמן</h1>
                <p className="text-sm text-muted-foreground">ההזמנה בוטלה. אפשר לבצע הזמנה חדשה.</p>
                <Button asChild>
                  <Link to="/">חזרה לחנות</Link>
                </Button>
              </>
            ) : (
              <>
                <XCircle className="size-12 text-muted-foreground" aria-hidden="true" />
                <h1 className="text-xl font-bold">ההזמנה לא נמצאה</h1>
                <Button asChild>
                  <Link to="/">חזרה לחנות</Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </main>
      <AppFooter />
    </div>
  );
}
