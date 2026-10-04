import { useEffect, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CalendarPlus, Crown, Loader2, Package, Receipt, Wallet } from "lucide-react";
import { toast } from "sonner";
import {
  platformBillingHistory,
  platformExtendTrial,
  platformRecordPayment,
} from "@/lib/billing.functions";
import {
  BILLING_KIND_LABELS,
  PAYMENT_METHOD_LABELS,
  PLAN_LABELS,
  formatDate,
  formatShekels,
  planBadge,
  remainingLabel,
  subscriptionStateFrom,
  type BillingEntry,
  type PaymentMethod,
  type SubscriptionState,
} from "@/lib/subscription";
import type { Store } from "@/components/platform/StoresTable";
import { usePlanCatalog } from "@/hooks/usePlanCatalog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** מצב המנוי של שורה ברשימת החנויות (platform_list_tenants) */
export function storeSubscription(store: Store): SubscriptionState {
  return subscriptionStateFrom(
    {
      plan_type: store.sub_plan,
      status: store.sub_status,
      trial_ends_at: store.sub_trial_ends_at,
      current_period_end: store.sub_period_end,
    },
    store.is_default,
  );
}

const BADGE_TONE = {
  trial: "border-sky-300 bg-sky-50 text-sky-800",
  basic: "border-slate-300 bg-slate-50 text-slate-800",
  premium: "border-amber-300 bg-amber-50 text-amber-900",
  expired: "border-destructive/50 bg-destructive/10 text-destructive",
} as const;

/** תא "מנוי" בטבלת החנויות: תג החבילה + כמה זמן נשאר */
export function SubscriptionCell({ store }: { store: Store }) {
  const state = storeSubscription(store);
  const badge = planBadge(state);
  return (
    <div className="space-y-1">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold",
          BADGE_TONE[badge.tone],
        )}
      >
        {state.plan === "premium" && state.active && (
          <Crown className="size-3" aria-hidden="true" />
        )}
        {badge.label}
      </span>
      <div className="text-xs text-muted-foreground">
        {state.endsAt ? (
          <>
            {remainingLabel(state)}
            <br />
            עד {formatDate(state.endsAt)}
          </>
        ) : (
          "ללא תפוגה"
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// הארכת ניסיון
// ------------------------------------------------------------

export function ExtendTrialDialog({
  store,
  onClose,
  onDone,
}: {
  store: Store | null;
  onClose: () => void;
  onDone: (store: Store, state: SubscriptionState) => void;
}) {
  const extend = useServerFn(platformExtendTrial);
  const [days, setDays] = useState("14");
  const [busy, setBusy] = useState(false);
  const state = store ? storeSubscription(store) : null;
  const trial = state?.plan === "trial";

  useEffect(() => {
    if (store) setDays("14");
  }, [store]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!store) return;
    setBusy(true);
    try {
      const next = await extend({ data: { tenantId: store.id, days: Number(days) } });
      toast.success(`"${store.name}" — ${remainingLabel(next)} (עד ${formatDate(next.endsAt)})`);
      onDone(store, next);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ההארכה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={store !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl" className="sm:max-w-md">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="size-5 text-primary" aria-hidden="true" />
            {trial ? "הארכת ניסיון" : "הארכת התקופה"} — {store?.name}
          </DialogTitle>
          <DialogDescription>
            {state
              ? `${PLAN_LABELS[state.plan]} · ${remainingLabel(state)}${state.endsAt ? ` (עד ${formatDate(state.endsAt)})` : ""}. הימים נוספים מהיום או מסוף התקופה — המאוחר מביניהם.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="extend-days">כמה ימים להוסיף</Label>
            <Input
              id="extend-days"
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              required
              value={days}
              onChange={(event) => setDays(event.target.value)}
              className="w-32"
            />
            <div className="flex flex-wrap gap-2 pt-1">
              {[7, 14, 30, 60].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setDays(String(n))}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium",
                    days === String(n)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-secondary",
                  )}
                >
                  +{n} ימים
                </button>
              ))}
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit" disabled={busy}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CalendarPlus className="size-4" />
              )}
              הארכה
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              ביטול
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------
// תיעוד תשלום
// ------------------------------------------------------------

export function RecordPaymentDialog({
  store,
  onClose,
  onDone,
}: {
  store: Store | null;
  onClose: () => void;
  onDone: (store: Store, state: SubscriptionState) => void;
}) {
  const record = useServerFn(platformRecordPayment);
  // המחיר החודשי — מ"חבילות ומחירים" (חלק 14)
  const { catalog } = usePlanCatalog();
  const monthlyPrice = (option: "basic" | "premium") => catalog.plans[option].monthlyPrice;
  const [plan, setPlan] = useState<"basic" | "premium">("premium");
  const [months, setMonths] = useState("12");
  const [method, setMethod] = useState<PaymentMethod>("annual");
  const [amount, setAmount] = useState(String(monthlyPrice("premium") * 12));
  const [amountEdited, setAmountEdited] = useState(false);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // פתיחה לחנות: ברירת מחדל — החבילה הנוכחית (אם בתשלום), 12 חודשים מראש
  useEffect(() => {
    if (!store) return;
    const current = storeSubscription(store).plan;
    const initialPlan = current === "basic" ? "basic" : "premium";
    setPlan(initialPlan);
    setMonths("12");
    setMethod("annual");
    setAmount(String(monthlyPrice(initialPlan) * 12));
    setAmountEdited(false);
    setReference("");
    setNote("");
    // רק בפתיחה לחנות אחרת — לא כשהקטלוג נטען (הסכום מתעדכן באפקט הבא)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // הסכום מחושב לבד (מחיר חודשי × חודשים) עד שמשנים אותו ידנית
  useEffect(() => {
    if (amountEdited) return;
    const m = Number(months);
    if (Number.isFinite(m) && m > 0) {
      setAmount(String(Math.round(catalog.plans[plan].monthlyPrice * m * 100) / 100));
    }
  }, [plan, months, amountEdited, catalog]);

  const state = store ? storeSubscription(store) : null;
  const renewing = state?.plan === plan && state.active && state.endsAt !== null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!store) return;
    setBusy(true);
    try {
      const next = await record({
        data: {
          tenantId: store.id,
          plan,
          amount: Number(amount),
          months: Number(months),
          method,
          reference,
          note,
        },
      });
      toast.success(
        `התשלום נרשם — "${store.name}" ב${PLAN_LABELS[next.plan]} עד ${formatDate(next.endsAt)}`,
      );
      onDone(store, next);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "תיעוד התשלום נכשל");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={store !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl" className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="size-5 text-primary" aria-hidden="true" />
            תיעוד תשלום — {store?.name}
          </DialogTitle>
          <DialogDescription>
            התשלום נשמר בהיסטוריה, והחבילה ותאריך הסיום מתעדכנים מיד.
            {state ? ` כרגע: ${PLAN_LABELS[state.plan]} · ${remainingLabel(state)}.` : ""}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {(["basic", "premium"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setPlan(option)}
                aria-pressed={plan === option}
                className={cn(
                  "rounded-xl border-2 p-3 text-right transition",
                  plan === option
                    ? option === "premium"
                      ? "border-amber-500 bg-amber-50"
                      : "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40",
                )}
              >
                <span className="flex items-center gap-1.5 font-bold">
                  {option === "premium" ? (
                    <Crown className="size-4 text-amber-600" aria-hidden="true" />
                  ) : (
                    <Package className="size-4 text-primary" aria-hidden="true" />
                  )}
                  {PLAN_LABELS[option]}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatShekels(monthlyPrice(option))} לחודש
                </span>
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pay-months">חודשים</Label>
              <Select value={months} onValueChange={setMonths}>
                <SelectTrigger id="pay-months" dir="rtl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  {[1, 3, 6, 12, 24].map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m === 12 ? "12 חודשים (שנה)" : m === 24 ? "24 חודשים" : `${m} חודשים`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-method">אופן תשלום</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger id="pay-method" dir="rtl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                    <SelectItem key={m} value={m}>
                      {PAYMENT_METHOD_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">סכום (₪, לפני מע״מ)</Label>
              <Input
                id="pay-amount"
                type="number"
                inputMode="decimal"
                min={0}
                step="0.01"
                required
                dir="ltr"
                value={amount}
                onChange={(event) => {
                  setAmountEdited(true);
                  setAmount(event.target.value);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pay-reference">אסמכתא / מס׳ קבלה</Label>
              <Input
                id="pay-reference"
                maxLength={120}
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="לא חובה"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pay-note">הערה</Label>
            <Input
              id="pay-note"
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="לא חובה"
            />
          </div>

          <p className="rounded-lg bg-secondary/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
            {renewing
              ? `חידוש של אותה חבילה לפני הסיום — ${months} החודשים מתווספים לסוף התקופה הנוכחית (${formatDate(state?.endsAt ?? null)}).`
              : `התקופה מתחילה היום ונמשכת ${months} חודשים.`}
          </p>

          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />}
              שמירת התשלום
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              ביטול
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------
// היסטוריית תשלומים
// ------------------------------------------------------------

export function BillingHistoryDialog({
  store,
  onClose,
}: {
  store: Store | null;
  onClose: () => void;
}) {
  const load = useServerFn(platformBillingHistory);
  const [history, setHistory] = useState<BillingEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!store) return;
    setHistory(null);
    setError(null);
    load({ data: { tenantId: store.id } })
      .then((result) => setHistory(result.history))
      .catch((thrown: unknown) =>
        setError(thrown instanceof Error ? thrown.message : "טעינת ההיסטוריה נכשלה"),
      );
  }, [store, load]);

  const total = (history ?? [])
    .filter((entry) => entry.kind === "payment")
    .reduce((sum, entry) => sum + entry.amount, 0);

  return (
    <Dialog open={store !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl" className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="size-5 text-primary" aria-hidden="true" />
            היסטוריית מנוי — {store?.name}
          </DialogTitle>
          <DialogDescription>
            {history ? `סה״כ תשלומים שתועדו: ${formatShekels(total)}` : "טוען…"}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : history === null ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : history.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">עוד לא תועדו תשלומים.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {history.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-semibold">
                    {BILLING_KIND_LABELS[entry.kind]} · {PLAN_LABELS[entry.plan]}
                    {entry.kind === "trial_extension" && entry.days ? ` · +${entry.days} ימים` : ""}
                    {entry.kind === "payment" && entry.months ? ` · ${entry.months} חודשים` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(entry.createdAt)}
                    {entry.method ? ` · ${PAYMENT_METHOD_LABELS[entry.method]}` : ""}
                    {entry.periodEnd ? ` · עד ${formatDate(entry.periodEnd)}` : ""}
                    {entry.reference ? ` · אסמכתא ${entry.reference}` : ""}
                  </p>
                  {entry.note && <p className="text-xs text-muted-foreground">{entry.note}</p>}
                  {entry.recordedBy && (
                    <p className="text-[11px] text-muted-foreground" dir="ltr">
                      {entry.recordedBy}
                    </p>
                  )}
                </div>
                <span className="shrink-0 font-bold">
                  {entry.kind === "payment" ? formatShekels(entry.amount) : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
