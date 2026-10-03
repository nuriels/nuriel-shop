import { staffLabel } from "@/lib/staff";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  ClipboardList,
  Clock,
  Inbox,
  Loader2,
  PackageCheck,
  Pencil,
  RefreshCw,
  Trash2,
  Truck,
  XCircle,
  ClipboardCheck,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OrderEditDialog } from "@/components/OrderEditDialog";
import { CreateOrderDialog } from "@/components/CreateOrderDialog";
import { OrderDocumentButton } from "@/components/OrderDocumentButton";
import { OrderContactBlock } from "@/components/OrderContactBlock";
import { GroupSidebarLayout, type SideGroup } from "@/components/GroupSidebarLayout";
import { SortToggle, type SortDirection } from "@/components/OrdersByYear";
import { formatIls } from "@/lib/catalog";
import { deleteOrder } from "@/lib/admin.functions";
import {
  ORDER_GROUPS,
  ORDER_SELECT_COLUMNS,
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABEL,
  formatOrderDate,
  orderGroupOf,
  type OrderGroup,
  type OrderRow,
  type OrderStatus,
} from "@/lib/orders";
import { PickingPanel } from "@/components/PickingPanel";
import { managerApprovePicking, returnToPicking } from "@/lib/picking";
import { sendPickedEmail } from "@/lib/picking.functions";

/** בניהול: אחרי "מאושרות" — ליקוט הזמנות, ואז ליקוטים שבוצעו (ממתינים לאישור מנהל) */
type PanelGroup = OrderGroup | "all" | "picking" | "picked";

const GROUP_ICON: Record<PanelGroup, typeof Clock> = {
  all: Inbox,
  awaiting: Clock,
  approved: CheckCircle2,
  picking: PackageCheck,
  picked: ClipboardCheck,
  completed: Truck,
  cancelled: XCircle,
};

/** הצעד הבא בזרימה — כפתור אחד במקום לפתוח את חלון העריכה */
const NEXT_STEP: Partial<Record<OrderGroup, { to: OrderStatus; label: string }>> = {
  awaiting: { to: "picking", label: "אישור הזמנה" },
  approved: { to: "shipped", label: "סימון כבוצעה" },
};

type PersonOption = { user_id: string; label: string };

/** ניהול הזמנות משותף לסוכן (מוגבל ע"י RLS ללקוחות שלו) ולאדמין (הכל) */
export function OrderManagementPanel({ scope, meId }: { scope: "agent" | "admin"; meId?: string }) {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [customers, setCustomers] = useState<PersonOption[]>([]);
  const [agents, setAgents] = useState<PersonOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState<PanelGroup>("awaiting");
  const [changingId, setChangingId] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [customerFilter, setCustomerFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [editing, setEditing] = useState<OrderRow | null>(null);
  const [pendingDelete, setPendingDelete] = useState<OrderRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const deleteOrderFn = useServerFn(deleteOrder);
  const sendPickedEmailFn = useServerFn(sendPickedEmail);

  const load = useCallback(async () => {
    setLoading(true);
    const [ordersResult, profilesResult, rolesResult] = await Promise.all([
      supabase
        .from("orders")
        .select(ORDER_SELECT_COLUMNS)
        .order("created_at", { ascending: false }),
      supabase.from("customer_profiles").select("user_id, business_name"),
      scope === "admin"
        ? supabase
            .from("user_roles")
            .select("user_id, email, username, role, agent_number, display_name")
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (ordersResult.error) toast.error(ordersResult.error.message);
    setOrders((ordersResult.data as unknown as OrderRow[] | null) ?? []);

    const profileMap = new Map(
      ((profilesResult.data as { user_id: string; business_name: string }[] | null) ?? []).map(
        (p) => [p.user_id, p.business_name],
      ),
    );
    const allRoles =
      (rolesResult.data as
        | {
            user_id: string;
            email: string;
            username: string | null;
            role: string;
            agent_number: string | null;
            display_name: string | null;
          }[]
        | null) ?? [];
    if (scope === "admin" && allRoles.length > 0) {
      setCustomers(
        allRoles
          .filter((r) => r.role === "customer")
          .map((r) => ({ user_id: r.user_id, label: profileMap.get(r.user_id) ?? r.email })),
      );
      setAgents(
        allRoles
          .filter((r) => r.role === "agent" || r.role === "admin")
          .map((r) => ({ user_id: r.user_id, label: staffLabel(r) })),
      );
    } else {
      setCustomers(
        [...profileMap.entries()].map(([user_id, label]) => ({ user_id, label: label ?? "" })),
      );
    }
    setLoading(false);
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteOrderFn({ data: { orderId: pendingDelete.id } });
      toast.success("ההזמנה נמחקה");
      setPendingDelete(null);
      void load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "מחיקת ההזמנה נכשלה");
    } finally {
      setDeleting(false);
    }
  };

  const customerLabel = useMemo(
    () => new Map(customers.map((c) => [c.user_id, c.label])),
    [customers],
  );
  const agentLabel = useMemo(() => new Map(agents.map((a) => [a.user_id, a.label])), [agents]);

  // המספרים בסרגל מתחשבים בשאר המסננים (סוג, לקוח, סוכן)
  const matchesFilters = (o: OrderRow) =>
    (kindFilter === "all" || o.kind === kindFilter) &&
    (customerFilter === "all" ||
      (customerFilter === "guests" ? o.customer_id === null : o.customer_id === customerFilter)) &&
    (agentFilter === "all" || o.agent_id === agentFilter);
  const inFilters = orders.filter(matchesFilters);
  const groupCounts = (() => {
    const counts: Record<PanelGroup, number> = {
      all: inFilters.length,
      picking: 0,
      picked: 0,
      awaiting: 0,
      approved: 0,
      completed: 0,
      cancelled: 0,
    };
    for (const order of inFilters) counts[orderGroupOf(order.status)] += 1;
    return counts;
  })();
  const isAdminScope = scope === "admin";
  // בניהול: "לוקטה" מוצגת בנפרד ("ליקוטים שבוצעו"), לא בתוך "מאושרות"
  const panelGroupOf = (status: OrderStatus): PanelGroup =>
    isAdminScope && status === "picked" ? "picked" : orderGroupOf(status);
  const filtered = inFilters.filter((o) => group === "all" || panelGroupOf(o.status) === group);
  const pickedCount = inFilters.filter((o) => o.status === "picked").length;
  const pickingCount = inFilters.filter((o) => o.status === "picking").length;

  const sideGroups: SideGroup<PanelGroup>[] = [
    { id: "all", label: "כל ההזמנות", count: groupCounts.all, icon: GROUP_ICON.all },
    ...ORDER_GROUPS.flatMap((g) => {
      const base: SideGroup<PanelGroup> = {
        id: g.id,
        label: g.label,
        count:
          isAdminScope && g.id === "approved" ? groupCounts[g.id] - pickedCount : groupCounts[g.id],
        icon: GROUP_ICON[g.id],
        attention: g.id === "awaiting",
        divider: g.id === "awaiting" || g.id === "cancelled",
      };
      if (!isAdminScope || g.id !== "approved") return [base];
      return [
        base,
        {
          id: "picking" as const,
          label: "ליקוט הזמנות",
          count: pickingCount,
          icon: GROUP_ICON.picking,
        },
        {
          id: "picked" as const,
          label: "ליקוטים שבוצעו",
          count: pickedCount,
          icon: GROUP_ICON.picked,
          attention: true,
        },
      ];
    }),
  ];
  const activeInfo =
    group === "picked"
      ? {
          label: "ליקוטים שבוצעו",
          staffHint:
            'המחסן סיים ללקט. "אישור ושליחה ללקוח" מסמן כבוצעה ושולח ללקוח מייל עם סיכום ו-PDF. "החזרה לליקוט" — לתיקון.',
        }
      : ORDER_GROUPS.find((g) => g.id === group);

  const setStatus = async (order: OrderRow, next: OrderStatus, undoable = true) => {
    const previous = order.status;
    setChangingId(order.id);
    const { error } = await supabase.from("orders").update({ status: next }).eq("id", order.id);
    setChangingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    setOrders((current) => current.map((o) => (o.id === order.id ? { ...o, status: next } : o)));
    if (!undoable) return;
    toast.success(`${order.order_number}: ${ORDER_STATUS_LABEL[next]}`, {
      action: {
        label: "ביטול",
        onClick: () => void setStatus({ ...order, status: next }, previous, false),
      },
    });
  };
  /** ליקוטים שבוצעו: אישור מנהל → נשלחה + מייל ללקוח (תמונות + PDF) */
  const approvePicked = async (order: OrderRow) => {
    setChangingId(order.id);
    try {
      const { shortages } = await managerApprovePicking(order.id);
      setOrders((current) =>
        current.map((o) => (o.id === order.id ? { ...o, status: "shipped" } : o)),
      );
      toast.success(`${order.order_number}: אושרה ונשלחה`);
      const mail = await sendPickedEmailFn({ data: { orderId: order.id, shortages } }).catch(
        (error: unknown) => ({
          sent: false,
          reason: error instanceof Error ? error.message : "המייל לא נשלח",
        }),
      );
      if (mail.sent) toast.success("נשלח ללקוח מייל: ההזמנה בדרך");
      else toast.warning(mail.reason ?? "המייל ללקוח לא נשלח");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "האישור נכשל");
    } finally {
      setChangingId(null);
    }
  };
  const returnPicked = async (order: OrderRow) => {
    setChangingId(order.id);
    try {
      await returnToPicking(order.id);
      setOrders((current) =>
        current.map((o) => (o.id === order.id ? { ...o, status: "picking" } : o)),
      );
      toast.success(`${order.order_number} חזרה לליקוט`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ההחזרה נכשלה");
    } finally {
      setChangingId(null);
    }
  };

  const sorted = [...filtered].sort((a, b) => {
    const delta = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return sortDirection === "desc" ? -delta : delta;
  });

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-display text-xl text-foreground">ניהול הזמנות</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading ? "טוען הזמנות..." : `${orders.length} הזמנות במערכת`}
          </p>
        </div>
        <div className="flex gap-2">
          <CreateOrderDialog scope={scope} onCreated={load} />
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            רענון נתונים
          </Button>
        </div>
      </div>

      <GroupSidebarLayout title="הזמנות" groups={sideGroups} value={group} onChange={setGroup}>
        {group === "picking" && isAdminScope && meId ? (
          <PickingPanel meId={meId} isAdmin onChanged={() => void load()} />
        ) : null}
        {group !== "picking" && activeInfo && (
          <div>
            <h3 className="font-display text-xl text-foreground">{activeInfo.label}</h3>
            <p className="text-sm text-muted-foreground">{activeInfo.staffHint}</p>
          </div>
        )}
        {group !== "picking" && (
          <>
            <div className="flex flex-wrap gap-2">
              <SortToggle direction={sortDirection} onChange={setSortDirection} />
              <Select value={kindFilter} onValueChange={setKindFilter}>
                <SelectTrigger dir="rtl" className="w-44">
                  <SelectValue placeholder="הזמנות והצעות" />
                </SelectTrigger>
                <SelectContent dir="rtl">
                  <SelectItem value="all">הזמנות והצעות מחיר</SelectItem>
                  <SelectItem value="order">הזמנות בלבד</SelectItem>
                  <SelectItem value="quote">בקשות להצעת מחיר</SelectItem>
                </SelectContent>
              </Select>
              {customers.length > 0 && (
                <Select value={customerFilter} onValueChange={setCustomerFilter}>
                  <SelectTrigger dir="rtl" className="w-48">
                    <SelectValue placeholder="כל הלקוחות" />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="all">כל הלקוחות</SelectItem>
                    {scope === "admin" && (
                      <SelectItem value="guests">הזמנות אורחים (בלי חשבון)</SelectItem>
                    )}
                    {customers.map((c) => (
                      <SelectItem key={c.user_id} value={c.user_id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {scope === "admin" && agents.length > 0 && (
                <Select value={agentFilter} onValueChange={setAgentFilter}>
                  <SelectTrigger dir="rtl" className="w-48">
                    <SelectValue placeholder="כל הסוכנים" />
                  </SelectTrigger>
                  <SelectContent dir="rtl">
                    <SelectItem value="all">כל הסוכנים</SelectItem>
                    {agents.map((a) => (
                      <SelectItem key={a.user_id} value={a.user_id}>
                        {a.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {filtered.length === 0 && !loading ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                  <ClipboardList className="size-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {group === "awaiting"
                      ? "אין הזמנות שממתינות לאישור"
                      : "אין הזמנות בקבוצה הזו שתואמות את הסינון"}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {sorted.map((order) => (
                  <Card key={order.id} className="shadow-card">
                    <CardContent className="space-y-3 pt-6">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                        <div className="min-w-0">
                          <p dir="ltr" className="truncate text-left font-bold text-foreground">
                            {order.order_number}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {formatOrderDate(order.created_at)} ·{" "}
                            {order.customer_id
                              ? (customerLabel.get(order.customer_id) ??
                                order.customer_name ??
                                "לקוח")
                              : (order.customer_name ?? "אורח")}
                            {scope === "admin" &&
                              order.agent_id &&
                              ` · סוכן: ${agentLabel.get(order.agent_id) ?? "-"}`}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                          {order.kind === "quote" && <Badge variant="outline">הצעת מחיר</Badge>}
                          <Badge variant={ORDER_STATUS_BADGE[order.status]}>
                            {ORDER_STATUS_LABEL[order.status]}
                          </Badge>
                        </div>
                      </div>

                      <OrderContactBlock order={order} />

                      <ul className="space-y-1 text-sm">
                        {order.order_items.map((item) => (
                          <li key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                            <span className="truncate">
                              {item.product_name ?? "מוצר"} × {item.quantity}
                              {item.product_barcode && (
                                <span
                                  dir="ltr"
                                  className="numeric mr-2 text-xs text-muted-foreground"
                                >
                                  {item.product_barcode}
                                </span>
                              )}
                            </span>
                            {order.kind === "order" && (
                              <span className="numeric shrink-0">
                                {formatIls(Number(item.unit_price) * item.quantity)}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>

                      <div className="flex items-center justify-between border-t border-border pt-3">
                        <span className="text-sm text-muted-foreground">
                          {order.order_items.length} פריטים
                        </span>
                        {order.kind === "quote" ? (
                          <span className="text-sm text-muted-foreground">ללא מחירים</span>
                        ) : (
                          <span className="numeric font-bold text-accent">
                            {formatIls(order.total)}
                          </span>
                        )}
                      </div>

                      {(() => {
                        // בקשת הצעת מחיר עדיין בלי מחירים — קודם מכינים הצעה בחלון העריכה
                        if (order.kind === "quote" && orderGroupOf(order.status) === "awaiting") {
                          return (
                            <Button
                              className="w-full"
                              variant="secondary"
                              onClick={() => setEditing(order)}
                            >
                              <Pencil className="size-4" />
                              הכנת הצעת מחיר
                            </Button>
                          );
                        }
                        if (order.status === "picked" && isAdminScope) {
                          return (
                            <div className="grid grid-cols-2 gap-2">
                              <Button
                                disabled={changingId === order.id}
                                onClick={() => void approvePicked(order)}
                              >
                                {changingId === order.id ? (
                                  <Loader2 className="size-4 animate-spin" />
                                ) : (
                                  <Truck className="size-4" />
                                )}
                                אישור ושליחה ללקוח
                              </Button>
                              <Button
                                variant="outline"
                                disabled={changingId === order.id}
                                onClick={() => void returnPicked(order)}
                              >
                                <Undo2 className="size-4" />
                                החזרה לליקוט
                              </Button>
                            </div>
                          );
                        }
                        const step = NEXT_STEP[orderGroupOf(order.status)];
                        if (!step) return null;
                        return (
                          <Button
                            className="w-full"
                            disabled={changingId === order.id}
                            onClick={() => void setStatus(order, step.to)}
                          >
                            {changingId === order.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : step.to === "picking" ? (
                              <PackageCheck className="size-4" />
                            ) : (
                              <Truck className="size-4" />
                            )}
                            {step.label}
                          </Button>
                        );
                      })()}
                      <div
                        className={`grid grid-cols-2 gap-2 ${scope === "admin" ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}
                      >
                        <Button variant="outline" onClick={() => setEditing(order)}>
                          <Pencil className="size-4" />
                          צפייה ועריכה
                        </Button>
                        <OrderDocumentButton orderId={order.id} label="PDF" />
                        <OrderDocumentButton orderId={order.id} kind="picking" label="בון ליקוט" />
                        {scope === "admin" && (
                          <Button
                            variant="outline"
                            onClick={() => setPendingDelete(order)}
                            className="text-destructive hover:bg-destructive hover:text-destructive-foreground"
                          >
                            <Trash2 className="size-4" />
                            מחיקה
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </GroupSidebarLayout>

      <OrderEditDialog
        order={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void load();
        }}
      />

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת הזמנה</AlertDialogTitle>
            <AlertDialogDescription>
              האם אתה בטוח שברצונך למחוק את הזמנה {pendingDelete?.order_number}?
              <br />
              לא ניתן לבטל פעולה זו.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "מוחק..." : "מחק"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
