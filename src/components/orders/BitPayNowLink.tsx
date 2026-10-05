import { Link } from "@tanstack/react-router";
import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * "להשלמת התשלום בביט" (חלק 17ב) — ללקוח, בהזמנה שעוד ממתינה לתשלום בביט
 * (למשל אם סגר את הדפדפן במעבר לאפליקציה וחזר מהאזור האישי).
 */
export function BitPayNowLink({
  order,
  className,
}: {
  order: {
    id: string;
    status: string;
    payment_method?: string | null;
    payment_status?: string | null;
  };
  className?: string;
}) {
  if (order.payment_method !== "bit" || order.payment_status !== "awaiting") return null;
  if (order.status === "cancelled") return null;
  return (
    <Button asChild size="sm" className={className}>
      <Link
        to="/checkout/bit/$orderId"
        params={{ orderId: order.id }}
        onClick={(event) => event.stopPropagation()}
      >
        <Smartphone className="size-4" aria-hidden="true" />
        להשלמת התשלום בביט
      </Link>
    </Button>
  );
}
