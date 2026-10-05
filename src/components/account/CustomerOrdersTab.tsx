import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardList, Eye, Loader2, Package, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { PaymentBadge } from "@/components/orders/PaymentBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { OrderDetailsDialog } from "@/components/account/OrderDetailsDialog";
import { formatIls } from "@/lib/catalog";
import {
  ORDER_SELECT_COLUMNS,
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABEL,
  formatOrderDate,
  orderGroupOf,
  type OrderRow,
} from "@/lib/orders";
import type { ProfileContact } from "@/lib/order-details";
import { calculateVat } from "@/lib/vat";
import { reorderOrder } from "@/lib/orders.functions";
import { sendOrderEmails } from "@/lib/email.functions";
import { cn } from "@/lib/utils";

type Filter = "all" | "active" | "completed" | "cancelled";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "הכל" },
  { id: "active", label: "בתהליך" },
  { id: "completed", label: "נשלחו / נמסרו" },
  { id: "cancelled", label: "בוטלו" },
];

function filterOf(order: OrderRow): Exclude<Filter, "all"> {
  const group = orderGroupOf(order.status);
  if (group === "completed") return "completed";
  if (group === "cancelled") return "cancelled";
  return "active";
}

/** הסכום לתשלום של הזמנה (כולל מע"מ ודמי משלוח, לפי מצב המע"מ שצולם בהזמנה) */
function orderGross(order: OrderRow): number {
  const itemsTotal =
    order.order_items.reduce((sum, item) => sum + Number(item.unit_price) * item.quantity, 0) +
    Number(order.shipping_price ?? 0) -
    (order.kind === "quote" ? 0 : Number(order.discount_amount ?? 0));
  return calculateVat(itemsTotal, {
    pricesIncludeVat: order.prices_include_vat ?? true,
    vatRate: Number(order.vat_rate ?? 18),
  }).gross;
}

/**
 * היסטוריית ההזמנות של הלקוח: סינון לפי מצב, כרטיס לכל הזמנה (מספר, תאריך,
 * סטטוס, סה"כ לתשלום), ופירוט מלא בחלון — כולל קבלה (PDF) והזמנה חוזרת.
 */
export function CustomerOrdersTab({
  profile,
  accountEmail,
}: {
  profile: ProfileContact | null;
  accountEmail: string | null;
}) {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [reordering, setReordering] = useState<string | null>(null);
  /** שמות הסוכנים בעברית — דרך staff_display_names (בלי אימיילים) */
  const [agentNames, setAgentNames] = useState<Map<string, string>>(new Map());
  const reorder = useServerFn(reorderOrder);
  const sendEmails = useServerFn(sendOrderEmails);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("orders")
      .select(ORDER_SELECT_COLUMNS)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    const rows = (data as unknown as OrderRow[] | null) ?? [];
    setOrders(rows);
    const agentIds = [...new Set(rows.map((o) => o.agent_id).filter((id): id is string => !!id))];
    if (agentIds.length > 0) {
      const { data: names } = await supabase.rpc("staff_display_names", { _ids: agentIds });
      setAgentNames(
        new Map(
          (names ?? [])
            .map((n): [string, string] => [
              n.user_id,
              n.display_name ?? (n.agent_number ? `סוכן ${n.agent_number}` : ""),
            ])
            .filter(([, name]) => name !== ""),
        ),
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const result: Record<Filter, number> = {
      all: orders.length,
      active: 0,
      completed: 0,
      cancelled: 0,
    };
    for (const order of orders) result[filterOf(order)] += 1;
    return result;
  }, [orders]);
  const visible = filter === "all" ? orders : orders.filter((order) => filterOf(order) === filter);
  const openOrder = orders.find((order) => order.id === openId) ?? null;

  /** שכפול הזמנה — במחירים ובמבצעים של היום, לא של ההזמנה המקורית */
  const duplicate = async (orderId: string) => {
    setReordering(orderId);
    try {
      const result = await reorder({ data: { orderId } });
      toast.success(
        result.kind === "quote"
          ? `נוצרה בקשה חדשה ${result.orderNumber}`
          : `נוצרה הזמנה חדשה ${result.orderNumber} לפי המחירים של היום`,
      );
      if (result.outOfStockCount > 0) {
        toast.warning(
          `${result.outOfStockCount} מוצרים לא נכנסו להזמנה החדשה כי אינם זמינים כרגע (אזלו או הוסרו מהקטלוג)`,
        );
      }
      if (result.adjustedCount > 0) {
        toast.info(`${result.adjustedCount} מוצרים הוזמנו בכמות קטנה יותר — לפי המלאי שנשאר`);
      }
      setOpenId(null);
      void load();
      void sendEmails({ data: { orderId: result.orderId } }).catch(() => undefined);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שכפול ההזמנה נכשל");
    } finally {
      setReordering(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="סינון הזמנות"
          className="flex flex-wrap gap-1.5 rounded-xl bg-secondary/60 p-1"
        >
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={filter === option.id}
              onClick={() => setFilter(option.id)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                filter === option.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
              <span className="numeric mr-1.5 text-xs text-muted-foreground">
                {counts[option.id]}
              </span>
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          רענון
        </Button>
      </div>

      {loading && orders.length === 0 ? (
        <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> טוען הזמנות…
        </p>
      ) : orders.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <ClipboardList className="size-8 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">עדיין לא ביצעת הזמנות</p>
            <Button asChild>
              <Link to="/">מעבר לקטלוג</Link>
            </Button>
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">אין הזמנות במצב הזה</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {visible.map((order) => {
            const isQuote = order.kind === "quote";
            const products = order.order_items.filter((item) => !item.is_deposit);
            const thumbs = products.filter((item) => item.product_image_url).slice(0, 4);
            return (
              <li key={order.id}>
                <Card className="h-full shadow-card transition-shadow hover:shadow-lift">
                  <CardContent className="flex h-full flex-col gap-3 pt-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p dir="ltr" className="numeric truncate text-right text-base font-bold">
                          {order.order_number}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatOrderDate(order.created_at)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                        {isQuote && <Badge variant="outline">הצעת מחיר</Badge>}
                        <Badge variant={ORDER_STATUS_BADGE[order.status]}>
                          {ORDER_STATUS_LABEL[order.status]}
                        </Badge>
                        <PaymentBadge status={order.payment_status} />
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-2 space-x-reverse">
                        {thumbs.length > 0 ? (
                          thumbs.map((item) => (
                            <span
                              key={item.id}
                              className="flex size-9 items-center justify-center overflow-hidden rounded-full border-2 border-background bg-secondary p-0.5"
                            >
                              <img
                                src={item.product_image_url ?? ""}
                                alt=""
                                loading="lazy"
                                className="size-full object-contain mix-blend-multiply"
                              />
                            </span>
                          ))
                        ) : (
                          <span className="flex size-9 items-center justify-center rounded-full bg-secondary">
                            <Package className="size-4 text-muted-foreground" aria-hidden="true" />
                          </span>
                        )}
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {products.length} פריטים
                      </span>
                      <span className="mr-auto text-left">
                        {isQuote ? (
                          <span className="text-sm text-muted-foreground">ממתין להצעת מחיר</span>
                        ) : (
                          <>
                            <span className="numeric block text-lg font-bold text-accent">
                              {formatIls(orderGross(order))}
                            </span>
                            <span className="block text-[11px] text-muted-foreground">
                              סה״כ לתשלום
                            </span>
                          </>
                        )}
                      </span>
                    </div>

                    <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-3">
                      <Button size="sm" onClick={() => setOpenId(order.id)}>
                        <Eye className="size-4" />
                        פרטי ההזמנה
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={reordering === order.id}
                        onClick={() => void duplicate(order.id)}
                      >
                        {reordering === order.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <RotateCcw className="size-4" />
                        )}
                        הזמנה חוזרת
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <OrderDetailsDialog
        order={openOrder}
        onClose={() => setOpenId(null)}
        agentName={openOrder?.agent_id ? (agentNames.get(openOrder.agent_id) ?? null) : null}
        profile={profile}
        accountEmail={accountEmail}
        onReorder={(orderId) => void duplicate(orderId)}
        reordering={reordering !== null}
      />
    </div>
  );
}
