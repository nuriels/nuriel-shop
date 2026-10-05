import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, CreditCard, Loader2, RotateCcw, ShieldAlert, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppFooter } from "@/components/AppFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PickupNotice } from "@/components/checkout/PickupNotice";
import { useAuthState } from "@/hooks/useAuthState";
import { getPaymentResult, retryOrderPayment } from "@/lib/payments.functions";
import { isAddonOrPlanToken, type PaymentResult } from "@/lib/payments";
import { formatIls } from "@/lib/catalog";
import { trackPurchase } from "@/lib/marketing";

type Search = { token?: string | undefined; status?: string | undefined };

/**
 * דף התוצאה אחרי התשלום ב-Hyp (חלק 16). השרת כבר אימת את התשלום
 * (/payments/hyp/return) לפני שהגענו לכאן — הדף רק מציג את המצב מהמסד:
 * שולם / לא הושלם (עם "לנסות שוב") / לא אומת.
 */
export const Route = createFileRoute("/payment/result")({
  ssr: false,
  head: () => ({ meta: [{ title: "תוצאת התשלום" }, { name: "robots", content: "noindex" }] }),
  validateSearch: (search: Record<string, unknown>): Search => {
    const result: Search = {};
    const token = typeof search["token"] === "string" ? search["token"] : "";
    const status = typeof search["status"] === "string" ? search["status"] : "";
    if (isAddonOrPlanToken(token)) result.token = token;
    if (["failed", "unverified", "unknown"].includes(status)) result.status = status;
    return result;
  },
  component: PaymentResultPage,
});

function PaymentResultPage() {
  const { token, status: hinted } = Route.useSearch();
  const { session, role } = useAuthState();
  const load = useServerFn(getPaymentResult);
  const retry = useServerFn(retryOrderPayment);
  const [result, setResult] = useState<PaymentResult | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tracked = useRef(false);

  useEffect(() => {
    if (!token) {
      setResult({ status: "unknown", orderNumber: null, amount: null, orderPaid: false });
      return;
    }
    load({ data: { token } })
      .then(setResult)
      .catch(() =>
        setResult({ status: "unknown", orderNumber: null, amount: null, orderPaid: false }),
      );
  }, [token, load]);

  const paid = result !== null && (result.status === "paid" || result.orderPaid);

  // Pixel / GA: רכישה — רק אחרי תשלום שאומת
  useEffect(() => {
    if (!paid || tracked.current || !result?.orderNumber || result.amount === null) return;
    tracked.current = true;
    trackPurchase(result.orderNumber, result.amount);
  }, [paid, result]);

  const tryAgain = async () => {
    if (!token) return;
    setRetrying(true);
    setError(null);
    try {
      const next = await retry({ data: { token } });
      if (next.status === "error" && next.message) setError(next.message);
      window.location.assign(next.redirectTo);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "לא הצלחנו לפתוח את דף התשלום");
      setRetrying(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader role={role} email={session?.user.email ?? null} onSignOut={signOut} />
      <main className="mx-auto flex w-full max-w-xl flex-1 items-start px-4 py-10">
        <Card className="w-full">
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            {result === null ? (
              <>
                <Loader2
                  className="size-10 animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
                <p className="text-muted-foreground">בודקים את מצב התשלום…</p>
              </>
            ) : paid ? (
              <>
                <span className="flex size-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  <CheckCircle2 className="size-9" aria-hidden="true" />
                </span>
                <h1 className="text-2xl font-bold">התשלום התקבל — תודה!</h1>
                {result.orderNumber && (
                  <p className="text-muted-foreground">
                    מספר ההזמנה:{" "}
                    <span dir="ltr" className="numeric font-semibold text-foreground">
                      {result.orderNumber}
                    </span>
                    {result.amount !== null && <> · שולם {formatIls(result.amount)}</>}
                  </p>
                )}
                <p className="text-sm leading-6 text-muted-foreground">
                  אישור הזמנה נשלח למייל.{" "}
                  {result.pickup ? "נעדכן כשההזמנה מוכנה לאיסוף." : "נעדכן כשההזמנה תצא אליכם."}
                </p>
                {result.pickup && (
                  <PickupNotice
                    address={result.pickup.address}
                    hours={result.pickup.hours}
                    className="w-full max-w-md"
                  />
                )}
                <div className="flex flex-wrap justify-center gap-2">
                  {role?.role === "customer" && (
                    <Button asChild variant="outline">
                      <Link to="/orders">להזמנות שלי</Link>
                    </Button>
                  )}
                  <Button asChild>
                    <Link to="/">המשך קנייה</Link>
                  </Button>
                </div>
              </>
            ) : hinted === "unverified" ? (
              <>
                <span className="flex size-16 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                  <ShieldAlert className="size-9" aria-hidden="true" />
                </span>
                <h1 className="text-2xl font-bold">לא הצלחנו לאמת את התשלום</h1>
                <p className="text-sm leading-6 text-muted-foreground">
                  אם החיוב הופיע אצלכם — צרו קשר עם החנות ונבדוק מול חברת האשראי. אל תשלמו פעמיים.
                  {result.orderNumber && (
                    <>
                      {" "}
                      מספר ההזמנה:{" "}
                      <span dir="ltr" className="numeric font-semibold">
                        {result.orderNumber}
                      </span>
                    </>
                  )}
                </p>
                <Button asChild variant="outline">
                  <Link to="/">לדף הבית</Link>
                </Button>
              </>
            ) : result.status === "expired" ? (
              <>
                <span className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <XCircle className="size-9" aria-hidden="true" />
                </span>
                <h1 className="text-2xl font-bold">פג הזמן לתשלום</h1>
                <p className="text-sm leading-6 text-muted-foreground">
                  ההזמנה לא שולמה בזמן ובוטלה, והמוצרים חזרו למלאי. אפשר להזמין שוב מהקטלוג.
                </p>
                <Button asChild>
                  <Link to="/">לקטלוג</Link>
                </Button>
              </>
            ) : result.status === "unknown" ? (
              <>
                <span className="flex size-16 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <CreditCard className="size-9" aria-hidden="true" />
                </span>
                <h1 className="text-2xl font-bold">התשלום לא נמצא</h1>
                <p className="text-sm text-muted-foreground">
                  הקישור לא תקין או שפג תוקפו. אם שילמתם — אישור נשלח אליכם למייל.
                </p>
                <Button asChild variant="outline">
                  <Link to="/">לדף הבית</Link>
                </Button>
              </>
            ) : (
              <>
                <span className="flex size-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                  <XCircle className="size-9" aria-hidden="true" />
                </span>
                <h1 className="text-2xl font-bold">התשלום לא הושלם</h1>
                <p className="text-sm leading-6 text-muted-foreground">
                  לא חויבתם. ההזמנה
                  {result.orderNumber && (
                    <>
                      {" "}
                      <span dir="ltr" className="numeric font-semibold text-foreground">
                        {result.orderNumber}
                      </span>
                    </>
                  )}{" "}
                  שמורה עבורכם 30 דקות — אפשר לנסות שוב, גם עם כרטיס אחר.
                </p>
                {error && (
                  <p
                    role="alert"
                    className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {error}
                  </p>
                )}
                <Button size="lg" onClick={() => void tryAgain()} disabled={retrying}>
                  {retrying ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RotateCcw className="size-4" />
                  )}
                  לנסות לשלם שוב
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
