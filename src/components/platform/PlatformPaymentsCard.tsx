import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CreditCard, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { getPlatformPaymentSettings, savePlatformPaymentSettings } from "@/lib/payments.functions";
import { MAX_SIGNUP_URL, type PaymentSettings } from "@/lib/payments";
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
  const [settings, setSettings] = useState<PaymentSettings | null>(null);

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
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <CreditCard className="size-5 text-primary" aria-hidden="true" />
          סליקת הפלטפורמה (Hyp)
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-bold",
              ready
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                : "bg-muted text-muted-foreground",
            )}
          >
            {settings === null ? "…" : ready ? "מחובר — מנויים ותוספים בתשלום מאובטח" : "לא מחובר"}
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
