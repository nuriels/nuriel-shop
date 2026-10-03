import { PartyPopper, Truck } from "lucide-react";
import { formatIls } from "@/lib/catalog";
import type { FreeShippingProgress } from "@/lib/cart-promotions";
import { cn } from "@/lib/utils";

/** מד משלוח חינם בסל: כמה חסר, או הודעת הצלחה כשעברו את הסכום */
export function FreeShippingBar({ progress }: { progress: FreeShippingProgress }) {
  const percent = Math.round(progress.ratio * 100);
  return (
    <div
      className={cn(
        "rounded-lg border p-3 transition-colors",
        progress.reached ? "border-green-600/30 bg-green-50" : "border-border bg-secondary/50",
      )}
      aria-live="polite"
    >
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        {progress.reached ? (
          <>
            <PartyPopper className="size-4 shrink-0 text-green-700" aria-hidden="true" />
            <span className="text-green-800">איזה כיף — ההזמנה שלך במשלוח חינם!</span>
          </>
        ) : (
          <>
            <Truck className="size-4 shrink-0 text-primary" aria-hidden="true" />
            <span>
              חסרים לך עוד{" "}
              <strong className="numeric whitespace-nowrap">{formatIls(progress.remaining)}</strong>{" "}
              למשלוח חינם!
            </span>
          </>
        )}
      </p>
      <div
        role="progressbar"
        aria-label="התקדמות למשלוח חינם"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="mt-2 h-2 overflow-hidden rounded-full bg-primary/15"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 ease-out",
            progress.reached ? "bg-green-600" : "bg-primary",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      {!progress.reached && (
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          משלוח חינם בהזמנה מעל <span className="numeric">{formatIls(progress.threshold)}</span>
        </p>
      )}
    </div>
  );
}
