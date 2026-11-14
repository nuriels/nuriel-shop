// Billing & Agreements — רכיבי תצוגה משותפים לכרטיס של בעל העסק ולכרטיס של מנהל הפלטפורמה.
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  cn,
  useIsMobile,
} from "@/platform/ui";
import {
  CATEGORY_LABELS,
  KIND_LABELS,
  METHOD_LABELS,
  confirmationLabel,
  formatDate,
  formatMoney,
} from "../logic";
import type { LedgerEntry } from "../types";

export function Stat(props: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  testId?: string;
  tone?: "default" | "warn" | "good";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-3",
        props.tone === "warn" && "border-amber-300 bg-amber-50",
        props.tone === "good" && "border-emerald-300 bg-emerald-50",
      )}
      data-testid={props.testId}
    >
      <div className="text-xs text-muted-foreground">{props.label}</div>
      <div className="mt-1 text-base font-semibold leading-snug">{props.value}</div>
      {props.hint ? <div className="mt-1 text-xs text-muted-foreground">{props.hint}</div> : null}
    </div>
  );
}

/** מה סוכם / מה נדרש / מה התקבל / יתרה — שלוש שורות ברורות */
export function MoneyBreakdown(props: {
  dueLabel: string;
  due: number;
  paid: number;
  balance: number;
  testId?: string;
}) {
  return (
    <dl className="grid grid-cols-3 gap-2 text-sm" data-testid={props.testId}>
      <div>
        <dt className="text-xs text-muted-foreground">{props.dueLabel}</dt>
        <dd className="font-semibold" data-field="due">
          {formatMoney(props.due)}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">התקבל</dt>
        <dd className="font-semibold" data-field="paid">
          {formatMoney(props.paid)}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-muted-foreground">יתרה</dt>
        <dd
          className={cn("font-semibold", props.balance > 0.004 && "text-amber-800")}
          data-field="balance"
        >
          {Math.abs(props.balance) < 0.005 ? "₪0" : formatMoney(props.balance)}
        </dd>
      </div>
    </dl>
  );
}

export function NativeSelect(props: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <select
      id={props.id}
      data-testid={props.testId}
      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      value={props.value}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value)}
    >
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** טופס בחלונית צד (במובייל — מלמטה) */
export function ActionSheet(props: {
  open: boolean;
  title: string;
  description: string;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
  submitDisabled?: boolean;
}) {
  const isMobile = useIsMobile();
  return (
    <Sheet open={props.open} onOpenChange={(open) => !open && !props.busy && props.onClose()}>
      <SheetContent
        side={isMobile ? "bottom" : "left"}
        className="max-h-[92dvh] w-full overflow-y-auto sm:max-w-lg"
        data-testid={props.testId}
      >
        <SheetHeader className="ps-10 text-start sm:text-start">
          <SheetTitle>{props.title}</SheetTitle>
          <SheetDescription>{props.description}</SheetDescription>
        </SheetHeader>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!props.busy) props.onSubmit();
          }}
        >
          {props.children}
          {props.error ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {props.error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              className="min-h-11"
              disabled={props.busy || props.submitDisabled}
            >
              {props.busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {props.submitLabel}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={props.busy}
              onClick={props.onClose}
            >
              ביטול
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** רשימת הרישומים: תאריך, מה, סכום (עם מע"מ), אמצעי, ומקור האישור */
export function EntriesList(props: {
  entries: LedgerEntry[];
  internal?: boolean;
  onReverse?: (entry: LedgerEntry) => void;
}) {
  if (props.entries.length === 0) {
    return <p className="text-sm text-muted-foreground">עדיין אין חיובים או תשלומים רשומים.</p>;
  }
  return (
    <ul className="flex flex-col gap-2" data-testid="billing-entries">
      {props.entries.map((e) => (
        <li
          key={e.id}
          className={cn("rounded-md border p-3 text-sm", e.reversed && "opacity-70")}
          data-testid="billing-entry"
          data-kind={e.kind}
          data-reversed={e.reversed ? "true" : "false"}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="font-medium">
              {KIND_LABELS[e.kind]} · {CATEGORY_LABELS[e.category]}
              {e.description ? <span className="font-normal"> — {e.description}</span> : null}
            </div>
            <div className={cn("font-semibold", e.reversed && "line-through")}>
              {e.kind === "credit" || e.kind === "reversal" ? "−" : ""}
              {formatMoney(e.amount)}
            </div>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {formatDate(e.occurred_on)}
            {e.period_start && e.period_end
              ? ` · תקופה ${formatDate(e.period_start)}–${formatDate(e.period_end)}`
              : ""}
            {e.vat > 0 ? ` · מתוכו מע״מ ${formatMoney(e.vat)} (${e.vat_rate}%)` : ""}
            {e.method ? ` · ${METHOD_LABELS[e.method]}` : ""}
            {e.kind === "payment" ? ` · ${confirmationLabel(e.confirmation)}` : ""}
            {e.source === "legacy_import" ? " · מההיסטוריה הקודמת" : ""}
            {e.reversed ? " · בוטל" : ""}
          </div>
          {props.internal && (e.reference || e.internal_note || e.recorded_by_email) ? (
            <div className="mt-1 text-xs text-muted-foreground">
              #{e.no}
              {e.reference ? ` · אסמכתה: ${e.reference}` : ""}
              {e.internal_note ? ` · הערה פנימית: ${e.internal_note}` : ""}
              {e.recorded_by_email ? ` · נרשם על ידי ${e.recorded_by_email}` : ""}
            </div>
          ) : null}
          {props.onReverse && !e.reversed && e.kind !== "reversal" ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1 h-8 px-2 text-xs"
              onClick={() => props.onReverse?.(e)}
              data-testid="billing-entry-reverse"
            >
              ביטול רישום
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
