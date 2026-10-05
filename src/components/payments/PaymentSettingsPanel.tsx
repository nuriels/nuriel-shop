import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CreditCard, ExternalLink, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { refreshSiteSettings } from "@/hooks/useSiteSettings";
import {
  getStorePaymentSettings,
  saveStorePaymentSettings,
  startPaymentTest,
  checkPaymentConnection,
} from "@/lib/payments.functions";
import {
  LEGAL_INVOICE_NOTICE,
  MAX_SIGNUP_GUIDE,
  MAX_SIGNUP_URL,
  PAYMENT_TEST_OUTCOME_TEXT,
  type PaymentOutcome,
  type PaymentSettings,
} from "@/lib/payments";
import { PaymentOutcomeBanner } from "@/components/billing/AddonsStorePanel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PaymentTerminalForm } from "@/components/payments/PaymentTerminalForm";
import { cn } from "@/lib/utils";

/**
 * "אמצעי תשלום וסליקה" בהגדרות החנות (חלק 16): מדריך קצר לפתיחת מסוף
 * ב-MAX, פרטי המסוף של Hyp, הפעלת הסליקה בקופה — והבהרה משפטית שהמערכת
 * מפיקה אישורי הזמנה בלבד (לא חשבוניות מס).
 * "בדיקת סליקה" — חיוב של ₪1 בכרטיס של המנהל, וחזרה לכאן עם התוצאה
 * (?payment= — testOutcome).
 */
export function PaymentSettingsPanel({
  testOutcome,
  onOutcomeSeen,
}: {
  /** חזרה מחיוב הבדיקה ב-Hyp */
  testOutcome?: PaymentOutcome | undefined;
  onOutcomeSeen?: () => void;
} = {}) {
  const load = useServerFn(getStorePaymentSettings);
  const save = useServerFn(saveStorePaymentSettings);
  const test = useServerFn(startPaymentTest);
  const checkConnection = useServerFn(checkPaymentConnection);
  const [settings, setSettings] = useState<PaymentSettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setSettings(await load());
      setError(null);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : "טעינת הגדרות הסליקה נכשלה");
    }
  }, [load]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const active = settings?.enabled === true;

  return (
    <section id="payments" className="scroll-mt-24 space-y-4">
      {testOutcome && (
        <PaymentOutcomeBanner
          outcome={testOutcome}
          onDismiss={onOutcomeSeen}
          text={PAYMENT_TEST_OUTCOME_TEXT[testOutcome]}
        />
      )}
      <Card className="overflow-hidden">
        <CardHeader className="bg-gradient-to-l from-sky-50 to-transparent dark:from-sky-950/30">
          <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
            <CreditCard className="size-5 text-sky-700 dark:text-sky-300" aria-hidden="true" />
            אמצעי תשלום וסליקה
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-xs font-bold",
                active
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {settings === null ? "…" : active ? "סליקה פעילה" : "לא מחובר"}
            </span>
          </CardTitle>
          <CardDescription>
            קבלו תשלום באשראי ישירות לחשבון שלכם, דרך מסוף Hyp של חברת MAX. הלקוח משלם בדף מאובטח של
            חברת הסליקה — פרטי הכרטיס לא עוברים דרכנו.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-5">
          {/* ---------- מדריך קצר ---------- */}
          <ol className="space-y-4">
            <li className="flex gap-3">
              <StepNumber n={1} />
              <div className="min-w-0 flex-1 space-y-2">
                <p className="font-semibold">פתיחת מסוף סליקה ב-MAX</p>
                <Button
                  asChild
                  variant="outline"
                  className="h-auto whitespace-normal py-2 text-start"
                >
                  <a href={MAX_SIGNUP_URL} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4 shrink-0" />
                    עדיין אין לכם מסוף סליקה? הירשמו למקס (MAX) כאן
                  </a>
                </Button>
                <p className="rounded-lg bg-sky-50 p-3 text-sm font-bold leading-6 text-sky-950 dark:bg-sky-950/40 dark:text-sky-100">
                  {MAX_SIGNUP_GUIDE}
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <StepNumber n={2} />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-semibold">הזינו את פרטי המסוף והגדירו את כתובת החזרה</p>
                <p className="text-sm text-muted-foreground">
                  מספר המסוף, סיסמת ה-API ומפתח ה-API (KEY) — שלושתם מתקבלים מנציגי השירות של MAX /
                  Hyp. את כתובת החזרה מוסרים להם (או מגדירים בממשק המסוף).
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <StepNumber n={3} />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-semibold">בדיקת סליקה של ₪1 — ואז מדליקים "סליקה פעילה בקופה"</p>
                <p className="text-sm text-muted-foreground">
                  אחרי השמירה לחצו "חיוב בדיקה של ₪1" ושלמו בכרטיס שלכם — כך תדעו שהכול עובד. אחרי
                  ההפעלה הלקוח בוחר בקופה "תשלום באשראי (מאובטח)" (או "תשלום מול נציג") ועובר לדף
                  התשלום. עם אישור התשלום ההזמנה מסומנת "שולמה", נשלח אישור הזמנה ותקבלו התראה על
                  מלאי נמוך. הזמנה שלא שולמה תוך 30 דקות מתבטלת והמוצרים חוזרים למלאי.
                </p>
              </div>
            </li>
          </ol>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}

          <div className="border-t pt-5">
            <PaymentTerminalForm
              idPrefix="pay"
              settings={settings}
              withEnableSwitch
              maxPaymentsOptions={[1, 2, 3, 4, 5, 6, 8, 10, 12]}
              returnOrigin={origin}
              onSave={async (values) => {
                try {
                  setSettings(
                    await save({
                      data: {
                        terminal: values.terminal,
                        password: values.password,
                        apiKey: values.apiKey,
                        enabled: values.enabled,
                        maxPayments: values.maxPayments,
                      },
                    }),
                  );
                  await refreshSiteSettings();
                  toast.success(
                    values.enabled ? "פרטי המסוף נשמרו — הסליקה פעילה בקופה" : "פרטי המסוף נשמרו",
                  );
                } catch (thrown) {
                  toast.error(thrown instanceof Error ? thrown.message : "השמירה נכשלה");
                }
              }}
              onCheckConnection={() => checkConnection({ data: { scope: "store" } })}
              onTest={async () => {
                try {
                  const { url } = await test({ data: { scope: "store" } });
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
                      data: {
                        clear: true,
                        terminal: "",
                        password: "",
                        apiKey: "",
                        enabled: false,
                        maxPayments: 1,
                      },
                    }),
                  );
                  await refreshSiteSettings();
                  toast.success("המסוף נותק — הקופה חזרה לעבוד בלי סליקה");
                } catch (thrown) {
                  toast.error(thrown instanceof Error ? thrown.message : "הניתוק נכשל");
                }
              }}
            />
          </div>

          <p className="flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            הכסף נכנס ישירות לחשבון שלכם בחברת האשראי. העמלות — לפי ההסכם שלכם עם MAX.
          </p>
        </CardContent>
      </Card>

      {/* ---------- הבהרה משפטית ---------- */}
      <div
        role="note"
        className="flex items-start gap-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-amber-950 shadow-sm dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-50"
      >
        <AlertTriangle
          className="mt-0.5 size-6 shrink-0 text-red-600 dark:text-red-400"
          aria-hidden="true"
        />
        <p className="text-sm font-semibold leading-6">{LEGAL_INVOICE_NOTICE}</p>
      </div>
    </section>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-bold text-sky-800 dark:bg-sky-950 dark:text-sky-200">
      {n}
    </span>
  );
}
