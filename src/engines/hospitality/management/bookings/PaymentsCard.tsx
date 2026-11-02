// "תשלומים" בעמוד ההזמנה (תשתית Stage 8): כמה שולם, יתרה / החזר שמגיע, יומן התשלומים, רישום
// תשלום או החזר ידני, וביטול רישום שגוי (עם סיבה — נשאר בהיסטוריה). הסכום ששולם משפיע על
// חישובי הביטול (החזר / חוב). D4: תשלום טלפוני — העסק גובה במסוף שלו ורושם כאן; בלי סליקה ובלי
// פרטי כרטיס במערכת (גם בהערה — נבדק כאן, בשרת ובמסד).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, cn } from "@/platform/ui";
import {
  hospitalityBookingPayments,
  hospitalityPaymentRecord,
  hospitalityPaymentVoid,
} from "../../api/payments.functions";
import { CARD_IN_PAYMENT_NOTE, looksLikeCardNumber } from "../../payments/phone";
import type { BookingPayments, PaymentKind, PaymentMethod } from "../../types/payments";
import { errorText } from "../catalog/refresh";
import { formatDate } from "../lib/format";
import { manageKeys } from "../lib/query-keys";
import {
  PAYMENT_KIND_LABELS as KIND_LABELS,
  PAYMENT_METHOD_LABELS as METHOD_LABELS,
  bookingKey,
  paymentsKey,
  suggestedPayment,
} from "./model";

const money = (n: number, currency: string) =>
  new Intl.NumberFormat("he-IL", { style: "currency", currency }).format(Number(n));

export function PaymentsCard({
  bookingId,
  today,
  timezone,
}: {
  bookingId: string;
  today: string;
  timezone: string;
}) {
  const qc = useQueryClient();
  const key = paymentsKey(bookingId);
  const query = useQuery({
    queryKey: key,
    queryFn: () => hospitalityBookingPayments({ data: { bookingId } }),
  });
  const [adding, setAdding] = useState(false);
  const done = (r: BookingPayments) => {
    qc.setQueryData(key, r);
    // הסכום ששולם מוצג גם בפרטי ההזמנה, ברשימה ובחישובי הביטול
    void qc.invalidateQueries({ queryKey: bookingKey(bookingId) });
    void qc.invalidateQueries({ queryKey: [...manageKeys.all, "bookings"] });
  };
  const p = query.data;
  return (
    <Card data-section="payments" id="payments" className="scroll-mt-24">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">תשלומים</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {query.isError ? (
          <p role="alert" className="text-destructive">
            {errorText(query.error)}
          </p>
        ) : !p ? (
          <p className="text-muted-foreground">טוען…</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Figure label="סה״כ" value={money(p.total, p.currency)} />
              <Figure label="שולם" value={money(p.amount_paid, p.currency)} />
              <Figure
                label="יתרה לתשלום"
                value={money(p.balance_due, p.currency)}
                tone={p.balance_due > 0 ? "warn" : undefined}
              />
              {p.refund_due > 0 && (
                <Figure
                  label="החזר שמגיע לאורח"
                  value={money(p.refund_due, p.currency)}
                  tone="warn"
                />
              )}
            </dl>
            {p.payments.length > 0 && (
              <ul className="divide-y rounded-md border">
                {p.payments.map((x) => (
                  <PaymentLine
                    key={x.id}
                    row={x}
                    currency={p.currency}
                    timezone={timezone}
                    onVoided={done}
                  />
                ))}
              </ul>
            )}
            {adding ? (
              <RecordForm
                bookingId={bookingId}
                today={today}
                suggestion={suggestedPayment(p)}
                onDone={(r) => {
                  done(r);
                  setAdding(false);
                }}
                onCancel={() => setAdding(false)}
              />
            ) : (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 gap-2 self-start"
                onClick={() => setAdding(true)}
              >
                <Plus className="size-4" aria-hidden="true" />
                רישום תשלום או החזר
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              התשלום נגבה בטלפון במסוף של העסק (או במזומן / העברה / Bit) — כאן רק רושמים אותו, אחרי
              שהתקבל. אין סליקה באתר, ואין לרשום מספרי כרטיס.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn" | undefined;
}) {
  return (
    <div className="rounded-md bg-muted/60 p-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("font-semibold tabular-nums", tone === "warn" && "text-amber-800")}>
        {value}
      </dd>
    </div>
  );
}

function PaymentLine({
  row,
  currency,
  timezone,
  onVoided,
}: {
  row: BookingPayments["payments"][number];
  currency: string;
  timezone: string;
  onVoided: (r: BookingPayments) => void;
}) {
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const voidMut = useMutation({
    mutationFn: () => hospitalityPaymentVoid({ data: { paymentId: row.id, reason } }),
    onSuccess: (r) => {
      toast.success("הרישום בוטל");
      onVoided(r);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const voided = row.status === "voided";
  return (
    <li className={cn("flex flex-col gap-2 p-2", voided && "text-muted-foreground")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cn(voided && "line-through")}>
          <span className="font-medium">
            {row.kind === "refund" ? "−" : ""}
            {money(row.amount, currency)}
          </span>{" "}
          · {KIND_LABELS[row.kind]} · {METHOD_LABELS[row.method]} ·{" "}
          {formatDate(`${row.paid_at}T12:00:00Z`, timezone)}
          {row.note ? ` · ${row.note}` : ""}
        </span>
        {voided ? (
          <span className="text-xs">בוטל: {row.void_reason}</span>
        ) : (
          row.method !== "provider" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1"
              onClick={() => setVoiding((v) => !v)}
            >
              <Undo2 className="size-3.5" aria-hidden="true" />
              ביטול רישום
            </Button>
          )
        )}
      </div>
      {voiding && !voided && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-48 flex-1 flex-col gap-1">
            <Label htmlFor={`void-${row.id}`}>למה מבטלים (נשמר בהיסטוריה)</Label>
            <Input
              id={`void-${row.id}`}
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="min-h-10"
            disabled={reason.trim().length < 2 || voidMut.isPending}
            onClick={() => voidMut.mutate()}
          >
            ביטול הרישום
          </Button>
        </div>
      )}
    </li>
  );
}

function RecordForm({
  bookingId,
  today,
  suggestion,
  onDone,
  onCancel,
}: {
  bookingId: string;
  today: string;
  suggestion: { kind: PaymentKind; amount: number };
  onDone: (r: BookingPayments) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<PaymentKind>(suggestion.kind);
  // האמצעי — בלי ברירת מחדל: הוא נכנס לדוחות, ו"העברה בנקאית" שנשארה בטעות על תשלום בכרטיס תטעה אותם
  const [method, setMethod] = useState<PaymentMethod | "">("");
  const [amount, setAmount] = useState(suggestion.amount > 0 ? String(suggestion.amount) : "");
  const [paidAt, setPaidAt] = useState(today);
  const [note, setNote] = useState("");
  const cardInNote = looksLikeCardNumber(note);
  const save = useMutation({
    mutationFn: () =>
      hospitalityPaymentRecord({
        data: {
          bookingId,
          kind,
          method: method as PaymentMethod,
          amount: Number(amount),
          paidAt,
          note,
        },
      }),
    onSuccess: (r) => {
      toast.success(kind === "refund" ? "ההחזר נרשם" : "התשלום נרשם");
      onDone(r);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const select = "min-h-10 rounded-md border bg-background px-2";
  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="font-medium">מה נרשם</span>
          <select
            className={select}
            value={kind}
            onChange={(e) => setKind(e.target.value as PaymentKind)}
          >
            {(Object.keys(KIND_LABELS) as PaymentKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">אמצעי</span>
          <select
            className={select}
            value={method}
            required
            onChange={(e) => setMethod(e.target.value as PaymentMethod | "")}
          >
            <option value="" disabled>
              בחרו אמצעי…
            </option>
            {(Object.keys(METHOD_LABELS) as PaymentMethod[])
              .filter((m) => m !== "provider")
              .map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABELS[m]}
                </option>
              ))}
          </select>
        </label>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`pay-amount-${bookingId}`}>סכום (₪)</Label>
          <Input
            id={`pay-amount-${bookingId}`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`pay-date-${bookingId}`}>תאריך</Label>
          <Input
            id={`pay-date-${bookingId}`}
            type="date"
            value={paidAt}
            onChange={(e) => setPaidAt(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`pay-note-${bookingId}`}>הערה (לא חובה)</Label>
        <Input
          id={`pay-note-${bookingId}`}
          value={note}
          maxLength={300}
          placeholder="למשל: אסמכתא 1234 / 4 ספרות אחרונות"
          aria-invalid={cardInNote}
          aria-describedby={cardInNote ? `pay-note-error-${bookingId}` : undefined}
          onChange={(e) => setNote(e.target.value)}
        />
        {cardInNote && (
          <p id={`pay-note-error-${bookingId}`} role="alert" className="text-xs text-destructive">
            {CARD_IN_PAYMENT_NOTE}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          className="min-h-11"
          disabled={!(Number(amount) > 0) || !method || !paidAt || cardInNote || save.isPending}
          onClick={() => save.mutate()}
        >
          רישום
        </Button>
        <Button type="button" variant="ghost" className="min-h-11" onClick={onCancel}>
          ביטול
        </Button>
      </div>
    </div>
  );
}
