import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  Loader2,
  MapPin,
  PackageCheck,
  Phone,
  Receipt,
  RefreshCw,
  Search,
  Truck,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import {
  FULFILLMENT_GROUPS,
  FULFILLMENT_STATUS_LABEL,
  fulfillmentActions,
  loadFulfillmentOrders,
  type FulfillmentOrder,
  type FulfillmentStatus,
} from "@/lib/fulfillment";
import { setFulfillmentStatus } from "@/lib/fulfillment.functions";
import { cn } from "@/lib/utils";

const dateTime = new Intl.DateTimeFormat("he-IL", {
  day: "numeric",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * חלק 33: "סטטוס משלוחים" — המסך של המחסנאי. ההזמנות שבטיפול המחסן (בליקוט,
 * לוקטו, ממתינות לשליח, נשלחו), עם פרטי המשלוח בלבד — בלי מחירים, סכומים
 * והכנסות. מכאן מסמנים "נשלחה" (עם מספר מעקב — והלקוח מקבל מייל), "נמסרה",
 * ומחזירים טעות.
 */
export function FulfillmentPanel() {
  const [orders, setOrders] = useState<FulfillmentOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeDelivered, setIncludeDelivered] = useState(false);
  const [term, setTerm] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [shipping, setShipping] = useState<FulfillmentOrder | null>(null);
  const update = useServerFn(setFulfillmentStatus);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOrders(await loadFulfillmentOrders(includeDelivered));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "טעינת ההזמנות נכשלה");
    } finally {
      setLoading(false);
    }
  }, [includeDelivered]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return orders;
    const digits = q.replace(/\D/g, "");
    return orders.filter(
      (order) =>
        order.order_number.toLowerCase().includes(q) ||
        order.customer_name.toLowerCase().includes(q) ||
        (order.city ?? "").toLowerCase().includes(q) ||
        (order.tracking_number ?? "").toLowerCase().includes(q) ||
        (digits.length >= 3 && (order.customer_phone ?? "").replace(/\D/g, "").includes(digits)),
    );
  }, [orders, term]);

  const run = async (
    order: FulfillmentOrder,
    status: "shipped" | "delivered" | "awaiting_courier",
    extra: { trackingNumber?: string; shippingProvider?: string } = {},
  ): Promise<boolean> => {
    setBusyId(order.id);
    try {
      const result = await update({
        data: {
          orderId: order.id,
          status,
          ...(extra.trackingNumber !== undefined ? { trackingNumber: extra.trackingNumber } : {}),
          ...(extra.shippingProvider !== undefined
            ? { shippingProvider: extra.shippingProvider }
            : {}),
        },
      });
      const label = FULFILLMENT_STATUS_LABEL[status];
      if (result.email?.sent) {
        toast.success(`הזמנה ${order.order_number} — ${label}. הלקוח קיבל מייל "יצאה למשלוח".`);
      } else if (result.email) {
        toast.success(`הזמנה ${order.order_number} — ${label}`, {
          description: `המייל ללקוח לא נשלח: ${result.email.reason ?? "שגיאה לא ידועה"}`,
        });
      } else {
        toast.success(`הזמנה ${order.order_number} — ${label}`);
      }
      await load();
      return true;
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "העדכון נכשל");
      return false;
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="space-y-5" dir="rtl" data-testid="fulfillment-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-display text-xl text-foreground">סטטוס משלוחים</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            ההזמנות שבטיפול המחסן — פרטי משלוח בלבד. הליקוט עצמו בלשונית "ליקוט הזמנות".
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden="true" />
          רענון
        </Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="מספר הזמנה, שם, עיר, טלפון או מספר מעקב"
            className="pr-9"
            aria-label="חיפוש הזמנה"
            data-testid="fulfillment-search"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={includeDelivered}
            onCheckedChange={setIncludeDelivered}
            data-testid="fulfillment-include-delivered"
          />
          להציג גם שנמסרו (שבוע אחרון)
        </label>
      </div>

      {error ? (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-2 py-6 text-sm text-destructive">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            {error}
          </CardContent>
        </Card>
      ) : loading && orders.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          טוען הזמנות…
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <PackageCheck className="size-8 text-muted-foreground/60" aria-hidden="true" />
            {term.trim() ? "לא נמצאה הזמנה מתאימה" : "אין כרגע הזמנות בטיפול המחסן"}
          </CardContent>
        </Card>
      ) : (
        FULFILLMENT_GROUPS.map((group) => {
          const items = filtered.filter((order) => order.status === group.value);
          if (items.length === 0) return null;
          return (
            <div
              key={group.value}
              className="space-y-3"
              data-testid={`fulfillment-group-${group.value}`}
            >
              <div>
                <h3 className="flex items-center gap-2 font-semibold">
                  {group.label}
                  <span className="numeric rounded-full bg-secondary px-2 text-xs font-bold">
                    {items.length}
                  </span>
                </h3>
                <p className="text-xs text-muted-foreground">{group.hint}</p>
              </div>
              <ul className="grid gap-3 lg:grid-cols-2">
                {items.map((order) => (
                  <FulfillmentCard
                    key={order.id}
                    order={order}
                    busy={busyId === order.id}
                    onAction={(to) =>
                      to === "shipped" && order.status === "awaiting_courier"
                        ? setShipping(order)
                        : void run(order, to)
                    }
                  />
                ))}
              </ul>
            </div>
          );
        })
      )}

      <ShipDialog
        order={shipping}
        busy={shipping !== null && busyId === shipping.id}
        onClose={() => setShipping(null)}
        onConfirm={async (trackingNumber, shippingProvider) => {
          if (!shipping) return;
          const ok = await run(shipping, "shipped", { trackingNumber, shippingProvider });
          if (ok) setShipping(null);
        }}
      />
    </section>
  );
}

function FulfillmentCard({
  order,
  busy,
  onAction,
}: {
  order: FulfillmentOrder;
  busy: boolean;
  onAction: (to: "shipped" | "delivered" | "awaiting_courier") => void;
}) {
  const actions = fulfillmentActions(order.status);
  const address = [order.address, order.city, order.zip].filter(Boolean).join(", ");
  const pickup = order.shipping_kind === "pickup";
  return (
    <li
      className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-card"
      data-testid="fulfillment-order"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            <span dir="ltr" className="numeric">
              #{order.order_number}
            </span>
            {order.is_urgent && <Badge variant="destructive">דחוף</Badge>}
            {order.order_source === "pos" && (
              <Badge variant="secondary" className="gap-1">
                <Receipt className="size-3" aria-hidden="true" />
                קופה
              </Badge>
            )}
          </p>
          <p className="text-sm">{order.customer_name || "—"}</p>
        </div>
        <Badge variant="outline" className="shrink-0">
          {FULFILLMENT_STATUS_LABEL[order.status as FulfillmentStatus] ?? order.status}
        </Badge>
      </div>

      <dl className="grid gap-1.5 text-sm text-muted-foreground">
        {order.customer_phone && (
          <div className="flex items-center gap-2">
            <Phone className="size-3.5 shrink-0" aria-hidden="true" />
            <a href={`tel:${order.customer_phone}`} dir="ltr" className="hover:underline">
              {order.customer_phone}
            </a>
          </div>
        )}
        <div className="flex items-start gap-2">
          {pickup ? (
            <PackageCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          )}
          <span>
            {order.shipping_method_name
              ? `${order.shipping_method_name}`
              : pickup
                ? "איסוף עצמי"
                : "משלוח"}
            {!pickup && address ? ` · ${address}` : ""}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-3">
          <span>
            {order.items_count.toLocaleString("he-IL")} שורות ·{" "}
            {order.units_count.toLocaleString("he-IL")} יחידות
          </span>
          <span>התקבלה {dateTime.format(new Date(order.created_at))}</span>
          {order.delivery_attempts > 0 && (
            <span className="text-amber-700 dark:text-amber-300">
              ניסיונות משלוח שנכשלו: {order.delivery_attempts}
            </span>
          )}
        </div>
        {(order.tracking_number || order.shipping_provider) && (
          <div className="flex items-center gap-2">
            <Truck className="size-3.5 shrink-0" aria-hidden="true" />
            <span>
              {order.shipping_provider ?? "מעקב"}
              {order.tracking_number ? (
                <>
                  {" · "}
                  <span dir="ltr">{order.tracking_number}</span>
                </>
              ) : null}
            </span>
          </div>
        )}
        {order.note && <p className="rounded-md bg-muted px-2 py-1 text-xs">הערה: {order.note}</p>}
      </dl>

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <Button
              key={action.to}
              size="sm"
              variant={action.undo ? "ghost" : "default"}
              disabled={busy}
              onClick={() => onAction(action.to)}
              data-testid={`fulfillment-action-${action.to}`}
            >
              {busy && !action.undo ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : action.undo ? (
                <Undo2 className="size-4" aria-hidden="true" />
              ) : action.to === "shipped" ? (
                <Truck className="size-4" aria-hidden="true" />
              ) : (
                <PackageCheck className="size-4" aria-hidden="true" />
              )}
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </li>
  );
}

/** "סמן כנשלחה": מספר מעקב וחברת שילוח (לא חובה) — מופיעים במייל ללקוח */
function ShipDialog({
  order,
  busy,
  onClose,
  onConfirm,
}: {
  order: FulfillmentOrder | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (trackingNumber: string, shippingProvider: string) => Promise<void>;
}) {
  const [tracking, setTracking] = useState("");
  const [provider, setProvider] = useState("");

  useEffect(() => {
    if (order) {
      setTracking(order.tracking_number ?? "");
      setProvider(order.shipping_provider ?? "");
    }
  }, [order]);

  return (
    <Dialog open={order !== null} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent dir="rtl" className="text-right sm:max-w-md">
        <DialogHeader className="text-right">
          <DialogTitle>סימון כנשלחה{order ? ` — הזמנה ${order.order_number}` : ""}</DialogTitle>
          <DialogDescription>
            הלקוח יקבל מייל "ההזמנה יצאה למשלוח". מספר מעקב — לא חובה.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void onConfirm(tracking.trim(), provider.trim());
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="ship-provider">חברת שילוח</Label>
            <Input
              id="ship-provider"
              value={provider}
              maxLength={60}
              placeholder="דואר ישראל / שליח עד הבית…"
              onChange={(event) => setProvider(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ship-tracking">מספר מעקב</Label>
            <Input
              id="ship-tracking"
              value={tracking}
              maxLength={100}
              dir="ltr"
              className="text-right"
              placeholder="RR123456789IL"
              onChange={(event) => setTracking(event.target.value)}
              data-testid="fulfillment-tracking"
            />
          </div>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button type="submit" disabled={busy} data-testid="fulfillment-confirm-shipped">
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Truck className="size-4" aria-hidden="true" />
              )}
              סמן כנשלחה
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              ביטול
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
