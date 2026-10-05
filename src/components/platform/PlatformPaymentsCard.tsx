import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CreditCard, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import {
  getPlatformPaymentSettings,
  savePlatformPaymentSettings,
  startPaymentTest,
  checkPaymentConnection,
} from "@/lib/payments.functions";
import {
  MAX_SIGNUP_URL,
  PAYMENT_TEST_OUTCOME_TEXT,
  paymentOutcomeOf,
  type PaymentOutcome,
  type PaymentSettings,
} from "@/lib/payments";
import { PaymentOutcomeBanner } from "@/components/billing/AddonsStorePanel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PaymentTerminalForm } from "@/components/payments/PaymentTerminalForm";
import { cn } from "@/lib/utils";

/**
 * סליקת הפלטפורמה (חלק 16): המסוף ב-Hyp שאליו בעלי החנויות משלמים על
 * מנויים ותוספים. כל עוד המסוף לא מחובר — הרכישות נרשמות כ"ממתין לתשלום"
 * (כמו בחלק 15). אחרי החיבור — תשלום מאובטח בלבד.
 */
export function PlatformPaymentsCard() {
  const load = useServerFn(getPlatformPaymentSettings);
  const save = useServerFn(savePlatformPaymentSettings);
  const test = useServerFn(startPaymentTest);
  const checkConnection = useServerFn(checkPaymentConnection);
  const [settings, setSettings] = useState<PaymentSettings | null>(null);
  const [outcome, setOutcome] = useState<PaymentOutcome | undefined>(undefined);

  // חזרה מ"בדיקת סליקה" (?payment=success / failed / unverified) — מציגים פעם אחת
  useEffect(() => {
    const url = new URL(window.location.href);
    const found = paymentOutcomeOf(url.searchParams.get("payment"));
    if (!found) return;
    setOutcome(found);
    url.searchParams.delete("payment");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setSettings(await load());
    } catch (thrown) {
      toast.error(thrown instanceof Error ? thrown.message : "טעינת הגדרות הסליקה נכשלה");
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ready = settings?.enabled === true;
  // חלק 16ב: הסליקה סגורה לחנויות וללקוחות עד לאישור סופי של חברת האשראי
  const live = settings?.live === true;
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <Card id="platform-payments">
      {outcome && (
        <div className="px-6 pt-6">
          <PaymentOutcomeBanner
            outcome={outcome}
            onDismiss={() => setOutcome(undefined)}
            text={PAYMENT_TEST_OUTCOME_TEXT[outcome]}
          />
        </div>
      )}
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <CreditCard className="size-5 text-primary" aria-hidden="true" />
          סליקת הפלטפורמה (Hyp)
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-bold",
              ready && live
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                : ready
                  ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
                  : "bg-muted text-muted-foreground",
            )}
          >
            {settings === null
              ? "…"
              : ready && live
                ? "מחובר — מנויים ותוספים בתשלום מאובטח"
                : ready
                  ? "מסוף מוגדר — הסליקה עדיין סגורה"
                  : "לא מחובר"}
          </span>
        </CardTitle>
        <CardDescription>
          המסוף שאליו בעלי החנויות משלמים על מנויים ותוספים (כולל חיבור לזאפ). בלי מסוף — רכישת תוסף
          נרשמת כ"ממתין לתשלום" ונגבית ידנית.{" "}
          <a
            href={MAX_SIGNUP_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-primary underline-offset-4 hover:underline"
          >
            פתיחת מסוף ב-MAX
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        </CardDescription>
        {settings !== null && !live && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            הסליקה באשראי סגורה כרגע לחנויות וללקוחות, עד לאישור סופי של חברת האשראי: בעלי החנויות
            לא רואים את הגדרות הסליקה, והקופה לא מציעה תשלום באשראי. כאן אפשר כבר לשמור את פרטי
            המסוף של הפלטפורמה ולבדוק אותם (בדיקת חיבור / חיוב ₪1).
          </p>
        )}
      </CardHeader>
      <CardContent>
        <PaymentTerminalForm
          idPrefix="plat-pay"
          settings={settings}
          withEnableSwitch={false}
          maxPaymentsOptions={[12, 1, 3, 6, 10]}
          returnOrigin={origin}
          onSave={async (values) => {
            try {
              setSettings(
                await save({
                  data: {
                    terminal: values.terminal,
                    password: values.password,
                    apiKey: values.apiKey,
                    maxPayments: values.maxPayments,
                  },
                }),
              );
              toast.success("מסוף הפלטפורמה נשמר — תשלום מאובטח פעיל");
            } catch (thrown) {
              toast.error(thrown instanceof Error ? thrown.message : "השמירה נכשלה");
            }
          }}
          onCheckConnection={() => checkConnection({ data: { scope: "platform" } })}
          onTest={async () => {
            try {
              const { url } = await test({ data: { scope: "platform" } });
              window.location.assign(url);
            } catch (thrown) {
              toast.error(thrown instanceof Error ? thrown.message : "פתיחת דף התשלום נכשלה");
              throw thrown;
            }
          }}
          onDisconnect={async () => {
            try {
              setSettings(
                await save({
                  data: { clear: true, terminal: "", password: "", apiKey: "", maxPayments: 12 },
                }),
              );
              toast.success("מסוף הפלטפורמה נותק");
            } catch (thrown) {
              toast.error(thrown instanceof Error ? thrown.message : "הניתוק נכשל");
            }
          }}
        />
      </CardContent>
    </Card>
  );
}
