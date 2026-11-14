// Billing & Agreements — כרטיס "הסכם ותשלומים" של מנהל הפלטפורמה, משותף לחנות ולצימר (תיק הלקוח / כרטיס
// האתר). מציג ומנהל: חבילה פעילה, מחיר מחירון מול מוסכם (חודשי / שנתי), דמי הקמה (סוכם / שולם / יתרה),
// מנוי (נדרש / התקבל / יתרה), סה"כ שהתקבל, תחילה, חידוש הבא, התחייבות, מע"מ, הערה פנימית, יומן החיובים
// והתשלומים, היסטוריית ההסכם ובקשות השדרוג. אין כאן סליקה: כל תשלום נרשם ידנית ("התקבל (נרשם על ידי
// Nuriel)"). שינוי באמצע תקופה: תאריך החידוש נשמר, וההפרש היחסי נרשם רק אם מסמנים.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
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
  Textarea,
} from "@/platform/ui";
import {
  platformBillingCard,
  platformBillingQuote,
  platformBillingRecordEntry,
  platformBillingRejectRequest,
  platformBillingRenew,
  platformBillingReverseEntry,
  platformBillingSaveAgreement,
} from "../billing.functions";
import {
  CATEGORY_LABELS,
  CYCLE_LABELS,
  ENGINE_LABELS,
  KIND_LABELS,
  METHOD_LABELS,
  REQUEST_STATUS_LABELS,
  VAT_MODE_LABELS,
  balanceText,
  daysLeftText,
  formatDate,
  formatMoney,
  israelToday,
  priceLine,
  errorMessage,
} from "../logic";
import type {
  BillingCard,
  BillingCycle,
  ChangeQuote,
  EntryCategory,
  LedgerEntry,
  PaymentMethod,
  UpgradeRequest,
  VatMode,
} from "../types";
import { ActionSheet, EntriesList, MoneyBreakdown, NativeSelect, Stat } from "./parts";

type SheetState =
  | { kind: "agreement"; request: UpgradeRequest | null }
  | { kind: "entry"; entryKind: "payment" | "charge" | "credit" }
  | { kind: "renew" }
  | { kind: "reverse"; entry: LedgerEntry }
  | { kind: "reject"; request: UpgradeRequest }
  | null;

export function BillingAdminCard(props: { tenantId: string; onChanged?: () => void }) {
  const [card, setCard] = useState<BillingCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);

  const load = useCallback(async () => {
    try {
      setCard(await platformBillingCard({ data: { tenantId: props.tenantId } }));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [props.tenantId]);
  useEffect(() => {
    void load();
  }, [load]);

  const done = (next: BillingCard, message: string) => {
    setCard(next);
    setSheet(null);
    toast.success(message);
    props.onChanged?.();
  };

  if (error) {
    return (
      <Card data-testid="billing-card">
        <CardContent className="pt-5 text-sm text-destructive" role="alert">
          {error}
        </CardContent>
      </Card>
    );
  }
  if (!card) {
    return (
      <Card data-testid="billing-card-loading">
        <CardContent className="flex items-center gap-2 pt-5 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> טוען את ההסכם והתשלומים…
        </CardContent>
      </Card>
    );
  }

  const a = card.agreement;
  const sub = card.subscription;
  const pending = card.requests.find((r) => r.status === "pending") ?? null;
  return (
    <Card data-testid="billing-card">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-lg">הסכם ותשלומים</CardTitle>
          <Badge variant="outline">{ENGINE_LABELS[card.engine]}</Badge>
          <Badge variant="secondary" data-testid="billing-card-active-plan">
            חבילה פעילה: {sub.plan_name}
          </Badge>
          {a?.special_price ? <Badge>מחיר מיוחד</Badge> : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ms-auto h-9"
            onClick={() => void load()}
            aria-label="רענון"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {card.business_name} ·{" "}
          {sub.status === "trialing" ? "בניסיון" : sub.active ? "פעיל" : "לא פעיל"}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {pending ? (
          <div
            className="flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm"
            data-testid="billing-card-request"
          >
            <p>
              <strong>בקשת שדרוג ממתינה:</strong> {pending.current_plan_name} ←{" "}
              {pending.requested_plan_name} ({CYCLE_LABELS[pending.requested_cycle]}), נשלחה ב-
              {formatDate(pending.created_at)}
              {pending.list_price_monthly !== null
                ? ` · מחירון ${formatMoney(pending.list_price_monthly)} לחודש`
                : ""}
              {pending.customer_note ? ` · "${pending.customer_note}"` : ""}
            </p>
            <p className="text-amber-900">החבילה הפעילה לא השתנתה ואין חיוב עד שתאשרו.</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                className="min-h-11"
                onClick={() => setSheet({ kind: "agreement", request: pending })}
                data-testid="billing-request-approve"
              >
                אישור וקביעת מחיר
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => setSheet({ kind: "reject", request: pending })}
                data-testid="billing-request-reject"
              >
                דחייה
              </Button>
            </div>
          </div>
        ) : null}
        {card.plan_mismatch ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm" role="status">
            החבילה הפעילה ({sub.plan_name}) שונה מהחבילה שבהסכם ({a?.plan_name}). היא תתעדכן בשמירת
            ההסכם עם "להחליף גם את החבילה הפעילה", או בחידוש הבא.
          </p>
        ) : null}
        {!a ? (
          <p
            className="rounded-md border bg-muted/40 p-3 text-sm"
            data-testid="billing-card-no-agreement"
          >
            אין עדיין הסכם ללקוח — הוא מוצג לפי המחירון. שום דבר לא נקבע אוטומטית ללקוחות קיימים.
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Stat
            label="מחיר מחירון (לחודש)"
            value={formatMoney(card.list_price_monthly)}
            testId="billing-card-list"
          />
          <Stat
            label="מחיר מוסכם (חודשי)"
            value={a ? priceLine(a.monthly) : "—"}
            hint={a && a.agreed_monthly === null ? "לפי המחירון" : undefined}
            testId="billing-card-monthly"
          />
          <Stat
            label="מחיר מוסכם (שנתי)"
            value={a ? priceLine(a.yearly) : "—"}
            hint={a && a.agreed_yearly === null ? "12 × החודשי" : undefined}
            testId="billing-card-yearly"
          />
          <Stat label="מחזור חיוב" value={a ? CYCLE_LABELS[a.billing_cycle] : "—"} />
          <Stat
            label="מע״מ"
            value={a ? `${VAT_MODE_LABELS[a.vat_mode]} · ${a.vat_rate}%` : "—"}
            testId="billing-card-vat"
          />
          <Stat label="תחילת הסכם" value={formatDate(a?.start_date)} />
          <Stat
            label={sub.renewal_kind === "trial" ? "סוף הניסיון" : "החידוש הבא"}
            value={sub.renewal_kind === "none" ? "ללא תאריך סיום" : formatDate(card.renewal.on)}
            hint={sub.renewal_kind === "none" ? undefined : daysLeftText(card.renewal.days_left)}
            testId="billing-card-renewal"
          />
          <Stat
            label="סכום צפוי בחידוש"
            value={priceLine(card.renewal.expected)}
            testId="billing-card-expected"
          />
          <Stat
            label="התחייבות"
            value={a?.commitment_months ? `${a.commitment_months} חודשים` : "—"}
            hint={a?.commitment_ends_on ? `עד ${formatDate(a.commitment_ends_on)}` : undefined}
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border p-3">
            <div className="mb-2 text-sm font-medium">דמי הקמה</div>
            <MoneyBreakdown
              dueLabel="סוכם"
              due={card.setup.due}
              paid={card.setup.paid}
              balance={card.setup.balance}
              testId="billing-card-setup"
            />
          </div>
          <div className="rounded-md border p-3">
            <div className="mb-2 text-sm font-medium">מנוי</div>
            <MoneyBreakdown
              dueLabel="נדרש לתשלום"
              due={card.subscription_money.due}
              paid={card.subscription_money.paid}
              balance={card.subscription_money.balance}
              testId="billing-card-subscription"
            />
          </div>
          <Stat
            label="סה״כ תשלומים שהתקבלו"
            value={formatMoney(card.total.paid)}
            testId="billing-card-paid"
            tone="good"
          />
          <Stat
            label="יתרה כוללת"
            value={balanceText(card.total.balance)}
            testId="billing-card-balance"
          />
        </div>

        {a?.internal_note ? (
          <div
            className="rounded-md border border-dashed p-3 text-sm"
            data-testid="billing-card-note"
          >
            <div className="text-xs text-muted-foreground">הערה פנימית (רק Nuriel רואה)</div>
            <p className="mt-1 whitespace-pre-line">{a.internal_note}</p>
          </div>
        ) : null}
        {a?.terms ? (
          <div className="rounded-md border p-3 text-sm">
            <div className="text-xs text-muted-foreground">תנאי ההסכם (בעל העסק רואה)</div>
            <p className="mt-1 whitespace-pre-line">{a.terms}</p>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className="min-h-11"
            onClick={() => setSheet({ kind: "agreement", request: null })}
            data-testid="billing-edit-agreement"
          >
            {a ? "שינוי הסכם" : "קביעת הסכם"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => setSheet({ kind: "entry", entryKind: "payment" })}
            data-testid="billing-record-payment"
          >
            רישום תשלום שהתקבל
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => setSheet({ kind: "entry", entryKind: "charge" })}
            data-testid="billing-record-charge"
          >
            רישום חיוב / זיכוי
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={!a || sub.renewal_kind === "none" || sub.system}
            onClick={() => setSheet({ kind: "renew" })}
            data-testid="billing-renew"
          >
            חידוש לתקופה הבאה
          </Button>
        </div>

        <section className="flex flex-col gap-2" aria-labelledby="bc-entries">
          <h3 id="bc-entries" className="text-sm font-bold">
            יומן חיובים ותשלומים
          </h3>
          <EntriesList
            entries={card.entries}
            internal
            onReverse={(entry) => setSheet({ kind: "reverse", entry })}
          />
        </section>

        {card.history.length > 0 ? (
          <section className="flex flex-col gap-2" aria-labelledby="bc-history">
            <h3 id="bc-history" className="text-sm font-bold">
              היסטוריית ההסכם
            </h3>
            <ul className="flex flex-col gap-1 text-sm" data-testid="billing-history">
              {card.history.map((h) => (
                <li key={h.id} className="rounded-md border p-2">
                  <strong>גרסה {h.version}</strong> · {h.plan_name} ·{" "}
                  {CYCLE_LABELS[h.billing_cycle]} · {priceLine(h.cycle_price)} · מ-
                  {formatDate(h.effective_on)}
                  {h.superseded_at ? " · הוחלפה" : " · נוכחית"}
                  {h.reason === "upgrade" ? " · אישור בקשת שדרוג" : ""}
                  {h.created_by_email ? ` · ${h.created_by_email}` : ""}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {card.requests.filter((r) => r.status !== "pending").length > 0 ? (
          <section className="flex flex-col gap-2" aria-labelledby="bc-requests">
            <h3 id="bc-requests" className="text-sm font-bold">
              בקשות קודמות
            </h3>
            <ul className="flex flex-col gap-1 text-sm">
              {card.requests
                .filter((r) => r.status !== "pending")
                .map((r) => (
                  <li key={r.id} className="rounded-md border p-2">
                    {formatDate(r.created_at)} · {r.requested_plan_name} (
                    {CYCLE_LABELS[r.requested_cycle]}) · {REQUEST_STATUS_LABELS[r.status]}
                    {r.decision_message ? ` — ${r.decision_message}` : ""}
                  </li>
                ))}
            </ul>
          </section>
        ) : null}
      </CardContent>

      {sheet?.kind === "agreement" ? (
        <AgreementSheet
          card={card}
          request={sheet.request}
          onClose={() => setSheet(null)}
          onSaved={(next, message) => done(next, message)}
        />
      ) : null}
      {sheet?.kind === "entry" ? (
        <EntrySheet
          card={card}
          initialKind={sheet.entryKind}
          onClose={() => setSheet(null)}
          onSaved={(next) => done(next, "נרשם ביומן")}
        />
      ) : null}
      {sheet?.kind === "renew" ? (
        <RenewSheet
          card={card}
          onClose={() => setSheet(null)}
          onSaved={(next) => done(next, "התקופה הבאה נרשמה")}
        />
      ) : null}
      {sheet?.kind === "reverse" ? (
        <ReverseSheet
          entry={sheet.entry}
          onClose={() => setSheet(null)}
          onSaved={(next) => done(next, "הרישום בוטל (המקור נשמר)")}
        />
      ) : null}
      {sheet?.kind === "reject" ? (
        <RejectSheet
          request={sheet.request}
          onClose={() => setSheet(null)}
          onSaved={async () => {
            setSheet(null);
            toast.success("הבקשה נדחתה");
            await load();
            props.onChanged?.();
          }}
        />
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------- הסכם

function numText(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function AgreementSheet(props: {
  card: BillingCard;
  request: UpgradeRequest | null;
  onClose: () => void;
  onSaved: (card: BillingCard, message: string) => void;
}) {
  const { card, request } = props;
  const a = card.agreement;
  const plans = card.plans.filter(
    (p) => p.code === a?.plan || p.code === request?.requested_plan || p.list_monthly !== null,
  );
  const [plan, setPlan] = useState(request?.requested_plan ?? a?.plan ?? plans[0]?.code ?? "");
  const [cycle, setCycle] = useState<BillingCycle>(
    request?.requested_cycle ?? a?.billing_cycle ?? "monthly",
  );
  const [monthly, setMonthly] = useState(request ? "" : numText(a?.agreed_monthly));
  const [yearly, setYearly] = useState(request ? "" : numText(a?.agreed_yearly));
  const listSetup = card.plans.find((p) => p.code === plan)?.setup_fee ?? null;
  const [setup, setSetup] = useState(
    a
      ? numText(a.setup_fee ? (a.vat_mode === "excluded" ? a.setup_fee.net : a.setup_fee.gross) : 0)
      : numText(listSetup ?? 0),
  );
  const [commitment, setCommitment] = useState(numText(a?.commitment_months));
  const [start, setStart] = useState(a?.start_date ?? "");
  const [vatMode, setVatMode] = useState<VatMode>(a?.vat_mode ?? "excluded");
  const [vatRate, setVatRate] = useState(numText(a?.vat_rate ?? card.default_vat_rate));
  const [terms, setTerms] = useState(a?.terms ?? "");
  const [note, setNote] = useState(a?.internal_note ?? "");
  const [requestMessage, setRequestMessage] = useState("");
  const planChanges = plan !== card.subscription.plan && card.subscription.renewal_kind !== "trial";
  const [applyPlan, setApplyPlan] = useState(true);
  const [recordDifference, setRecordDifference] = useState(false);
  const [quote, setQuote] = useState<ChangeQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const input = useMemo(
    () => ({
      plan,
      billing_cycle: cycle,
      agreed_monthly: monthly,
      agreed_yearly: yearly,
      setup_fee: setup,
      commitment_months: commitment,
      start_date: start,
      vat_mode: vatMode,
      vat_rate: vatRate,
      terms,
      internal_note: note,
    }),
    [plan, cycle, monthly, yearly, setup, commitment, start, vatMode, vatRate, terms, note],
  );
  // שינוי בטופס — ההצעה הקודמת כבר לא מתאימה
  useEffect(() => {
    setQuote(null);
    setRecordDifference(false);
  }, [input]);

  const runQuote = async () => {
    setQuoting(true);
    setError(null);
    try {
      setQuote(
        await platformBillingQuote({ data: { tenantId: card.tenant_id, agreement: input } }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setQuoting(false);
    }
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await platformBillingSaveAgreement({
        data: {
          tenantId: card.tenant_id,
          agreement: input,
          expectedVersion: a?.version ?? 0,
          applyPlan: planChanges && applyPlan,
          recordDifference: recordDifference && quote !== null && quote.kind !== "none",
          requestId: request?.id ?? null,
          requestMessage,
        },
      });
      props.onSaved(
        result.card,
        request
          ? "הבקשה אושרה וההסכם עודכן"
          : result.entry_id
            ? "ההסכם נשמר וההפרש נרשם ביומן"
            : "ההסכם נשמר",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const listOf = (code: string) => card.plans.find((p) => p.code === code)?.list_monthly ?? null;
  return (
    <ActionSheet
      open
      title={request ? "אישור בקשת שדרוג" : a ? `שינוי הסכם (גרסה ${a.version + 1})` : "קביעת הסכם"}
      description="כל שמירה יוצרת גרסה חדשה; הגרסה הקודמת נשמרת. המחירון לא משתנה. אין חיוב אוטומטי."
      submitLabel={request ? "אישור ושמירה" : "שמירת הסכם"}
      busy={busy}
      error={error}
      onSubmit={() => void save()}
      onClose={props.onClose}
      testId="billing-agreement-sheet"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="ag-plan">חבילה</Label>
          <NativeSelect
            id="ag-plan"
            value={plan}
            onChange={setPlan}
            options={plans.map((p) => ({
              value: p.code,
              label: `${p.name}${p.list_monthly !== null ? ` — מחירון ${formatMoney(p.list_monthly)} לחודש` : " — בלי מחיר במחירון"}`,
            }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ag-cycle">מחזור חיוב</Label>
          <NativeSelect
            id="ag-cycle"
            value={cycle}
            onChange={(v) => setCycle(v === "yearly" ? "yearly" : "monthly")}
            options={[
              { value: "monthly", label: CYCLE_LABELS.monthly },
              { value: "yearly", label: CYCLE_LABELS.yearly },
            ]}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ag-vat-mode">מע״מ</Label>
          <NativeSelect
            id="ag-vat-mode"
            value={vatMode}
            onChange={(v) => setVatMode(v === "included" ? "included" : "excluded")}
            options={[
              { value: "excluded", label: VAT_MODE_LABELS.excluded },
              { value: "included", label: VAT_MODE_LABELS.included },
            ]}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ag-monthly">מחיר מוסכם לחודש (₪)</Label>
          <Input
            id="ag-monthly"
            inputMode="decimal"
            dir="ltr"
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
            placeholder={listOf(plan) !== null ? `מחירון: ${listOf(plan)}` : "חובה"}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ag-yearly">מחיר מוסכם לשנה (₪, לא חובה)</Label>
          <Input
            id="ag-yearly"
            inputMode="decimal"
            dir="ltr"
            value={yearly}
            onChange={(e) => setYearly(e.target.value)}
            placeholder="ריק = 12 × החודשי"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ag-setup">דמי הקמה מוסכמים (₪)</Label>
          <Input
            id="ag-setup"
            inputMode="decimal"
            dir="ltr"
            value={setup}
            onChange={(e) => setSetup(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ag-vat-rate">שיעור מע״מ (%)</Label>
          <Input
            id="ag-vat-rate"
            inputMode="decimal"
            dir="ltr"
            value={vatRate}
            onChange={(e) => setVatRate(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ag-start">תאריך תחילת ההסכם</Label>
          <Input
            id="ag-start"
            type="date"
            dir="ltr"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ag-commit">התחייבות (חודשים, לא חובה)</Label>
          <Input
            id="ag-commit"
            inputMode="numeric"
            dir="ltr"
            value={commitment}
            onChange={(e) => setCommitment(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="ag-terms">תנאי ההסכם (בעל העסק רואה)</Label>
          <Textarea
            id="ag-terms"
            rows={3}
            maxLength={2000}
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="ag-note">הערה פנימית (רק Nuriel רואה)</Label>
          <Textarea
            id="ag-note"
            rows={2}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {request ? (
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="ag-message">הודעה ללקוח על האישור (לא חובה)</Label>
            <Textarea
              id="ag-message"
              rows={2}
              maxLength={500}
              value={requestMessage}
              onChange={(e) => setRequestMessage(e.target.value)}
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
        <div className="font-medium">שינוי באמצע תקופה</div>
        <p className="text-muted-foreground">
          תאריך החידוש ({formatDate(card.renewal.on)}) לא משתנה והזמן ששולם נשמר. ההפרש היחסי מוצג
          כאן לאישור — ונרשם רק אם מסמנים.
        </p>
        <div>
          <Button
            type="button"
            variant="outline"
            className="min-h-10"
            disabled={quoting}
            onClick={() => void runQuote()}
            data-testid="billing-quote"
          >
            {quoting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            חישוב ההפרש
          </Button>
        </div>
        {quote ? (
          <p data-testid="billing-quote-result">
            {quote.kind === "none"
              ? quote.reason === "trial"
                ? "הלקוח בניסיון — אין הפרש. המחיר החדש יחול מהחידוש הראשון."
                : quote.reason === "same_price"
                  ? "אין הפרש במחיר."
                  : "אין תקופה פעילה לחישוב הפרש."
              : `${quote.kind === "charge" ? "הפרש לחיוב" : "זיכוי"}: ${formatMoney(Math.abs(quote.difference))} — ${quote.days_left} ימים עד החידוש, ${formatMoney(quote.old_cycle_price)} ← ${formatMoney(quote.new_cycle_price)} למחזור (כולל מע״מ, אם יש).`}
          </p>
        ) : null}
        {quote && quote.kind !== "none" ? (
          <label className="flex items-center gap-2">
            <Checkbox
              checked={recordDifference}
              onCheckedChange={(v) => setRecordDifference(v === true)}
              data-testid="billing-record-difference"
            />
            לרשום את ה{quote.kind === "charge" ? "הפרש כחיוב" : "זיכוי"} ביומן (בלי גבייה)
          </label>
        ) : null}
        {planChanges ? (
          <label className="flex items-center gap-2">
            <Checkbox
              checked={applyPlan}
              onCheckedChange={(v) => setApplyPlan(v === true)}
              data-testid="billing-apply-plan"
            />
            להחליף גם את החבילה הפעילה עכשיו ({card.subscription.plan_name} ←{" "}
            {card.plans.find((p) => p.code === plan)?.name ?? plan})
          </label>
        ) : card.subscription.renewal_kind === "trial" && plan !== card.subscription.plan ? (
          <p className="text-muted-foreground">הלקוח בניסיון: החבילה תיכנס בחידוש הראשון.</p>
        ) : null}
      </div>
    </ActionSheet>
  );
}

// ---------------------------------------------------------------- רישום ביומן

function EntrySheet(props: {
  card: BillingCard;
  initialKind: "payment" | "charge" | "credit";
  onClose: () => void;
  onSaved: (card: BillingCard) => void;
}) {
  const [kind, setKind] = useState<"payment" | "charge" | "credit">(props.initialKind);
  const [category, setCategory] = useState<EntryCategory>("subscription");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");
  const [date, setDate] = useState(israelToday());
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [vatRate, setVatRate] = useState(
    String(props.card.agreement?.vat_rate ?? props.card.default_vat_rate),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      props.onSaved(
        await platformBillingRecordEntry({
          data: {
            tenantId: props.card.tenant_id,
            entry: {
              kind,
              category,
              amount,
              method: kind === "payment" ? method : null,
              occurred_on: date,
              description,
              reference,
              internal_note: note,
              vat_rate: vatRate,
            },
          },
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ActionSheet
      open
      title={
        kind === "payment" ? "רישום תשלום שהתקבל" : kind === "charge" ? "רישום חיוב" : "רישום זיכוי"
      }
      description="רישום ידני ביומן — לא גבייה. תשלום יוצג ללקוח כ״התקבל (נרשם על ידי Nuriel)״. טעות מתקנים בביטול רישום."
      submitLabel="רישום"
      busy={busy}
      error={error}
      onSubmit={() => void save()}
      onClose={props.onClose}
      testId="billing-entry-sheet"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="en-kind">סוג</Label>
          <NativeSelect
            id="en-kind"
            value={kind}
            onChange={(v) =>
              setKind(v === "charge" ? "charge" : v === "credit" ? "credit" : "payment")
            }
            options={(["payment", "charge", "credit"] as const).map((k) => ({
              value: k,
              label: KIND_LABELS[k],
            }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="en-category">על מה</Label>
          <NativeSelect
            id="en-category"
            value={category}
            onChange={(v) =>
              setCategory(v === "setup" ? "setup" : v === "other" ? "other" : "subscription")
            }
            options={(["subscription", "setup", "other"] as const).map((c) => ({
              value: c,
              label: CATEGORY_LABELS[c],
            }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="en-amount">סכום כולל (₪, כולל מע״מ אם יש)</Label>
          <Input
            id="en-amount"
            inputMode="decimal"
            dir="ltr"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="en-vat">שיעור מע״מ בסכום (%)</Label>
          <Input
            id="en-vat"
            inputMode="decimal"
            dir="ltr"
            value={vatRate}
            onChange={(e) => setVatRate(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="en-date">{kind === "payment" ? "תאריך התשלום" : "תאריך"}</Label>
          <Input
            id="en-date"
            type="date"
            dir="ltr"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        {kind === "payment" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="en-method">אמצעי תשלום</Label>
            <NativeSelect
              id="en-method"
              value={method}
              onChange={(v) => setMethod(v as PaymentMethod)}
              options={(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => ({
                value: m,
                label: METHOD_LABELS[m],
              }))}
            />
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="en-desc">תיאור (הלקוח רואה)</Label>
          <Input
            id="en-desc"
            maxLength={200}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="en-ref">אסמכתה (פנימי)</Label>
          <Input
            id="en-ref"
            maxLength={120}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="en-note">הערה פנימית</Label>
          <Input
            id="en-note"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>
    </ActionSheet>
  );
}

// ---------------------------------------------------------------- חידוש

function addCycle(date: string, cycle: BillingCycle): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (cycle === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function RenewSheet(props: {
  card: BillingCard;
  onClose: () => void;
  onSaved: (card: BillingCard) => void;
}) {
  const { card } = props;
  const a = card.agreement!;
  const today = israelToday();
  const from =
    card.renewal.on &&
    card.renewal.on > today &&
    card.subscription.status !== "canceled" &&
    card.subscription.status !== "expired"
      ? card.renewal.on
      : today;
  const to = addCycle(from, a.billing_cycle);
  const amountDue = a.cycle_price?.gross ?? 0;
  const [recordPayment, setRecordPayment] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [amount, setAmount] = useState(String(amountDue));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      props.onSaved(
        await platformBillingRenew({
          data: {
            tenantId: card.tenant_id,
            expectedRenewal: card.renewal.on,
            recordPayment,
            method,
            reference,
            paidOn,
            amount,
          },
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ActionSheet
      open
      title="חידוש לתקופה הבאה"
      description="התקופה הבאה מתחילה בסוף התקופה הנוכחית (או בסוף הניסיון), כך שהזמן ששולם לא אובד. נרשם חיוב על התקופה — בלי גבייה."
      submitLabel="חידוש"
      busy={busy}
      error={error}
      onSubmit={() => void save()}
      onClose={props.onClose}
      testId="billing-renew-sheet"
    >
      <dl className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">חבילה</dt>
          <dd className="font-medium">{a.plan_name}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">מחזור</dt>
          <dd className="font-medium">{CYCLE_LABELS[a.billing_cycle]}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">תקופה (בערך)</dt>
          <dd className="font-medium" data-testid="billing-renew-period">
            {formatDate(from)} – {formatDate(to)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">חיוב על התקופה</dt>
          <dd className="font-medium">{priceLine(a.cycle_price)}</dd>
        </div>
      </dl>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={recordPayment}
          onCheckedChange={(v) => setRecordPayment(v === true)}
          data-testid="billing-renew-paid"
        />
        התשלום על התקופה כבר התקבל — לרשום גם אותו
      </label>
      {recordPayment ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rn-amount">סכום שהתקבל (₪)</Label>
            <Input
              id="rn-amount"
              inputMode="decimal"
              dir="ltr"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rn-method">אמצעי תשלום</Label>
            <NativeSelect
              id="rn-method"
              value={method}
              onChange={(v) => setMethod(v as PaymentMethod)}
              options={(Object.keys(METHOD_LABELS) as PaymentMethod[]).map((m) => ({
                value: m,
                label: METHOD_LABELS[m],
              }))}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rn-date">תאריך התשלום</Label>
            <Input
              id="rn-date"
              type="date"
              dir="ltr"
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rn-ref">אסמכתה (פנימי)</Label>
            <Input
              id="rn-ref"
              maxLength={120}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
        </div>
      ) : null}
    </ActionSheet>
  );
}

// ---------------------------------------------------------------- ביטול רישום / דחיית בקשה

function ReverseSheet(props: {
  entry: LedgerEntry;
  onClose: () => void;
  onSaved: (card: BillingCard) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const e = props.entry;
  return (
    <ActionSheet
      open
      title="ביטול רישום"
      description={`${KIND_LABELS[e.kind]} של ${formatMoney(e.amount)} מ-${formatDate(e.occurred_on)}. השורה המקורית נשארת ביומן ומסומנת "בוטל"; נוספת שורת ביטול.`}
      submitLabel="ביטול הרישום"
      busy={busy}
      error={error}
      submitDisabled={reason.trim().length < 2}
      onSubmit={async () => {
        setBusy(true);
        setError(null);
        try {
          props.onSaved(await platformBillingReverseEntry({ data: { entryId: e.id, reason } }));
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
      onClose={props.onClose}
      testId="billing-reverse-sheet"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rv-reason">סיבת הביטול (פנימי)</Label>
        <Textarea
          id="rv-reason"
          rows={2}
          maxLength={500}
          required
          value={reason}
          onChange={(ev) => setReason(ev.target.value)}
        />
      </div>
    </ActionSheet>
  );
}

function RejectSheet(props: {
  request: UpgradeRequest;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <ActionSheet
      open
      title="דחיית בקשת שדרוג"
      description={`הבקשה ל${props.request.requested_plan_name} תיסגר. החבילה וההסכם לא משתנים.`}
      submitLabel="דחייה"
      busy={busy}
      error={error}
      onSubmit={async () => {
        setBusy(true);
        setError(null);
        try {
          await platformBillingRejectRequest({ data: { requestId: props.request.id, message } });
          await props.onSaved();
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
      onClose={props.onClose}
      testId="billing-reject-sheet"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rj-message">הודעה לבעל העסק (הוא רואה)</Label>
        <Textarea
          id="rj-message"
          rows={2}
          maxLength={500}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>
    </ActionSheet>
  );
}
