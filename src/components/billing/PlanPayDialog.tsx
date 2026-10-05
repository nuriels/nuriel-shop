import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, CreditCard, Gem, Loader2 } from "lucide-react";
import { getPlanQuote, startPlanCheckout } from "@/lib/payments.functions";
import { BUSINESS_TYPE_LABELS, type BillingProfile, type PlanQuote } from "@/lib/payments";
import { formatDate, formatShekels } from "@/lib/subscription";
import { BillingProfileDialog } from "@/components/billing/BillingProfileDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * תשלום מאובטח על מנוי שנתי (חלק 16): הצעת מחיר מהשרת (12 חודשים, ובחידוש
 * אותה חבילה — גם התוספים החודשיים הפעילים), פרטי העוסק, ומעבר לדף התשלום
 * של Hyp במסוף הפלטפורמה. אפשר לפרוס לתשלומים בדף התשלום.
 */
export function PlanPayDialog({
  plan,
  billingProfile,
  onProfileSaved,
  onClose,
}: {
  plan: "basic" | "premium" | null;
  billingProfile: BillingProfile | null;
  onProfileSaved: (profile: BillingProfile) => void;
  onClose: () => void;
}) {
  const quoteFn = useServerFn(getPlanQuote);
  const checkout = useServerFn(startPlanCheckout);
  const [quote, setQuote] = useState<PlanQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    setQuote(null);
    setError(null);
    if (!plan) return;
    quoteFn({ data: { plan } })
      .then(setQuote)
      .catch((thrown: unknown) =>
        setError(thrown instanceof Error ? thrown.message : "חישוב המחיר נכשל"),
      );
  }, [plan, quoteFn]);

  const pay = async (target: PlanQuote) => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await checkout({
        data: { plan: target.plan, expectedAmount: target.amount },
      });
      window.location.assign(url);
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : "פתיחת דף התשלום נכשלה";
      if (message.includes("פרטי העוסק")) setProfileOpen(true);
      if (message.includes("המחיר התעדכן") && plan) {
        setQuote(await quoteFn({ data: { plan } }).catch(() => null));
      }
      setError(message);
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!quote) return;
    if (!billingProfile) {
      setProfileOpen(true);
      return;
    }
    void pay(quote);
  };

  return (
    <>
      <Dialog
        open={plan !== null && !profileOpen}
        onOpenChange={(next) => !next && !busy && onClose()}
      >
        <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto text-right sm:max-w-md">
          <DialogHeader className="text-right">
            <DialogTitle className="flex items-center gap-2">
              <Gem className="size-5 text-accent" aria-hidden="true" />
              {quote?.renewal ? "חידוש המנוי" : "תשלום על המנוי"}
            </DialogTitle>
            <DialogDescription>{quote?.title ?? "…"} — 12 חודשים</DialogDescription>
          </DialogHeader>

          {!quote && !error ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              מחשבים את המחיר…
            </div>
          ) : quote ? (
            <div className="space-y-4">
              <dl className="space-y-2 rounded-xl border bg-secondary/40 p-4 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{quote.title}</dt>
                  <dd className="font-semibold">
                    {formatShekels(quote.monthlyPrice)} × {quote.months}
                  </dd>
                </div>
                {quote.addonsMonthly > 0 && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">
                      תוספים פעילים ({quote.addonTitles.join(", ")})
                    </dt>
                    <dd className="whitespace-nowrap font-semibold">
                      {formatShekels(quote.addonsMonthly)} × {quote.months}
                    </dd>
                  </div>
                )}
                {quote.renewal && quote.currentPeriodEnd && (
                  <div className="flex justify-between gap-3 border-t pt-2 text-xs text-muted-foreground">
                    <dt>התקופה החדשה מתחילה</dt>
                    <dd>{formatDate(quote.currentPeriodEnd)} (בסוף התקופה הנוכחית)</dd>
                  </div>
                )}
              </dl>

              <div className="rounded-2xl bg-primary px-4 py-4 text-center text-primary-foreground">
                <p className="text-sm opacity-80">לתשלום — מראש לשנה</p>
                <p className="font-display text-4xl font-black">{formatShekels(quote.amount)}</p>
                {quote.maxPayments > 1 && (
                  <p className="mt-1 text-xs opacity-80">
                    אפשר לפרוס עד {quote.maxPayments} תשלומים בדף התשלום
                  </p>
                )}
              </div>

              <ul className="space-y-1.5 text-xs leading-5 text-muted-foreground">
                <li className="flex gap-2">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                  המנוי מתעדכן מיד עם אישור התשלום.
                </li>
                <li className="flex gap-2">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                  התשלום בדף המאובטח של חברת הסליקה (Hyp) — פרטי הכרטיס לא עוברים דרכנו.
                </li>
              </ul>

              {billingProfile && (
                <p className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground">
                  <span>
                    לחיוב: {billingProfile.companyName} ·{" "}
                    {BUSINESS_TYPE_LABELS[billingProfile.businessType]}{" "}
                    <span dir="ltr">{billingProfile.taxId}</span>
                  </span>
                  <button
                    type="button"
                    className="font-semibold text-primary underline-offset-4 hover:underline"
                    onClick={() => setProfileOpen(true)}
                  >
                    עריכה
                  </button>
                </p>
              )}

              {error && (
                <p
                  role="alert"
                  className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
                >
                  {error}
                </p>
              )}

              <Button
                type="button"
                size="lg"
                className="w-full font-bold"
                onClick={confirm}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CreditCard className="size-4" />
                )}
                לתשלום מאובטח · {formatShekels(quote.amount)}
              </Button>
            </div>
          ) : (
            <p
              role="alert"
              className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}
        </DialogContent>
      </Dialog>

      <BillingProfileDialog
        open={plan !== null && profileOpen}
        initial={billingProfile}
        onClose={() => setProfileOpen(false)}
        onSaved={(profile) => {
          onProfileSaved(profile);
          setProfileOpen(false);
          if (quote) void pay(quote);
        }}
      />
    </>
  );
}
