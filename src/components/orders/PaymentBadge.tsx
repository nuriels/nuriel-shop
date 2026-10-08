import {
  Ban,
  CreditCard,
  Hourglass,
  Receipt,
  ShieldQuestion,
  Smartphone,
  TimerOff,
} from "lucide-react";
import { paymentStatusLabel, type PaymentMethod, type PaymentStatus } from "@/lib/bit-payments";
import { posPaymentText } from "@/lib/pos";
import { cn } from "@/lib/utils";

const TONE = {
  amber:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200",
  sky: "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200",
  emerald:
    "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200",
  muted: "border-border bg-muted text-muted-foreground",
  red: "border-destructive/40 bg-destructive/10 text-destructive",
} as const;

/**
 * מצב התשלום של הזמנה — ליד תג הסטטוס.
 * אשראי — הזמנות ישנות בלבד (Hyp הוסר בחלק 28).
 * חלק 17ב: ביט (ממתינה לתשלום / ממתינה לאישור תשלום / שולמה / נדחה).
 * הזמנה בלי תשלום באתר (not_required — טלפוני מול נציג) — בלי תג.
 * חלק 32: הזמנה מהקופה המהירה — אמצעי התשלום שנרשם בקופה ("שולמה · מזומן"
 * / "תשלום בהמשך").
 */
export function PaymentBadge({
  status,
  method,
  posMethod,
  className,
}: {
  status: string | null | undefined;
  method?: string | null | undefined;
  /** pos_payment_method — רק בהזמנות מהקופה */
  posMethod?: string | null | undefined;
  className?: string;
}) {
  const pos = posPaymentText(posMethod, status === "paid");
  if (pos) {
    return (
      <span
        data-payment-status={status ?? undefined}
        data-pos-payment={posMethod ?? undefined}
        className={cn(
          "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold",
          pos.paid ? TONE.emerald : TONE.amber,
          className,
        )}
      >
        {pos.paid ? (
          <Receipt className="size-3" aria-hidden="true" />
        ) : (
          <Hourglass className="size-3" aria-hidden="true" />
        )}
        {pos.label}
      </span>
    );
  }
  const label = paymentStatusLabel(
    (method ?? null) as PaymentMethod | null,
    (status ?? null) as PaymentStatus | null,
  );
  if (!label) return null;
  const bit = method === "bit";
  const [tone, Icon] =
    status === "awaiting"
      ? ([TONE.amber, Hourglass] as const)
      : status === "awaiting_verification"
        ? ([TONE.sky, ShieldQuestion] as const)
        : status === "paid"
          ? ([TONE.emerald, bit ? Smartphone : CreditCard] as const)
          : status === "rejected"
            ? ([TONE.red, Ban] as const)
            : ([TONE.muted, TimerOff] as const);
  return (
    <span
      data-payment-status={status ?? undefined}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        tone,
        className,
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {label}
    </span>
  );
}
