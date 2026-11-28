import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CreditCard, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getOnlinePaymentSettings } from "@/lib/online-payments-owner.functions";
import {
  TERMINAL_STATUS_LABELS,
  terminalHintText,
  type StoreTerminalView,
} from "@/platform/payments/tenant-views";

/**
 * MAX/Hyp DEMO — "תשלום מקוון בכרטיס אשראי" in the store settings (store owner): connected or not, mode, the last
 * 2 digits of the terminal, last check. Read-only: NURIEL's platform admins set up the terminal, and in DEMO every
 * payment is a single payment. No secret is ever sent here.
 */
export function OnlinePaymentSettingsCard() {
  const load = useServerFn(getOnlinePaymentSettings);
  const [view, setView] = useState<StoreTerminalView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "hidden">("loading");

  useEffect(() => {
    let alive = true;
    load()
      .then((v) => {
        if (!alive) return;
        setView(v);
        setState("ready");
      })
      .catch(() => {
        if (alive) setState("hidden");
      });
    return () => {
      alive = false;
    };
  }, [load]);

  if (state === "hidden") return null;
  const connected = view?.configured === true && view.status === "verified";
  return (
    <Card
      data-testid="online-payment-settings"
      data-configured={view?.configured ? "true" : "false"}
      data-active={view?.active ? "true" : "false"}
      data-env={view?.environment ?? ""}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="size-5 text-accent" aria-hidden="true" />
          תשלום מקוון בכרטיס אשראי (MAX)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {state === "loading" || !view ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            טוענים…
          </p>
        ) : (
          <>
            <p className="flex flex-wrap items-center gap-2" data-testid="online-payment-status">
              <Badge variant={connected ? "secondary" : "outline"}>
                {!view.configured
                  ? "לא הוגדר"
                  : view.status
                    ? TERMINAL_STATUS_LABELS[view.status]
                    : "לא נבדק"}
              </Badge>
              <span>
                {view.active ? "התשלום המקוון פעיל בקופה" : "התשלום המקוון לא מוצג בקופה כרגע"}
              </span>
            </p>
            {view.configured && (
              <p className="text-muted-foreground">
                מסוף:{" "}
                <span dir="ltr" data-testid="online-payment-terminal-hint">
                  {terminalHintText(view.terminalHint)}
                </span>
                {" · "}מצב:{" "}
                <span data-testid="online-payment-mode">
                  {view.mode === "test" ? "בדיקה" : view.mode === "live" ? "אמיתי" : "—"}
                </span>
              </p>
            )}
            {view.environment === "demo" && (
              <p className="text-muted-foreground">בסביבת DEMO התשלום תמיד בתשלום אחד.</p>
            )}
            <p className="text-xs text-muted-foreground">
              את פרטי המסוף מגדיר צוות NURIEL. הפרטים הסודיים אינם מוצגים כאן אף פעם.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
