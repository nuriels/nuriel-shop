// Online payments, platform scope — "תשלום מקוון" in "המנוי שלי" (the store owner, on the store's own host;
// arch §8.8). Shown only when the server says online payment is available for this owner now; otherwise exactly the
// line the card always had. A payable charge gets a button → the server opens the attempt and SIGNs → the browser
// goes to Hyp's page. Back from Hyp (?pay=return): the result of the latest payment, polled for up to 30 seconds.
// A charge whose payment is in review or being verified gets no button, only the note "התשלום בבדיקה" (review H2).
// Nothing here knows a terminal, a credential or an amount the server did not send; the button sends only the
// charge id (DM-PLAT-2). Gender-neutral texts.
import { useCallback, useEffect, useRef, useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button } from "@/platform/ui";
import { DemoBanner } from "@/platform/payments/ui/DemoBanner";
import { errorMessage, formatDate, formatMoney } from "../logic";
import {
  myBillingPayOptions,
  myBillingPayStart,
  myBillingPayments,
  payChargeOffer,
  type MyCardPayment,
  type MyCardPaymentState,
  type PayCharge,
  type PayOptions,
} from "../pay.functions";

/** the card's original line — unchanged whenever online payment is not available */
const NO_CLEARING = "אין כאן סליקה: תשלום מופיע אחרי שצוות Nuriel רשם שהוא התקבל.";
const CAN_PAY = "אפשר לשלם חיוב פתוח בכרטיס אשראי. התשלום נרשם אחרי אישור ספק התשלומים.";
const CHECKING = "התשלום בבדיקה";

const POLL_MS = 2_000;
const POLL_FOR_MS = 30_000;

type ResultState = "checking" | "paid" | "review" | "failed";

const RESULT_TEXT: Record<ResultState, string> = {
  checking: "בודקים את התשלום…",
  paid: "התשלום התקבל ונרשם.",
  review: "התשלום בבדיקה. צוות NURIEL יבדוק אותו ויעדכן.",
  failed: "התשלום לא הושלם. אפשר לנסות שוב.",
};

const STATE_LABEL: Record<MyCardPaymentState, string> = {
  in_progress: "בתהליך",
  paid: "שולם",
  test_paid: "שולם (בדיקה)",
  needs_review: "בבדיקה",
  failed: "לא הושלם",
  expired: "פג תוקף",
  cancelled: "בוטל",
};

const resultOf = (latest: MyCardPayment | undefined): ResultState => {
  switch (latest?.state) {
    case "paid":
    case "test_paid":
      return "paid";
    case "needs_review":
      return "review";
    case "failed":
    case "expired":
    case "cancelled":
      return "failed";
    default:
      return "checking";
  }
};

const money = (minor: number) => formatMoney(minor / 100);

/** back from Hyp's page? (read once, from the address the platform return sent the browser to) */
const cameBackFromPayment = () => {
  try {
    return new URLSearchParams(window.location.search).get("pay") === "return";
  } catch {
    return false;
  }
};

export function PayOnlineButton({ charge }: { charge: PayCharge }) {
  const [busy, setBusy] = useState(false);
  const pay = async () => {
    setBusy(true);
    try {
      const { url } = await myBillingPayStart({ data: { chargeId: charge.id } });
      window.location.assign(url);
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Button
      type="button"
      className="min-h-11"
      disabled={busy}
      onClick={() => void pay()}
      data-testid="my-billing-pay-button"
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <CreditCard className="size-4" aria-hidden="true" />
      )}
      תשלום מקוון
    </Button>
  );
}

export function PayOnlineSection({ onChanged }: { onChanged?: () => Promise<void> | void }) {
  const [options, setOptions] = useState<PayOptions | null>(null);
  const [payments, setPayments] = useState<MyCardPayment[]>([]);
  const [result, setResult] = useState<ResultState | null>(null);
  const settled = useRef(false);

  const loadOptions = useCallback(async () => {
    try {
      setOptions(await myBillingPayOptions());
    } catch {
      setOptions(null); // not the owner, payments off, a network error: the card stays as it always was
    }
  }, []);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  useEffect(() => {
    if (!options?.available) return;
    let stop = false;
    const started = Date.now();
    const watching = cameBackFromPayment();
    if (watching) setResult("checking");
    const poll = async () => {
      let list: MyCardPayment[] = [];
      try {
        list = await myBillingPayments();
      } catch {
        list = [];
      }
      if (stop) return;
      setPayments(list);
      if (!watching) return;
      const state = resultOf(list[0]);
      setResult(state);
      if (state !== "checking") {
        if (!settled.current) {
          settled.current = true;
          void loadOptions();
          void onChanged?.();
        }
        return;
      }
      if (Date.now() - started < POLL_FOR_MS) setTimeout(() => void poll(), POLL_MS);
    };
    void poll();
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poll once per availability, not on every render
  }, [options?.available]);

  if (!options?.available) {
    return (
      <p
        className="text-xs text-muted-foreground"
        data-testid="my-billing-pay"
        data-available="false"
      >
        {NO_CLEARING}
      </p>
    );
  }

  const listed = options.charges.flatMap((charge) => {
    const offer = payChargeOffer(charge, payments);
    return offer ? [{ charge, offer }] : [];
  });
  const payable = listed.filter((item) => item.offer === "pay");
  return (
    <div className="flex flex-col gap-3" data-testid="my-billing-pay" data-available="true">
      {payable.length > 0 && options.demo ? <DemoBanner /> : null}
      <p className="text-xs text-muted-foreground">{CAN_PAY}</p>
      {result ? (
        <p
          role="status"
          className="rounded-md border bg-muted/40 p-3 text-sm"
          data-testid="my-billing-pay-result"
          data-state={result}
        >
          {RESULT_TEXT[result]}
        </p>
      ) : null}
      {listed.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {listed.map(({ charge, offer }) => (
            <li
              key={charge.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
              data-testid="my-billing-pay-charge"
              data-charge-id={charge.id}
              data-payable={String(offer === "pay")}
            >
              <span className="flex flex-col">
                <span className="font-medium">
                  {charge.description ?? (charge.no !== null ? `חיוב #${charge.no}` : "חיוב")}
                </span>
                <span className="text-muted-foreground">
                  {money(charge.amountMinor)}
                  {charge.occurredOn ? ` · ${formatDate(charge.occurredOn)}` : ""}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {options.test ? <Badge variant="outline">בדיקה</Badge> : null}
                {offer === "pay" ? (
                  <PayOnlineButton charge={charge} />
                ) : (
                  <span
                    className="text-muted-foreground"
                    role="status"
                    data-testid="my-billing-pay-checking"
                  >
                    {CHECKING}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {payments.length > 0 ? (
        <section className="flex flex-col gap-1" aria-labelledby="mb-card-payments">
          <h4 id="mb-card-payments" className="text-xs font-bold">
            תשלומים בכרטיס אשראי
          </h4>
          <ul className="flex flex-col gap-1 text-xs" data-testid="my-billing-card-payments">
            {payments.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-2"
                data-testid="my-billing-card-payment"
                data-state={p.state}
                data-test={String(p.test)}
              >
                <span>{formatDate(p.paidAt ?? p.createdAt)}</span>
                <span>{p.targetLabel ?? "חיוב"}</span>
                <span>{money(p.amountMinor)}</span>
                <Badge variant="secondary">{STATE_LABEL[p.state]}</Badge>
                {p.test ? <Badge variant="outline">בדיקה</Badge> : null}
                {p.cardLast4 ? <span dir="ltr">•••• {p.cardLast4}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
