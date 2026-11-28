import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CreditCard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getOnlinePaymentSettings } from "@/lib/online-payments-owner.functions";
import { DemoBanner } from "@/platform/payments/ui/DemoBanner";
import {
  PILOT_ACTIVE_TEXT,
  PILOT_SOON_TEXT,
  TERMINAL_STATUS_LABELS,
  isStorePilotStatus,
  terminalHintText,
  type StorePilotStatus,
  type StoreTerminalView,
} from "@/platform/payments/tenant-views";

/**
 * MAX/Hyp DEMO — "תשלום מקוון בכרטיס אשראי" in the store settings (store owner): connected or not, mode, the last
 * 2 digits of the terminal, last check. Read-only: NURIEL's platform admins set up the terminal, and in DEMO every
 * payment is a single payment. No secret is ever sent here. Renders nothing at all until a terminal is set up for
 * the store (and nothing while it loads), so the settings page stays exactly as it was. In the pilot (P-6, P-8) the
 * card says only "סליקת MAX פעילה" or "הסליקה בקרוב": no terminal, no hint digits, no key, no button.
 */
export function OnlinePaymentSettingsCard() {
  const load = useServerFn(getOnlinePaymentSettings);
  const [view, setView] = useState<StoreTerminalView | StorePilotStatus | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "hidden">("loading");

  useEffect(() => {
    let alive = true;
    load()
      .then((v) => {
        if (!alive) return;
        setView(v);
        setState(v ? "ready" : "hidden");
      })
      .catch(() => {
        if (alive) setState("hidden");
      });
    return () => {
      alive = false;
    };
  }, [load]);

  if (state !== "ready" || !view) return null;
  if (isStorePilotStatus(view)) {
    return (
      <Card
        data-testid="online-payment-settings"
        data-pilot="true"
        data-active={view.active ? "true" : "false"}
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="size-5 text-accent" aria-hidden="true" />
            תשלום מקוון בכרטיס אשראי (MAX)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {view.demo && <DemoBanner />}
          <p data-testid="online-payment-status">
            <Badge variant={view.active ? "secondary" : "outline"}>
              {view.active ? PILOT_ACTIVE_TEXT : PILOT_SOON_TEXT}
            </Badge>
          </p>
        </CardContent>
      </Card>
    );
  }
  const connected = view.configured && view.status === "verified";
  return (
    <Card
      data-testid="online-payment-settings"
      data-configured={view.configured ? "true" : "false"}
      data-active={view.active ? "true" : "false"}
      data-env={view.environment ?? ""}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CreditCard className="size-5 text-accent" aria-hidden="true" />
          תשלום מקוון בכרטיס אשראי (MAX)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {view.demo && <DemoBanner />}
        <p className="flex flex-wrap items-center gap-2" data-testid="online-payment-status">
          <Badge variant={connected ? "secondary" : "outline"}>
            {view.status ? TERMINAL_STATUS_LABELS[view.status] : "לא נבדק"}
          </Badge>
          <span>
            {view.active ? "התשלום המקוון פעיל בקופה" : "התשלום המקוון לא מוצג בקופה כרגע"}
          </span>
        </p>
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
        {view.demo && <p className="text-muted-foreground">בסביבת DEMO התשלום תמיד בתשלום אחד.</p>}
        <p className="text-xs text-muted-foreground">
          את פרטי המסוף מגדיר צוות NURIEL. הפרטים הסודיים אינם מוצגים כאן אף פעם.
        </p>
      </CardContent>
    </Card>
  );
}
