// Billing & Agreements — "החבילה והתשלומים שלי" לבעל העסק (חנות: "המנוי שלי"; צימר: לוח הבקרה). רק
// לבעלים (המסד מסרב לכל אחד אחר). כל המספרים מהמסד: מחיר מחירון מול המחיר המוסכם, מע"מ, דמי הקמה
// (סוכם / התקבל / יתרה), מנוי (נדרש / התקבל / יתרה), סה"כ ששולם, החידוש הבא וסכום החידוש הצפוי.
// תשלום שנרשם בידי Nuriel מוצג "התקבל (נרשם על ידי Nuriel)" — לא "אושר".
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Label,
  Textarea,
} from "@/platform/ui";
import {
  myBillingCancelRequest,
  myBillingRequestUpgrade,
  myBillingSummary,
} from "../billing.functions";
import {
  CYCLE_LABELS,
  REQUEST_STATUS_LABELS,
  VAT_MODE_LABELS,
  balanceText,
  daysLeftText,
  formatDate,
  formatMoney,
  priceLine,
  errorMessage,
} from "../logic";
import type { BillingCycle, BillingSummary } from "../types";
import { EntriesList, MoneyBreakdown, NativeSelect, Stat } from "./parts";

export function MyBillingCard(props: { title?: string } = {}) {
  const [data, setData] = useState<BillingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await myBillingSummary());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <Card data-testid="my-billing">
        <CardContent className="pt-5 text-sm text-destructive" role="alert">
          {error}
        </CardContent>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card data-testid="my-billing-loading">
        <CardContent className="flex items-center gap-2 pt-5 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> טוען את פרטי החבילה…
        </CardContent>
      </Card>
    );
  }
  return <Summary data={data} title={props.title} onChanged={load} />;
}

function Summary({
  data,
  title,
  onChanged,
}: {
  data: BillingSummary;
  title?: string | undefined;
  onChanged: () => Promise<void>;
}) {
  const a = data.agreement;
  const sub = data.subscription;
  const renewal = data.renewal;
  const showSetup = data.setup.due > 0 || data.setup.paid > 0;
  return (
    <Card data-testid="my-billing">
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-lg">{title ?? "החבילה והתשלומים"}</CardTitle>
          <Badge variant="secondary" data-testid="my-billing-plan">
            {a ? a.plan_name : sub.plan_name}
          </Badge>
          {a?.special_price ? <Badge data-testid="my-billing-special">מחיר מיוחד</Badge> : null}
        </div>
        {sub.renewal_kind === "trial" ? (
          <p className="text-sm text-muted-foreground">
            תקופת ניסיון עד {formatDate(renewal.on)} ({daysLeftText(renewal.days_left)}).
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {!a ? (
          <p
            className="rounded-md border bg-muted/40 p-3 text-sm"
            data-testid="my-billing-no-agreement"
          >
            עדיין לא נקבע הסכם אישי. המחירים כאן לפי המחירון; ההסכם יופיע כאן אחרי שנקבע אותו יחד.
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Stat
            label="מחיר מחירון (לחודש)"
            value={formatMoney(data.list_price_monthly)}
            hint={
              a && a.list_price_monthly !== data.list_price_monthly
                ? `בזמן ההסכם: ${formatMoney(a.list_price_monthly)}`
                : undefined
            }
            testId="my-billing-list"
          />
          <Stat
            label={a ? `המחיר המוסכם שלך (${CYCLE_LABELS[a.billing_cycle]})` : "המחיר שלך"}
            value={a ? priceLine(a.cycle_price) : "לפי המחירון"}
            hint={
              a && a.billing_cycle === "yearly" && a.monthly
                ? `לחודש: ${priceLine(a.monthly)}`
                : undefined
            }
            testId="my-billing-agreed"
          />
          <Stat
            label="מע״מ"
            value={
              a
                ? a.vat_rate > 0
                  ? `${VAT_MODE_LABELS[a.vat_mode]} · ${a.vat_rate}%`
                  : "ללא מע״מ"
                : "—"
            }
            testId="my-billing-vat"
          />
          <Stat
            label={sub.renewal_kind === "trial" ? "סוף תקופת הניסיון" : "החידוש הבא"}
            value={sub.renewal_kind === "none" ? "ללא תאריך סיום" : formatDate(renewal.on)}
            hint={sub.renewal_kind === "none" ? undefined : daysLeftText(renewal.days_left)}
            testId="my-billing-renewal"
            tone={
              renewal.days_left !== null && renewal.days_left <= 7 && sub.renewal_kind !== "none"
                ? "warn"
                : "default"
            }
          />
          <Stat
            label="סכום צפוי בחידוש"
            value={renewal.expected ? priceLine(renewal.expected) : "—"}
            hint={
              renewal.basis === "list"
                ? "לפי המחירון (אין הסכם)"
                : renewal.basis === "agreement"
                  ? `לפי ההסכם, ${CYCLE_LABELS[renewal.cycle]}`
                  : undefined
            }
            testId="my-billing-expected"
          />
          <Stat label="תחילת המנוי" value={formatDate(a?.start_date)} testId="my-billing-start" />
          {a?.commitment_months ? (
            <Stat
              label="תקופת התחייבות"
              value={`${a.commitment_months} חודשים`}
              hint={a.commitment_ends_on ? `עד ${formatDate(a.commitment_ends_on)}` : undefined}
            />
          ) : null}
        </div>

        <section className="flex flex-col gap-2" aria-labelledby="mb-money">
          <h3 id="mb-money" className="text-sm font-bold">
            מה סוכם, מה התקבל ומה היתרה
          </h3>
          {showSetup ? (
            <div className="rounded-md border p-3">
              <div className="mb-2 text-sm font-medium">דמי הקמה (חד-פעמי)</div>
              <MoneyBreakdown
                dueLabel="סוכם"
                due={data.setup.due}
                paid={data.setup.paid}
                balance={data.setup.balance}
                testId="my-billing-setup"
              />
            </div>
          ) : null}
          <div className="rounded-md border p-3">
            <div className="mb-2 text-sm font-medium">מנוי</div>
            <MoneyBreakdown
              dueLabel="נדרש לתשלום"
              due={data.subscription_money.due}
              paid={data.subscription_money.paid}
              balance={data.subscription_money.balance}
              testId="my-billing-subscription"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat
              label="סה״כ שולם עד היום"
              value={formatMoney(data.total.paid)}
              testId="my-billing-paid"
              tone="good"
            />
            <Stat
              label="יתרה כוללת"
              value={balanceText(data.total.balance)}
              testId="my-billing-balance"
              tone={data.total.balance > 0.004 ? "warn" : "default"}
            />
          </div>
        </section>

        {a?.terms ? (
          <section aria-labelledby="mb-terms">
            <h3 id="mb-terms" className="text-sm font-bold">
              תנאי ההסכם
            </h3>
            <p className="mt-1 whitespace-pre-line text-sm" data-testid="my-billing-terms">
              {a.terms}
            </p>
          </section>
        ) : null}

        <section className="flex flex-col gap-2" aria-labelledby="mb-entries">
          <h3 id="mb-entries" className="text-sm font-bold">
            חיובים ותשלומים
          </h3>
          <EntriesList entries={data.entries} />
          <p className="text-xs text-muted-foreground">
            אין כאן סליקה: תשלום מופיע אחרי שצוות Nuriel רשם שהוא התקבל.
          </p>
        </section>

        <UpgradeSection data={data} onChanged={onChanged} />
      </CardContent>
    </Card>
  );
}

function UpgradeSection({
  data,
  onChanged,
}: {
  data: BillingSummary;
  onChanged: () => Promise<void>;
}) {
  const current = data.agreement?.plan ?? data.subscription.plan;
  const pending = data.requests.find((r) => r.status === "pending") ?? null;
  const lastDecided =
    data.requests.find((r) => r.status === "approved" || r.status === "rejected") ?? null;
  const options = useMemo(
    () => data.plans.filter((p) => p.published && p.code !== current),
    [data.plans, current],
  );
  const [plan, setPlan] = useState(options[0]?.code ?? "");
  const [cycle, setCycle] = useState<BillingCycle>(data.agreement?.billing_cycle ?? "monthly");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!options.some((o) => o.code === plan)) setPlan(options[0]?.code ?? "");
  }, [options, plan]);

  const send = async () => {
    setBusy(true);
    try {
      await myBillingRequestUpgrade({ data: { plan, cycle, note } });
      toast.success("הבקשה נשלחה. החבילה לא משתנה עד שנאשר אותה.");
      setNote("");
      await onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await myBillingCancelRequest({ data: { requestId: pending.id } });
      toast.success("הבקשה בוטלה");
      await onChanged();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-3 rounded-md border p-3" aria-labelledby="mb-upgrade">
      <h3 id="mb-upgrade" className="text-sm font-bold">
        שדרוג או שינוי חבילה
      </h3>
      {pending ? (
        <div className="flex flex-col gap-2 text-sm" data-testid="my-billing-request-pending">
          <p>
            בקשה לחבילת <strong>{pending.requested_plan_name}</strong> (
            {CYCLE_LABELS[pending.requested_cycle]}) נשלחה ב-
            {formatDate(pending.created_at)} — {REQUEST_STATUS_LABELS.pending}.
          </p>
          <p className="text-muted-foreground">
            החבילה הנוכחית שלך לא משתנה ולא יבוצע שום חיוב עד שנאשר את הבקשה.
          </p>
          <div>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={busy}
              onClick={() => void cancel()}
            >
              ביטול הבקשה
            </Button>
          </div>
        </div>
      ) : (
        <>
          {lastDecided ? (
            <p className="text-sm" data-testid="my-billing-request-last">
              הבקשה האחרונה ({lastDecided.requested_plan_name}):{" "}
              {REQUEST_STATUS_LABELS[lastDecided.status]}
              {lastDecided.decision_message ? ` — ${lastDecided.decision_message}` : ""}
            </p>
          ) : null}
          {options.length === 0 ? (
            <p className="text-sm text-muted-foreground">אין כרגע חבילה אחרת להציע.</p>
          ) : (
            <form
              className="grid gap-3 sm:grid-cols-2"
              data-testid="my-billing-request-form"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mb-plan">החבילה המבוקשת</Label>
                <NativeSelect
                  id="mb-plan"
                  value={plan}
                  onChange={setPlan}
                  options={options.map((o) => ({
                    value: o.code,
                    label: `${o.name}${o.list_monthly !== null ? ` — ${formatMoney(o.list_monthly)} לחודש במחירון` : ""}`,
                  }))}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="mb-cycle">מחזור חיוב</Label>
                <NativeSelect
                  id="mb-cycle"
                  value={cycle}
                  onChange={(v) => setCycle(v === "yearly" ? "yearly" : "monthly")}
                  options={[
                    { value: "monthly", label: CYCLE_LABELS.monthly },
                    { value: "yearly", label: CYCLE_LABELS.yearly },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="mb-note">הערה (לא חובה)</Label>
                <Textarea
                  id="mb-note"
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                שליחת הבקשה לא מחייבת ולא משנה את החבילה. צוות Nuriel יחזור אליך עם הצעה, ורק אחרי
                האישור ההסכם והחבילה יתעדכנו. תאריך החידוש נשמר, והזמן ששולם לא אובד.
              </p>
              <div className="sm:col-span-2">
                <Button type="submit" className="min-h-11" disabled={busy || !plan}>
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                  שליחת בקשה
                </Button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
