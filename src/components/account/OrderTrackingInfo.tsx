import { Copy, ExternalLink, PackageCheck, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/**
 * חלק 24: פרטי המשלוח ללקוח — חברת השילוח, מספר המעקב (העתקה) וקישור למעקב.
 * מוצג רק כשהחנות הזינה מספר מעקב או קישור.
 */
export function OrderTrackingInfo({
  order,
}: {
  order: {
    status: string;
    tracking_number?: string | null;
    shipping_provider?: string | null;
    tracking_url?: string | null;
  };
}) {
  if (!order.tracking_number && !order.tracking_url) return null;
  const delivered = order.status === "delivered";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(order.tracking_number ?? "");
      toast.success("מספר המעקב הועתק");
    } catch {
      toast.error("לא הצלחנו להעתיק — סמנו את המספר והעתיקו ידנית");
    }
  };
  return (
    <div
      data-order-tracking=""
      className="space-y-3 rounded-xl border-2 border-primary/30 bg-primary/5 p-4"
    >
      <p className="flex items-center gap-2 text-base font-bold text-foreground">
        {delivered ? (
          <PackageCheck className="size-5 text-primary" aria-hidden="true" />
        ) : (
          <Truck className="size-5 text-primary" aria-hidden="true" />
        )}
        {delivered ? "החבילה נמסרה" : "החבילה בדרך אליך"}
      </p>
      <dl className="space-y-1.5 text-sm">
        {order.shipping_provider && (
          <div className="flex flex-wrap items-center gap-x-2">
            <dt className="text-muted-foreground">חברת שילוח:</dt>
            <dd className="font-semibold">{order.shipping_provider}</dd>
          </div>
        )}
        {order.tracking_number && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <dt className="text-muted-foreground">מספר מעקב:</dt>
            <dd dir="ltr" className="numeric select-all font-mono text-lg font-bold tracking-wide">
              {order.tracking_number}
            </dd>
            <Button type="button" size="sm" variant="ghost" onClick={() => void copy()}>
              <Copy className="size-4" aria-hidden="true" />
              העתקה
            </Button>
          </div>
        )}
      </dl>
      {order.tracking_url && (
        <Button asChild className="w-full sm:w-auto">
          <a href={order.tracking_url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="size-4" aria-hidden="true" />
            מעקב אחר החבילה
          </a>
        </Button>
      )}
    </div>
  );
}
