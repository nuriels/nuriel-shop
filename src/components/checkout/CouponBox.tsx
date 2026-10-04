import { useState, type FormEvent } from "react";
import { Loader2, TicketPercent, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { couponLabel, type AppliedCoupon } from "@/lib/coupons";
import { formatIls } from "@/lib/catalog";

/**
 * קוד קופון בקופה (חלק 14): "יש לך קוד קופון?" → שדה + "החלה". קופון שהוחל
 * מוצג כתג עם הסרה. ההנחה עצמה נבדקת שוב במסד בזמן שליחת ההזמנה.
 */
export function CouponBox({
  applied,
  discount,
  busy,
  error,
  onApply,
  onRemove,
}: {
  applied: AppliedCoupon | null;
  /** ההנחה בפועל על הסל הנוכחי (0 = עוד לא הגיעו למינימום) */
  discount: number;
  busy: boolean;
  error: string | null;
  onApply: (code: string) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");

  if (applied) {
    const belowMinimum = discount === 0 && applied.minOrderTotal !== null;
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 rounded-lg border-2 border-dashed border-green-500/60 bg-green-50 px-3 py-2 dark:bg-green-950/30">
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <TicketPercent
              className="size-4 shrink-0 text-green-700 dark:text-green-400"
              aria-hidden="true"
            />
            <span dir="ltr" className="font-mono font-bold">
              {applied.code}
            </span>
            <span className="truncate text-green-800 dark:text-green-300">
              {couponLabel(applied.discountType, applied.discountValue)}
            </span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label="הסרת הקופון"
            onClick={onRemove}
          >
            <X className="size-4" />
          </Button>
        </div>
        {belowMinimum && applied.minOrderTotal !== null && (
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
            הקופון חל בהזמנה של {formatIls(applied.minOrderTotal)} ומעלה (לפני משלוח) — הוסיפו
            מוצרים כדי ליהנות מההנחה.
          </p>
        )}
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
      >
        <TicketPercent className="size-4" aria-hidden="true" />
        יש לך קוד קופון?
      </button>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (code.trim().length >= 3) onApply(code);
  };

  return (
    <form onSubmit={submit} className="space-y-1.5" aria-label="קוד קופון">
      <div className="flex gap-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s+/g, ""))}
          placeholder="קוד קופון"
          dir="ltr"
          maxLength={32}
          autoFocus
          autoComplete="off"
          className="h-9 font-mono uppercase tracking-wider"
          aria-invalid={error ? true : undefined}
        />
        <Button type="submit" size="sm" className="h-9" disabled={busy || code.trim().length < 3}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : "החלה"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
