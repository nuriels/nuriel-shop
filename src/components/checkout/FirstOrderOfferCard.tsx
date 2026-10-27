import { Check, Gift, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FirstOrderOffer } from "@/lib/first-order.functions";

/**
 * "יש לך קופון להזמנה ראשונה" — בסל ובקופה.
 *  offer: הלקוח מאשר ("אישור וקבלת ההנחה"); אחרי אישור מוצג שהקופון יופעל / הופעל.
 *  auto: הודעה בלבד — ההנחה מוחלת לבד בקופה.
 */
export function FirstOrderOfferCard({
  offer,
  approved,
  applied,
  busy = false,
  onApprove,
  onUndo,
  context,
}: {
  offer: FirstOrderOffer;
  /** הלקוח אישר (offer) */
  approved: boolean;
  /** הקופון כבר מוחל בקופה */
  applied: boolean;
  busy?: boolean;
  onApprove?: () => void;
  onUndo?: () => void;
  context: "cart" | "checkout";
}) {
  const auto = offer.mode === "auto";
  return (
    <div
      className="space-y-2 rounded-xl border-2 border-dashed border-accent/70 bg-accent/10 p-3"
      data-testid="first-order-offer"
      data-mode={offer.mode}
      data-context={context}
      data-approved={approved || applied}
    >
      <div className="flex items-start gap-2.5">
        <Gift className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
        <div className="min-w-0 space-y-0.5 text-sm">
          <p className="font-bold text-foreground">
            {auto
              ? `הנחת הזמנה ראשונה: ${offer.label}`
              : `יש לך קופון להזמנה ראשונה: ${offer.label}`}
          </p>
          <p className="text-xs text-muted-foreground">
            {auto
              ? context === "cart"
                ? "ההנחה תחול אוטומטית בקופה, בלי צורך להקליד קוד."
                : applied
                  ? "ההנחה הוחלה אוטומטית על ההזמנה."
                  : "ההנחה תחול אוטומטית כשהזמנה עומדת בתנאים."
              : applied
                ? "הקופון הופעל על ההזמנה."
                : approved
                  ? "הקופון יופעל על ההזמנה בקופה."
                  : "אשרו כדי שנפעיל את הקופון על ההזמנה."}
            {offer.conditions && ` ${offer.conditions}`}
          </p>
        </div>
      </div>
      {!auto && !applied && !approved && onApprove && (
        <Button
          type="button"
          size="sm"
          className="w-full"
          disabled={busy}
          onClick={onApprove}
          data-testid="first-order-approve"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          אישור וקבלת ההנחה
        </Button>
      )}
      {!auto && approved && !applied && onUndo && (
        <p className="flex items-center justify-between gap-2 text-xs font-medium text-green-700">
          <span className="flex items-center gap-1">
            <Check className="size-4" aria-hidden="true" />
            אושר
          </span>
          <button
            type="button"
            className="underline"
            onClick={onUndo}
            data-testid="first-order-undo"
          >
            ביטול
          </button>
        </p>
      )}
    </div>
  );
}
