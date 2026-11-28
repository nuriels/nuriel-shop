import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getStoreOnlinePayments,
  saveStoreTerminal,
  testStoreTerminal,
} from "@/lib/online-payments-admin.functions";
import {
  ATTEMPT_STATE_LABELS,
  TERMINAL_SAVE_NEEDS_FORCE,
  TERMINAL_STATUS_LABELS,
  agorotText,
  terminalHintText,
  type StoreOnlinePaymentsView,
} from "@/platform/payments/tenant-views";
import { DemoBanner } from "@/platform/payments/ui/DemoBanner";

/**
 * MAX/Hyp DEMO — the platform admin's "MAX" tab in a store's customer file: the STORE's own terminal (the store is
 * the seller; NURIEL's terminal is set up separately on /platform/payments). The API key and password are write-only: sealed on
 * the server at once and never shown again. In DEMO only a test terminal (00100…) is accepted, mode "test", one
 * payment. The success URL below is what Hyp's portal must hold for this terminal (no trailing slash).
 */
export function MaxPaymentsTab({ tenantId }: { tenantId: string }) {
  const load = useServerFn(getStoreOnlinePayments);
  const save = useServerFn(saveStoreTerminal);
  const test = useServerFn(testStoreTerminal);
  const [view, setView] = useState<StoreOnlinePaymentsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [terminal, setTerminal] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiPassword, setApiPassword] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [force, setForce] = useState(false);
  // the DB refused the save because a payment of the store is in progress: ask before saving with force
  const [confirmForce, setConfirmForce] = useState(false);
  // P-6a (4): a stored secret shows only its mask; "החלפה" opens an empty input
  const [replaceKey, setReplaceKey] = useState(false);
  const [replacePassword, setReplacePassword] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; code: string | null } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await load({ data: { tenantId } });
      setView(next);
      setEnabled(next.status.enabled);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "הטעינה נכשלה");
    }
  }, [load, tenantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const submit = async (forceNow = false) => {
    setBusy(true);
    setConfirmForce(false);
    try {
      await save({
        data: {
          tenantId,
          ...(terminal.trim() ? { terminalNumber: terminal.trim() } : {}),
          ...(apiKey ? { apiKey } : {}),
          ...(apiPassword ? { apiPassword } : {}),
          enabled,
          ...(force || forceNow ? { force: true } : {}),
        },
      });
      // write-only: the typed values leave the page as soon as they are saved
      setApiKey("");
      setApiPassword("");
      setReplaceKey(false);
      setReplacePassword(false);
      setTerminal("");
      setForce(false);
      toast.success("פרטי המסוף נשמרו");
      await refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : "השמירה נכשלה";
      // the typed values stay in the form, so the confirmation re-sends exactly the same change
      if (message === TERMINAL_SAVE_NEEDS_FORCE && !force && !forceNow) setConfirmForce(true);
      else toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setBusy(true);
    try {
      const result = await test({ data: { tenantId } });
      setTestResult(result);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "בדיקת החיבור נכשלה");
    } finally {
      setBusy(false);
    }
  };

  if (error && !view) {
    return (
      <Card>
        <CardContent className="pt-5 text-sm text-destructive" role="alert" data-testid="max-error">
          {error}
        </CardContent>
      </Card>
    );
  }
  if (!view) return <Loader2 className="size-4 animate-spin" aria-label="טוענים" />;
  const s = view.status;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">MAX — המסוף של החנות</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4" data-testid="max-tab">
        {s.demo && <DemoBanner />}
        <p className="text-xs text-muted-foreground">
          החנות היא בית העסק: התשלומים של הלקוחות שלה עוברים במסוף שלה בלבד. מפתח ה-API וסיסמת ה-API
          נשמרים מוצפנים בשרת ואינם מוצגים שוב לאף אחד. להחלפה יש להקליד אותם מחדש.
        </p>
        {view.defaultStore && (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            זו החנות של NURIEL עצמה. המסוף כאן הוא מסוף של החנות, והוא חייב להיות שונה ממסוף
            הפלטפורמה.
          </p>
        )}
        <div
          className="flex flex-wrap items-center gap-2 text-sm"
          data-testid="max-status"
          data-status={s.status ?? (s.configured ? "unverified" : "none")}
        >
          <Badge variant={s.status === "verified" ? "default" : "secondary"}>
            {!s.configured ? "לא הוגדר" : s.status ? TERMINAL_STATUS_LABELS[s.status] : "לא נבדק"}
          </Badge>
          {s.configured && (
            <span dir="ltr" className="text-muted-foreground">
              {terminalHintText(s.terminalHint)}
            </span>
          )}
          {s.hasApiKey && <Badge variant="secondary">מפתח API נשמר</Badge>}
          {s.hasApiPassword && <Badge variant="secondary">סיסמת API נשמרה</Badge>}
          <Badge variant={s.enabled ? "default" : "outline"}>{s.enabled ? "פעיל" : "כבוי"}</Badge>
          {s.mode && <Badge variant="outline">{s.mode === "test" ? "בדיקה" : "אמיתי"}</Badge>}
          <span className="text-xs text-muted-foreground">
            {s.active ? "מוצג בקופה" : "לא מוצג בקופה"}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="max-terminal">מספר מסוף (10 ספרות)</Label>
            <Input
              id="max-terminal"
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              spellCheck={false}
              value={terminal}
              onChange={(e) => setTerminal(e.target.value)}
              placeholder={
                s.configured ? `${terminalHintText(s.terminalHint)} — לשינוי יש להקליד` : "00100…"
              }
              data-testid="max-terminal"
            />
          </div>
          <SecretField
            id="max-api-key"
            label="מפתח API"
            mask={s.apiKeyMask}
            replacing={replaceKey}
            onReplace={() => setReplaceKey(true)}
            value={apiKey}
            onChange={setApiKey}
          />
          <SecretField
            id="max-api-password"
            label="סיסמת API"
            mask={s.apiPasswordMask}
            replacing={replacePassword}
            onReplace={() => setReplacePassword(true)}
            value={apiPassword}
            onChange={setApiPassword}
          />
        </div>

        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2 font-medium">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              data-testid="max-enabled"
            />
            פעיל — להציג תשלום מקוון בקופה של החנות
          </label>
          <label className="flex items-center gap-2 text-muted-foreground">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              data-testid="max-force"
            />
            לשמור גם כשתשלום של החנות בתהליך — בדף התשלום או באימות (התשלום יעבור לבדיקה)
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          בסביבת DEMO: מסוף בדיקות בלבד (מספרו מתחיל ב-00100), מצב בדיקה, תשלום אחד.
        </p>

        {confirmForce && (
          <div
            role="alert"
            className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
            data-testid="max-force-confirm"
          >
            <p>{TERMINAL_SAVE_NEEDS_FORCE}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() => void submit(true)}
                data-testid="max-force-confirm-save"
              >
                לשמור בכל זאת
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => setConfirmForce(false)}
                data-testid="max-force-confirm-cancel"
              >
                ביטול
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy} onClick={() => void submit()} data-testid="max-save">
            {busy && <Loader2 className="size-4 animate-spin" />} שמירה
          </Button>
          <Button
            variant="outline"
            disabled={busy || !s.hasApiKey || !s.hasApiPassword}
            onClick={() => void runTest()}
            data-testid="max-test"
          >
            בדיקת חיבור (בלי חיוב)
          </Button>
          {testResult && (
            <span
              className={testResult.ok ? "text-sm text-green-700" : "text-sm text-destructive"}
              data-testid="max-test-result"
              data-ok={testResult.ok ? "true" : "false"}
            >
              {testResult.ok
                ? "החיבור תקין"
                : `החיבור נכשל${testResult.code ? ` (${testResult.code})` : ""}`}
            </span>
          )}
        </div>

        {view.successUrl && (
          <div className="space-y-1">
            <Label>כתובת ההצלחה להעתקה לפורטל של Hyp</Label>
            <div className="flex items-center gap-2">
              <code
                dir="ltr"
                className="flex-1 overflow-x-auto rounded-md border bg-muted/40 px-2 py-1 text-xs"
                data-testid="max-success-url"
              >
                {view.successUrl}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(view.successUrl ?? "")
                    .then(() => toast.success("הכתובת הועתקה"));
                }}
              >
                <Copy className="size-4" aria-hidden="true" />
                העתקה
              </Button>
            </div>
          </div>
        )}

        <div data-testid="max-portal-checklist" className="space-y-1 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">רשימת בדיקה בפורטל של Hyp למסוף הזה:</p>
          <ul className="list-disc space-y-0.5 pe-4 ps-5">
            <li>"לינק מותאם אישית" תחת "עסקה שהצליחה" = הכתובת שלמעלה בדיוק (בלי / בסוף).</li>
            <li>בלי כתובת לעסקה שנכשלה.</li>
            <li>אימות חתימה בדף התשלום — פעיל.</li>
            <li>מודול החשבוניות — כבוי (אין להפיק מסמכים).</li>
            <li>ארנקים דיגיטליים, ביט ו-3DS — כבויים.</li>
          </ul>
        </div>

        <div className="space-y-1">
          <p className="text-sm font-medium">נשלח ל-Hyp ולא חזר</p>
          {view.unreturned.length === 0 ? (
            <p className="text-xs text-muted-foreground">אין כרגע ניסיונות כאלה.</p>
          ) : (
            <ul className="space-y-1 text-xs" data-testid="max-unreturned-list">
              {view.unreturned.map((row, index) => (
                <li
                  key={`${row.orderNumber ?? "-"}-${row.createdAt ?? index}`}
                  className="rounded-md border px-2 py-1"
                  data-testid="max-unreturned-row"
                >
                  הזמנה <span dir="ltr">{row.orderNumber ?? "—"}</span> ·{" "}
                  {agorotText(row.amountMinor)} ·{" "}
                  {row.state ? ATTEMPT_STATE_LABELS[row.state] : "—"}
                  {row.test ? " · בדיקה" : ""}
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            יש לבדוק כל שורה כזו מול הפורטל של המסוף: אם בוצע חיוב, ההזמנה מטופלת ידנית.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * P-6a (4): one write-only secret. Stored → the fixed mask and "החלפה" (which opens an empty input); not stored →
 * the empty input. The value typed here leaves the page with the save and is never shown again.
 */
function SecretField(props: {
  id: string;
  label: string;
  mask: string | null;
  replacing: boolean;
  onReplace: () => void;
  value: string;
  onChange: (value: string) => void;
}) {
  const showInput = props.mask === null || props.replacing;
  return (
    <div className="space-y-1">
      <Label htmlFor={props.id}>{props.label}</Label>
      {showInput ? (
        <Input
          id={props.id}
          type="password"
          dir="ltr"
          autoComplete="new-password"
          spellCheck={false}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          data-testid={props.id}
        />
      ) : (
        <div className="flex items-center gap-2">
          <span dir="ltr" className="font-mono text-sm" data-testid={`${props.id}-mask`}>
            {props.mask}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={props.onReplace}
            data-testid={`${props.id}-replace`}
          >
            החלפה
          </Button>
        </div>
      )}
    </div>
  );
}
