// Online payments, platform scope — the "מסוף הפלטפורמה" page body (platform admin, platform host; arch §8.7):
// status of NURIEL's terminal, the write-only form (terminal number, KEY, password, enabled) saved only with a
// step-up code e-mailed to the admin (bound to the exact change: any edit after the code was sent needs a new code),
// the free connection check, the success URL for the Hyp portal + its checklist, and two lists: payments to NURIEL
// (review items + "handled") and "sent to Hyp and never returned" (reconciliation). Secrets are never shown again.
// Gender-neutral texts.
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, Mail, PlugZap, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  Switch,
} from "@/platform/ui";
import { DemoBanner } from "@/platform/payments/ui/DemoBanner";
import { errorMessage, formatDate, formatMoney } from "../logic";
import {
  platformCardPaymentResolve,
  platformCardPayments,
  platformTerminalRequestCode,
  platformTerminalSave,
  platformTerminalStatus,
  platformTerminalTest,
  TERMINAL_FORCE_NEEDED_TEXT,
  platformUnreturnedAttempts,
  type CardPaymentRow,
  type CodeSent,
  type TerminalChange,
  type TerminalTest,
  type TerminalView,
  type UnreturnedRow,
} from "../pay-terminal.functions";

const STATUS_TEXT: Record<NonNullable<TerminalView["status"]>, string> = {
  unverified: "ממתין לבדיקת חיבור",
  verified: "החיבור נבדק ותקין",
  failed: "החיבור נכשל",
};

const STATE_TEXT: Record<string, string> = {
  created: "נפתח",
  redirected: "בדף התשלום",
  returned: "חזר, ממתין לאימות",
  paid: "שולם",
  test_paid: "שולם (בדיקה)",
  needs_review: "לבדיקה",
  failed: "לא הושלם",
  expired: "פג תוקף",
  cancelled: "בוטל",
};

const REASON_TEXT: Record<string, string> = {
  document_issued: "ייתכן שהופק מסמך אצל ספק התשלומים",
  unexpected_hold: "עסקה מושהית או בתשלומים — לא צפוי",
  amount_mismatch: "הסכום לא תואם",
  currency_mismatch: "המטבע לא תואם",
  duplicate_txn: "מזהה עסקה כפול",
  duplicate_charge: "תשלום כפול",
  late: "התשלום הגיע אחרי שהניסיון פג",
  terminal_mismatch: "המסוף לא תואם",
  installments_exceeded: "מספר התשלומים לא מותר",
  verify_exhausted: "האימות מול ספק התשלומים נכשל שוב ושוב",
  credentials_changed: "פרטי המסוף שונו בזמן האימות",
  mode_not_allowed: "מצב המסוף לא מותר בסביבה",
  target_settled: "החיוב כבר שולם בדרך אחרת",
  target_changed: "החיוב השתנה",
  payer_gone: "העסק נמחק",
};

const TEST_CODE_TEXT: Record<string, string> = {
  "902": "ספק התשלומים דחה את פרטי ההתחברות",
  "901": "המסוף אינו מורשה לפעולה הזו",
  bad_terminal: "המסוף אינו מסוף של הסביבה הזו (בסביבת DEMO: רק מסוף בדיקות)",
  html: "ספק התשלומים החזיר תקלה זמנית",
  timeout: "ספק התשלומים לא ענה בזמן",
  network: "אין חיבור לספק התשלומים",
  too_large: "התשובה של ספק התשלומים לא תקינה",
  mismatch: "התשובה של ספק התשלומים לא תואמת את הבקשה",
  malformed: "התשובה של ספק התשלומים לא תקינה",
  secret_echo: "התשובה של ספק התשלומים לא תקינה",
  no_signature: "התשובה של ספק התשלומים לא תקינה",
  no_action_pay: "התשובה של ספק התשלומים לא תקינה",
};

const CHECKLIST = [
  "כתובת הצלחה: הכתובת שלמעלה, בלי לוכסן בסוף",
  "בלי כתובת כישלון (השגיאה מוצגת בדף של Hyp)",
  "אימות לפי חתימה בעמוד התשלום — פעיל",
  "מודול החשבוניות — כבוי",
  "ארנקים דיגיטליים, bit וכרטיסי מתנה — כבויים",
  "תשלום אחד בלבד (בלי תשלומים)",
];

const money = (minor: number) => formatMoney(minor / 100);

type Form = {
  terminalNumber: string;
  apiKey: string;
  apiPassword: string;
  enabled: boolean | null;
  clearCredentials: boolean;
  force: boolean;
};
const EMPTY_FORM: Form = {
  terminalNumber: "",
  apiKey: "",
  apiPassword: "",
  enabled: null,
  clearCredentials: false,
  force: false,
};

function changeOf(form: Form, view: TerminalView | null): TerminalChange {
  return {
    terminalNumber: form.terminalNumber.trim() === "" ? null : form.terminalNumber.trim(),
    enabled: form.enabled !== null && form.enabled !== view?.enabled ? form.enabled : null,
    setApiKey: form.apiKey.trim() !== "",
    setApiPassword: form.apiPassword.trim() !== "",
    clearCredentials: form.clearCredentials,
    force: form.force,
  };
}

export function PlatformTerminalCard() {
  const [view, setView] = useState<TerminalView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [challenge, setChallenge] = useState<CodeSent | null>(null);
  const [code, setCode] = useState("");
  const [test, setTest] = useState<TerminalTest | null>(null);
  const [busy, setBusy] = useState<"code" | "save" | "test" | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await platformTerminalStatus());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  /** any edit after the code was sent invalidates it (the code approves exactly one change) */
  const edit = (patch: Partial<Form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setChallenge(null);
    setCode("");
  };

  const requestCode = async (current: Form = form) => {
    setBusy("code");
    setError(null);
    try {
      // X-20: the new secret values go with the code request (the code is bound to them)
      setChallenge(
        await platformTerminalRequestCode({
          data: {
            patch: {
              ...changeOf(current, view),
              apiKey: current.apiKey.trim() === "" ? null : current.apiKey,
              apiPassword: current.apiPassword.trim() === "" ? null : current.apiPassword,
            },
          },
        }),
      );
      setCode("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!challenge) return;
    setBusy("save");
    setError(null);
    try {
      const change = changeOf(form, view);
      const next = await platformTerminalSave({
        data: {
          patch: {
            terminalNumber: change.terminalNumber,
            enabled: change.enabled,
            apiKey: form.apiKey.trim() === "" ? null : form.apiKey,
            apiPassword: form.apiPassword.trim() === "" ? null : form.apiPassword,
            clearCredentials: change.clearCredentials,
            force: change.force,
          },
          challengeId: challenge.challengeId,
          code,
        },
      });
      setView(next);
      setForm(EMPTY_FORM);
      setChallenge(null);
      setCode("");
      setTest(null);
      toast.success("הפרטים נשמרו. עכשיו יש לבצע בדיקת חיבור.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  /**
   * The save was refused because a payment to NURIEL is still in progress (review M1): after an explicit
   * confirmation the same change is approved again WITH force — a new code, since the code binds the change.
   */
  const confirmForce = () => {
    const next = { ...form, force: true };
    setForm(next);
    setChallenge(null);
    setCode("");
    void requestCode(next);
  };

  const runTest = async () => {
    setBusy("test");
    setError(null);
    try {
      const result = await platformTerminalTest();
      setTest(result);
      setView(result.status);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const copyUrl = async () => {
    if (!view?.successUrl) return;
    try {
      await navigator.clipboard.writeText(view.successUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("ההעתקה לא הצליחה — אפשר לסמן את הכתובת ולהעתיק ידנית");
    }
  };

  const change = changeOf(form, view);
  const hasChange =
    change.terminalNumber !== null ||
    change.enabled !== null ||
    change.setApiKey ||
    change.setApiPassword ||
    change.clearCredentials;
  const enabledNow = form.enabled ?? view?.enabled ?? false;
  const forceNeeded = error === TERMINAL_FORCE_NEEDED_TEXT;

  return (
    <div className="flex flex-col gap-6" data-testid="platform-terminal-page">
      {view?.demo ? <DemoBanner /> : null}
      <Card
        data-testid="platform-terminal"
        data-configured={String(view?.configured ?? false)}
        data-status={view?.status ?? "none"}
      >
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-lg">מסוף הפלטפורמה (MAX)</CardTitle>
            {view?.mode === "test" ? <Badge variant="outline">בדיקה</Badge> : null}
            {view?.status ? <Badge variant="secondary">{STATUS_TEXT[view.status]}</Badge> : null}
          </div>
          <p className="text-sm text-muted-foreground">
            המסוף של NURIEL לקבלת תשלומים מבעלי העסקים על חיובים פתוחים. פרטי ההתחברות נשמרים
            מוצפנים ואינם מוצגים שוב. כל שמירה דורשת קוד אימות שנשלח למייל.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {error && !forceNeeded ? (
            <p
              role="alert"
              className="text-sm text-destructive"
              data-testid="platform-terminal-error"
            >
              {error}
            </p>
          ) : null}
          {!view ? (
            error ? null : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" /> טוען…
              </p>
            )
          ) : (
            <>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">המסוף</dt>
                  <dd
                    data-testid="platform-terminal-hint"
                    dir="ltr"
                    className="text-end sm:text-start"
                  >
                    {view.terminalHint ?? "לא הוגדר"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">מצב</dt>
                  <dd>{view.enabled ? "פעיל" : "כבוי"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">פרטי התחברות</dt>
                  <dd>{view.hasApiKey && view.hasApiPassword ? "נשמרו (מוצפנים)" : "חסרים"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">בדיקת חיבור אחרונה</dt>
                  <dd>{view.lastVerifiedAt ? formatDate(view.lastVerifiedAt) : "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">מתג התשלומים לפלטפורמה</dt>
                  <dd>{view.flagOn ? "פעיל" : "כבוי"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">חזרות לא מזוהות (24 שעות)</dt>
                  <dd>
                    פלטפורמה {view.unknownReturns24h.platform} · חנויות{" "}
                    {view.unknownReturns24h.tenant}
                  </dd>
                </div>
              </dl>
              {!view.paymentsReady ? (
                <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
                  השרת הזה אינו מוכן לתשלומים (הגדרת הסביבה או מפתח ההצפנה חסרים). אפשר לראות סטטוס,
                  אבל אי אפשר לשמור או לבדוק חיבור.
                </p>
              ) : null}

              <form
                className="grid gap-4 rounded-md border p-4 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (challenge) void save();
                  else void requestCode();
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pt-number">מספר מסוף (10 ספרות)</Label>
                  <Input
                    id="pt-number"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={14}
                    dir="ltr"
                    placeholder={view.terminalHint ? `השמור: ${view.terminalHint}` : ""}
                    value={form.terminalNumber}
                    onChange={(e) => edit({ terminalNumber: e.target.value })}
                    data-testid="platform-terminal-number"
                  />
                </div>
                <div className="flex items-center gap-3 sm:pt-6">
                  <Switch
                    id="pt-enabled"
                    checked={enabledNow}
                    onCheckedChange={(v) => edit({ enabled: v === true })}
                    data-testid="platform-terminal-enabled"
                  />
                  <Label htmlFor="pt-enabled">המסוף פעיל</Label>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pt-key">מפתח API (KEY)</Label>
                  <Input
                    id="pt-key"
                    type="password"
                    autoComplete="off"
                    dir="ltr"
                    placeholder={view.hasApiKey ? "נשמר — להחלפה יש להזין חדש" : ""}
                    value={form.apiKey}
                    onChange={(e) => edit({ apiKey: e.target.value })}
                    data-testid="platform-terminal-api-key"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="pt-password">סיסמת API</Label>
                  <Input
                    id="pt-password"
                    type="password"
                    autoComplete="off"
                    dir="ltr"
                    placeholder={view.hasApiPassword ? "נשמרה — להחלפה יש להזין חדשה" : ""}
                    value={form.apiPassword}
                    onChange={(e) => edit({ apiPassword: e.target.value })}
                    data-testid="platform-terminal-api-password"
                  />
                </div>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  הערכים נשמרים מוצפנים ואינם מוצגים שוב. שדה ריק = בלי שינוי.
                </p>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="pt-clear"
                    checked={form.clearCredentials}
                    onCheckedChange={(v) => edit({ clearCredentials: v === true })}
                    data-testid="platform-terminal-clear"
                  />
                  <Label htmlFor="pt-clear">מחיקת פרטי ההתחברות השמורים</Label>
                </div>
                {forceNeeded ? (
                  <div
                    role="alert"
                    className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm sm:col-span-2"
                    data-testid="platform-terminal-force-needed"
                  >
                    <p>{TERMINAL_FORCE_NEEDED_TEXT}</p>
                    <p>לשמור בכל זאת? יישלח קוד אימות חדש לשינוי הזה.</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        className="min-h-11"
                        disabled={busy !== null}
                        onClick={confirmForce}
                        data-testid="platform-terminal-force"
                      >
                        לשמור בכל זאת
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11"
                        disabled={busy !== null}
                        onClick={() => setError(null)}
                      >
                        ביטול
                      </Button>
                    </div>
                  </div>
                ) : form.force ? (
                  <p
                    className="text-sm text-muted-foreground sm:col-span-2"
                    data-testid="platform-terminal-forced"
                  >
                    השמירה תתבצע בכל זאת: תשלום שעדיין בתהליך יעבור לבדיקה ידנית.{" "}
                    <button
                      type="button"
                      className="underline"
                      onClick={() => edit({ force: false })}
                    >
                      ביטול
                    </button>
                  </p>
                ) : null}

                {challenge ? (
                  <div className="flex flex-col gap-2 sm:col-span-2">
                    <p className="text-sm" role="status" data-testid="platform-terminal-code-sent">
                      קוד נשלח אל <span dir="ltr">{challenge.maskedEmail}</span>. הקוד תקף ל-10
                      דקות.
                    </p>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor="pt-code">קוד אימות (6 ספרות)</Label>
                        <Input
                          id="pt-code"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          dir="ltr"
                          className="w-36"
                          value={code}
                          onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
                          data-testid="platform-terminal-code"
                        />
                      </div>
                      <Button
                        type="submit"
                        className="min-h-11"
                        disabled={busy !== null || code.length !== 6}
                        data-testid="platform-terminal-save"
                      >
                        {busy === "save" ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <ShieldCheck className="size-4" aria-hidden="true" />
                        )}
                        שמירה
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="sm:col-span-2">
                    <Button
                      type="submit"
                      className="min-h-11"
                      disabled={busy !== null || !hasChange || !view.paymentsReady}
                      data-testid="platform-terminal-request-code"
                    >
                      {busy === "code" ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Mail className="size-4" aria-hidden="true" />
                      )}
                      שליחת קוד אימות למייל
                    </Button>
                  </div>
                )}
              </form>

              <div className="flex flex-col gap-2">
                <p className="text-sm text-muted-foreground">
                  אחרי כל שמירה יש לבצע בדיקת חיבור: רק מסוף שנבדק בהצלחה מקבל תשלומים. הבדיקה יוצרת
                  דף תשלום של ₪1 שלא נפתח — בלי חיוב.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    disabled={busy !== null || !view.paymentsReady}
                    onClick={() => void runTest()}
                    data-testid="platform-terminal-test"
                  >
                    {busy === "test" ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <PlugZap className="size-4" aria-hidden="true" />
                    )}
                    בדיקת חיבור (בלי חיוב)
                  </Button>
                  {test ? (
                    <span
                      role="status"
                      className={test.ok ? "text-sm text-emerald-700" : "text-sm text-destructive"}
                      data-testid="platform-terminal-test-result"
                      data-ok={String(test.ok)}
                    >
                      {test.ok
                        ? "החיבור תקין"
                        : `החיבור נכשל: ${TEST_CODE_TEXT[test.code ?? ""] ?? "שגיאה לא מוכרת"}`}
                    </span>
                  ) : null}
                </div>
              </div>

              <section className="flex flex-col gap-2" aria-labelledby="pt-portal">
                <h3 id="pt-portal" className="text-sm font-bold">
                  הגדרות בפורטל של Hyp
                </h3>
                {view.successUrl ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <code
                      dir="ltr"
                      className="rounded bg-muted px-2 py-1 text-xs"
                      data-testid="platform-terminal-success-url"
                    >
                      {view.successUrl}
                    </code>
                    <Button type="button" size="sm" variant="ghost" onClick={() => void copyUrl()}>
                      {copied ? (
                        <Check className="size-4" aria-hidden="true" />
                      ) : (
                        <Copy className="size-4" aria-hidden="true" />
                      )}
                      {copied ? "הועתק" : "העתקה"}
                    </Button>
                  </div>
                ) : null}
                <ul
                  className="list-inside list-disc text-sm text-muted-foreground"
                  data-testid="platform-terminal-checklist"
                >
                  {CHECKLIST.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </CardContent>
      </Card>

      {view ? <PaymentsLists /> : null}
    </div>
  );
}

function PaymentsLists() {
  const [payments, setPayments] = useState<CardPaymentRow[] | null>(null);
  const [unreturned, setUnreturned] = useState<UnreturnedRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, u] = await Promise.all([
        platformCardPayments({ data: { tenantId: null } }),
        platformUnreturnedAttempts(),
      ]);
      setPayments(p);
      setUnreturned(u);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const resolve = async (attemptId: string) => {
    setResolving(attemptId);
    try {
      const { resolved } = await platformCardPaymentResolve({ data: { attemptId, note: null } });
      toast[resolved ? "success" : "error"](resolved ? "סומן כטופל" : "הפריט כבר טופל");
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setResolving(null);
    }
  };

  const review = (payments ?? []).filter((p) => p.state === "needs_review" || p.reviewReason);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {error ? (
        <p role="alert" className="text-sm text-destructive lg:col-span-2">
          {error}
        </p>
      ) : null}
      <Card data-testid="platform-card-payments">
        <CardHeader>
          <CardTitle className="text-base">תשלומים לבדיקה</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          {payments === null ? (
            <Loader2 className="size-4 animate-spin" aria-label="טוען" />
          ) : review.length === 0 ? (
            <p className="text-muted-foreground">אין תשלומים שממתינים לבדיקה.</p>
          ) : (
            review.map((p) => (
              <div
                key={p.id}
                className="flex flex-col gap-1 rounded-md border p-3"
                data-testid="platform-card-payment-row"
                data-state={p.state}
                data-reason={p.reviewReason ?? ""}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{p.payerLabel ?? "עסק"}</strong>
                  <Badge variant="secondary">{STATE_TEXT[p.state] ?? p.state}</Badge>
                  {p.mode === "test" ? <Badge variant="outline">בדיקה</Badge> : null}
                </div>
                <div className="text-muted-foreground">
                  {p.targetLabel ?? "חיוב"} · {money(p.amountMinor)} · {formatDate(p.createdAt)}
                </div>
                {p.reviewReason ? <div>{REASON_TEXT[p.reviewReason] ?? p.reviewReason}</div> : null}
                {p.providerTxnId ? (
                  <div className="text-xs text-muted-foreground">
                    מזהה עסקה אצל ספק התשלומים: <span dir="ltr">{p.providerTxnId}</span>
                  </div>
                ) : null}
                {p.reviewResolvedAt ? (
                  <div className="text-xs text-muted-foreground">
                    טופל ב-{formatDate(p.reviewResolvedAt)}
                  </div>
                ) : (
                  <div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={resolving !== null}
                      onClick={() => void resolve(p.id)}
                      data-testid="platform-card-payment-resolve"
                    >
                      סימון כטופל
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
      <Card data-testid="platform-unreturned-list">
        <CardHeader>
          <CardTitle className="text-base">נשלח ל-Hyp ולא חזר</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p className="text-xs text-muted-foreground">
            ניסיונות שהגיעו לדף התשלום ולא חזרו. כדאי לחפש את מספר ההפניה בפורטל של Hyp: אם יש שם
            חיוב, יש לרשום את התשלום ידנית.
          </p>
          {unreturned === null ? (
            <Loader2 className="size-4 animate-spin" aria-label="טוען" />
          ) : unreturned.length === 0 ? (
            <p className="text-muted-foreground">אין ניסיונות כאלה.</p>
          ) : (
            unreturned.map((a) => (
              <div
                key={a.id}
                className="flex flex-col gap-1 rounded-md border p-3"
                data-testid="platform-unreturned-row"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{a.payerLabel ?? "עסק"}</strong>
                  <Badge variant="secondary">{STATE_TEXT[a.state] ?? a.state}</Badge>
                  {a.mode === "test" ? <Badge variant="outline">בדיקה</Badge> : null}
                </div>
                <div className="text-muted-foreground">
                  {a.targetLabel ?? "חיוב"} · {money(a.amountMinor)} ·{" "}
                  {formatDate(a.signedAt ?? a.createdAt)}
                </div>
                {a.reference ? (
                  <div className="text-xs">
                    מספר הפניה: <span dir="ltr">{a.reference}</span>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
