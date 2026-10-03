import { staffLabel } from "@/lib/staff";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Bike,
  CheckCircle2,
  ClipboardList,
  Clock,
  Inbox,
  KeyRound,
  Store,
  Loader2,
  MailCheck,
  PackageCheck,
  PackageOpen,
  Pencil,
  RefreshCw,
  Tag,
  Trash2,
  TriangleAlert,
  Truck,
  X,
  XCircle,
  ClipboardCheck,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { DigitalBadge, ItemStatusBadge, LicenseSender } from "@/components/OrderItemExtras";
import { hasShippingLine, orderShippingLabel, shippingWasFree } from "@/lib/shipping";
import { CourierDialog } from "@/components/delivery/CourierDialog";
import { GroupSidebarLayout, type SideGroup } from "@/components/GroupSidebarLayout";
import { SortToggle, type SortDirection } from "@/components/OrdersByYear";
import { formatIls } from "@/lib/catalog";
import { deleteOrder } from "@/lib/admin.functions";
import {
  ORDER_GROUPS,
  ORDER_SELECT_COLUMNS,
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABEL,
  canAssignCourier,
  canMarkShipped,
  formatOrderDate,
  orderGroupOf,
  type OrderGroup,
  type OrderRow,
  type OrderStatus,
} from "@/lib/orders";
import type { ProfileContact } from "@/lib/order-details";
import { PickingPanel } from "@/components/PickingPanel";
import { managerApprovePicking, returnToPicking } from "@/lib/picking";
import { sendPickedEmail } from "@/lib/picking.functions";
import { markOrdersShipped, type MarkShippedResult } from "@/lib/delivery.functions";
import {
  loadLabelProfiles,
  loadLabelStore,
  markOrderDelivered,
  type LabelStore,
} from "@/lib/delivery";
import { downloadBlob, labelDataFromOrder, renderLabelsPdf } from "@/lib/shipping-label";

/** בניהול: אחרי "מאושרות" — ליקוט הזמנות, ואז ליקוטים שבוצעו (ממתינים לאישור מנהל) */
type PanelGroup = OrderGroup | "all" | "picking" | "picked";

const GROUP_ICON: Record<PanelGroup, typeof Clock> = {
  all: Inbox,
  awaiting: Clock,
  approved: CheckCircle2,
  picking: PackageCheck,
  picked: ClipboardCheck,
  courier: Bike,
  completed: Truck,
  cancelled: XCircle,
};

/** הצעד הבא בזרימה — כפתור אחד במקום לפתוח את חלון העריכה */
const NEXT_STEP: Partial<Record<OrderGroup, { to: OrderStatus; label: string }>> = {
  awaiting: { to: "picking", label: "אישור הזמנה" },
};

type PersonOption = { user_id: string; label: string };

/** סיכום תוצאת "סימון כנשלחו" להודעה אחת */
function shippedSummary(result: MarkShippedResult): { text: string; warning: string | null } {
  const parts = [
    result.updated.length === 1
      ? `${result.updated[0]?.order_number} סומנה כנשלחה`
      : `${result.updated.length} הזמנות סומנו כנשלחו`,
  ];
  if (result.emails.background) {
    parts.push("המיילים ללקוחות נשלחים ברקע");
  } else if (result.emails.sent > 0) {
    parts.push(result.emails.sent === 1 ? "נשלח מייל ללקוח" : `נשלחו ${result.emails.sent} מיילים`);
  }
  const problems = [
    result.emails.warning,
    result.emails.failed > 0
      ? `${result.emails.failed} מיילים נכשלו${result.emails.firstError ? `: ${result.emails.firstError}` : ""}`
      : null,
    result.emails.noAddress > 0 ? `${result.emails.noAddress} הזמנות בלי כתובת מייל` : null,
    result.skipped.length > 0
      ? `דילגנו על ${result.skipped.length}: ${result.skipped
          .slice(0, 3)
          .map((s) => `${s.order_number} (${s.reason})`)
          .join(", ")}${result.skipped.length > 3 ? "…" : ""}`
      : null,
    result.missing > 0 ? `${result.missing} הזמנות לא נמצאו` : null,
  ].filter((part): part is string => Boolean(part));
  return { text: parts.join(" · "), warning: problems.length ? problems.join(" · ") : null };
}

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

  // בחירה מרובה + פעולות מרוכזות
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkShipOpen, setBulkShipOpen] = useState(false);
  const [notifyCustomers, setNotifyCustomers] = useState(true);
  const [bulkBusy, setBulkBusy] = useState<"ship" | "labels" | "courier" | null>(null);

  // שליח + מדבקות
  const [courierOrders, setCourierOrders] = useState<OrderRow[]>([]);
  const [labelStore, setLabelStore] = useState<LabelStore | null>(null);
  const [profiles, setProfiles] = useState<Map<string, ProfileContact>>(new Map());

  const deleteOrderFn = useServerFn(deleteOrder);
  const sendPickedEmailFn = useServerFn(sendPickedEmail);
  const markShippedFn = useServerFn(markOrdersShipped);

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

  // שם החנות, טלפון ומידות המדבקה — למדבקות ולהודעות לשליח
  useEffect(() => {
    void loadLabelStore()
      .then(setLabelStore)
      .catch(() => setLabelStore(null));
  }, []);

  // מעבר קבוצה / שינוי סינון מנקה את הבחירה — פעולה מרוכזת רק על מה שרואים
  useEffect(() => {
    setSelected(new Set());
  }, [group, kindFilter, customerFilter, agentFilter]);

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
      courier: 0,
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
  const failedDeliveries = inFilters.filter(
    (o) => o.status === "awaiting_courier" && (o.delivery_attempts ?? 0) > 0,
  ).length;

  const sideGroups: SideGroup<PanelGroup>[] = [
    { id: "all", label: "כל ההזמנות", count: groupCounts.all, icon: GROUP_ICON.all },
    ...ORDER_GROUPS.flatMap((g) => {
      const base: SideGroup<PanelGroup> = {
        id: g.id,
        label: g.label,
        count:
          isAdminScope && g.id === "approved" ? groupCounts[g.id] - pickedCount : groupCounts[g.id],
        icon: GROUP_ICON[g.id],
        // משלוח שנכשל דורש טיפול — הקבוצה מודגשת
        attention: g.id === "awaiting" || (g.id === "courier" && failedDeliveries > 0),
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

  const patchStatus = (ids: string[], status: OrderStatus) =>
    setOrders((current) => current.map((o) => (ids.includes(o.id) ? { ...o, status } : o)));

  const setStatus = async (order: OrderRow, next: OrderStatus, undoable = true) => {
    const previous = order.status;
    setChangingId(order.id);
    const { error } = await supabase.from("orders").update({ status: next }).eq("id", order.id);
    setChangingId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    patchStatus([order.id], next);
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
      patchStatus([order.id], "shipped");
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
      patchStatus([order.id], "picking");
      toast.success(`${order.order_number} חזרה לליקוט`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ההחזרה נכשלה");
    } finally {
      setChangingId(null);
    }
  };

  /** "נשלחה" + מייל "יצאה למשלוח" (הזמנה אחת או מרוכז) */
  const shipOrders = async (targets: OrderRow[], notify: boolean) => {
    const eligible = targets.filter(canMarkShipped);
    if (eligible.length === 0) {
      toast.error("אין בבחירה הזמנות שאפשר לסמן כנשלחו (לא הצעות מחיר ולא הזמנות שהסתיימו)");
      return;
    }
    try {
      const result = await markShippedFn({
        data: { orderIds: eligible.map((o) => o.id), notify },
      });
      patchStatus(
        result.updated.map((o) => o.id),
        "shipped",
      );
      const summary = shippedSummary(result);
      toast.success(summary.text);
      if (summary.warning) toast.warning(summary.warning, { duration: 10_000 });
      setSelected(new Set());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "העדכון נכשל");
    }
  };

  const shipOne = async (order: OrderRow) => {
    setChangingId(order.id);
    await shipOrders([order], true);
    setChangingId(null);
  };

  /** פרופילים להזמנות ישנות (כתובת מהתיק) — נטענים לפני מדבקה / שליח */
  const ensureProfiles = async (targets: OrderRow[]) => {
    const missing = targets.filter((o) => o.customer_id && !profiles.has(o.customer_id));
    if (missing.length === 0) return profiles;
    const loaded = await loadLabelProfiles(missing);
    const merged = new Map([...profiles, ...loaded]);
    setProfiles(merged);
    return merged;
  };

  const openCourier = async (targets: OrderRow[]) => {
    const eligible = targets.filter(canAssignCourier);
    const skipped = targets.length - eligible.length;
    if (eligible.length === 0) {
      toast.error("אין בבחירה הזמנות שאפשר למסור לשליח (לא הצעות מחיר, מבוטלות או שנמסרו)");
      return;
    }
    if (skipped > 0) toast.info(`דילגנו על ${skipped} הזמנות שלא נמסרות לשליח`);
    setBulkBusy("courier");
    try {
      await ensureProfiles(eligible);
      setCourierOrders(eligible);
    } finally {
      setBulkBusy(null);
    }
  };

  /** מדבקות משלוח — PDF עם עמוד למדבקה, בגודל שהוגדר בהגדרות החנות */
  const printLabels = async (targets: OrderRow[]) => {
    const eligible = targets.filter((o) => o.kind === "order" && o.status !== "cancelled");
    if (eligible.length === 0) {
      toast.error("אין בבחירה הזמנות למשלוח (הצעות מחיר והזמנות מבוטלות לא מקבלות מדבקה)");
      return;
    }
    setBulkBusy("labels");
    try {
      const store = labelStore ?? (await loadLabelStore());
      const profileMap = await ensureProfiles(eligible);
      const labels = eligible.map((order) =>
        labelDataFromOrder(
          order,
          order.customer_id ? (profileMap.get(order.customer_id) ?? null) : null,
          { name: store.name, phone: store.phone },
        ),
      );
      const blob = await renderLabelsPdf(labels, store.size);
      const name =
        eligible.length === 1
          ? `label-${eligible[0]?.order_number}.pdf`
          : `labels-${new Date().toISOString().slice(0, 10)}-${eligible.length}.pdf`;
      downloadBlob(blob, name);
      toast.success(
        `${eligible.length === 1 ? "המדבקה מוכנה" : `${eligible.length} מדבקות מוכנות`} (\u2066${store.size.width}×${store.size.height}\u2069 מ"מ)`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "הפקת המדבקות נכשלה");
    } finally {
      setBulkBusy(null);
    }
  };

  const deliver = async (order: OrderRow) => {
    const previous = order.status;
    setChangingId(order.id);
    try {
      await markOrderDelivered(order.id);
      patchStatus([order.id], "delivered");
      toast.success(`${order.order_number}: נמסרה ללקוח`, {
        action: {
          label: "ביטול",
          onClick: () => void setStatus({ ...order, status: "delivered" }, previous, false),
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "העדכון נכשל");
    } finally {
      setChangingId(null);
    }
  };

  const sorted = [...filtered].sort((a, b) => {
    const delta = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    return sortDirection === "desc" ? -delta : delta;
  });
  const selectedOrders = sorted.filter((o) => selected.has(o.id));
  const allSelected = sorted.length > 0 && selectedOrders.length === sorted.length;
  const someSelected = selectedOrders.length > 0 && !allSelected;
  const shippableSelected = selectedOrders.filter(canMarkShipped);

  const toggle = (orderId: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(orderId);
      else next.delete(orderId);
      return next;
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

            {sorted.length > 0 && (
              <label className="flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={(checked) =>
                    setSelected(checked === true ? new Set(sorted.map((o) => o.id)) : new Set())
                  }
                  aria-label="בחירת כל ההזמנות ברשימה"
                />
                {selectedOrders.length > 0
                  ? `נבחרו ${selectedOrders.length} מתוך ${sorted.length}`
                  : `בחירת כל ${sorted.length} ההזמנות ברשימה`}
              </label>
            )}

            {filtered.length === 0 && !loading ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
                  <ClipboardList className="size-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    {group === "awaiting"
                      ? "אין הזמנות שממתינות לאישור"
                      : group === "courier"
                        ? "אין הזמנות שממתינות לשליח"
                        : "אין הזמנות בקבוצה הזו שתואמות את הסינון"}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {sorted.map((order) => {
                  const isSelected = selected.has(order.id);
                  const attempts = order.delivery_attempts ?? 0;
                  const busy = changingId === order.id;
                  return (
                    <Card
                      key={order.id}
                      className={`shadow-card transition-colors ${isSelected ? "border-primary ring-1 ring-primary" : ""}`}
                    >
                      <CardContent className="space-y-3 pt-6">
                        {/* כותרת: תיבת בחירה, מספר הזמנה (לא נחתך) ותגיות — שיורדות שורה כשצר */}
                        <div className="flex items-start gap-3">
                          <Checkbox
                            className="mt-1 size-5"
                            checked={isSelected}
                            onCheckedChange={(checked) => toggle(order.id, checked === true)}
                            aria-label={`בחירת הזמנה ${order.order_number}`}
                          />
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                              <p
                                dir="ltr"
                                className="numeric whitespace-nowrap font-bold text-foreground"
                              >
                                {order.order_number}
                              </p>
                              <div className="flex flex-wrap items-center gap-1.5">
                                {order.kind === "quote" && (
                                  <Badge variant="outline">הצעת מחיר</Badge>
                                )}
                                <Badge variant={ORDER_STATUS_BADGE[order.status]}>
                                  {ORDER_STATUS_LABEL[order.status]}
                                </Badge>
                                {order.status === "awaiting_courier" && attempts > 0 && (
                                  <Badge
                                    variant="outline"
                                    className="gap-1 border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                                  >
                                    <TriangleAlert className="size-3" aria-hidden="true" />
                                    משלוח נכשל — ניסיון {attempts}
                                  </Badge>
                                )}
                              </div>
                            </div>
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
                        </div>

                        {order.status === "awaiting_courier" &&
                          attempts > 0 &&
                          (order.last_delivery_failure_note || order.last_delivery_failure_at) && (
                            <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                              <span className="font-bold">דיווח השליח:</span>{" "}
                              {order.last_delivery_failure_note || "לא נמסר (בלי פירוט)"}
                              {order.last_delivery_failure_at &&
                                ` · ${formatOrderDate(order.last_delivery_failure_at)}`}
                            </p>
                          )}

                        <OrderContactBlock order={order} />

                        <ul className="space-y-1.5 text-sm">
                          {order.order_items.map((item) => (
                            <li key={item.id} className="space-y-0.5">
                              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                                <span className="min-w-0">
                                  <span className="break-words">
                                    {item.product_name ?? "מוצר"} × {item.quantity}
                                  </span>
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
                              </div>
                              {!item.is_deposit && (item.is_digital || item.item_status) && (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {item.is_digital && <DigitalBadge />}
                                  <ItemStatusBadge
                                    status={item.item_status}
                                    shippingKind={order.shipping_kind}
                                  />
                                </div>
                              )}
                              {item.is_digital &&
                                !item.is_deposit &&
                                (isAdminScope ? (
                                  <LicenseSender
                                    itemId={item.id}
                                    initialKey={item.digital_license_key}
                                    sentAt={item.license_sent_at}
                                    sentTo={item.license_sent_to}
                                    disabled={
                                      order.kind !== "order" || order.status === "cancelled"
                                    }
                                    onSent={() => void load()}
                                  />
                                ) : item.digital_license_key ? (
                                  <p
                                    dir="ltr"
                                    className="truncate text-left font-mono text-xs text-muted-foreground"
                                  >
                                    {item.digital_license_key}
                                  </p>
                                ) : null)}
                            </li>
                          ))}
                          {hasShippingLine(order) && (
                            <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-t border-dashed border-border pt-1.5">
                              <span className="flex min-w-0 items-center gap-1.5">
                                {order.shipping_kind === "pickup" ? (
                                  <Store
                                    className="size-3.5 shrink-0 text-muted-foreground"
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <Truck
                                    className="size-3.5 shrink-0 text-muted-foreground"
                                    aria-hidden="true"
                                  />
                                )}
                                <span className="truncate">
                                  משלוח: {orderShippingLabel(order) ?? "דמי משלוח"}
                                </span>
                              </span>
                              {order.kind === "order" && (
                                <span className="numeric shrink-0">
                                  {shippingWasFree(order)
                                    ? "חינם"
                                    : formatIls(Number(order.shipping_price ?? 0))}
                                </span>
                              )}
                            </li>
                          )}
                          {order.shipping_kind === "digital" && (
                            <li className="flex items-center gap-1.5 border-t border-dashed border-border pt-1.5 text-xs text-muted-foreground">
                              <KeyRound className="size-3.5" aria-hidden="true" />
                              הזמנה דיגיטלית — בלי משלוח
                            </li>
                          )}
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
                                <Button disabled={busy} onClick={() => void approvePicked(order)}>
                                  {busy ? (
                                    <Loader2 className="size-4 animate-spin" />
                                  ) : (
                                    <Truck className="size-4" />
                                  )}
                                  אישור ושליחה ללקוח
                                </Button>
                                <Button
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() => void returnPicked(order)}
                                >
                                  <Undo2 className="size-4" />
                                  החזרה לליקוט
                                </Button>
                              </div>
                            );
                          }
                          // מאושרות (בליקוט / לוקטה): שליחה רגילה או מסירה לשליח עם קישור
                          if (orderGroupOf(order.status) === "approved" && order.kind === "order") {
                            return (
                              <div className="grid grid-cols-2 gap-2">
                                <Button disabled={busy} onClick={() => void shipOne(order)}>
                                  {busy ? (
                                    <Loader2 className="size-4 animate-spin" />
                                  ) : (
                                    <MailCheck className="size-4" />
                                  )}
                                  נשלחה + מייל ללקוח
                                </Button>
                                <Button
                                  variant="outline"
                                  disabled={busy || bulkBusy === "courier"}
                                  onClick={() => void openCourier([order])}
                                >
                                  <Bike className="size-4" />
                                  מסירה לשליח
                                </Button>
                              </div>
                            );
                          }
                          if (order.status === "awaiting_courier") {
                            return (
                              <div className="grid grid-cols-2 gap-2">
                                <Button
                                  variant="secondary"
                                  disabled={busy || bulkBusy === "courier"}
                                  onClick={() => void openCourier([order])}
                                >
                                  <Bike className="size-4" />
                                  קישור לשליח
                                </Button>
                                <Button disabled={busy} onClick={() => void deliver(order)}>
                                  {busy ? (
                                    <Loader2 className="size-4 animate-spin" />
                                  ) : (
                                    <PackageOpen className="size-4" />
                                  )}
                                  סימון כנמסרה
                                </Button>
                              </div>
                            );
                          }
                          if (order.status === "shipped") {
                            return (
                              <Button
                                className="w-full"
                                variant="outline"
                                disabled={busy}
                                onClick={() => void deliver(order)}
                              >
                                <PackageOpen className="size-4" />
                                סימון כנמסרה ללקוח
                              </Button>
                            );
                          }
                          const step = NEXT_STEP[orderGroupOf(order.status)];
                          if (!step) return null;
                          return (
                            <Button
                              className="w-full"
                              disabled={busy}
                              onClick={() => void setStatus(order, step.to)}
                            >
                              {busy ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <PackageCheck className="size-4" />
                              )}
                              {step.label}
                            </Button>
                          );
                        })()}
                        <div
                          // כפתורים לפי הרוחב הפנוי — יורדים שורה במקום להידחס
                          className="grid grid-cols-[repeat(auto-fit,minmax(6.75rem,1fr))] gap-2"
                        >
                          <Button variant="outline" onClick={() => setEditing(order)}>
                            <Pencil className="size-4" />
                            צפייה ועריכה
                          </Button>
                          <OrderDocumentButton orderId={order.id} label="PDF" />
                          <OrderDocumentButton
                            orderId={order.id}
                            kind="picking"
                            label="בון ליקוט"
                          />
                          <Button
                            variant="outline"
                            disabled={
                              order.kind !== "order" ||
                              order.status === "cancelled" ||
                              bulkBusy === "labels"
                            }
                            onClick={() => void printLabels([order])}
                          >
                            <Tag className="size-4" />
                            מדבקה
                          </Button>
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
                  );
                })}
              </div>
            )}

            {selectedOrders.length > 0 && (
              <div
                role="toolbar"
                aria-label="פעולות על ההזמנות שנבחרו"
                className="sticky bottom-4 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-background/95 p-3 shadow-lift backdrop-blur"
              >
                <span className="me-1 text-sm font-bold">נבחרו {selectedOrders.length}</span>
                <Button
                  size="sm"
                  disabled={bulkBusy !== null || shippableSelected.length === 0}
                  onClick={() => setBulkShipOpen(true)}
                >
                  {bulkBusy === "ship" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <MailCheck className="size-4" />
                  )}
                  שינוי סטטוס לנשלח + מייל
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={bulkBusy !== null}
                  onClick={() => void openCourier(selectedOrders)}
                >
                  {bulkBusy === "courier" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Bike className="size-4" />
                  )}
                  מסירה לשליח
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={bulkBusy !== null}
                  onClick={() => void printLabels(selectedOrders)}
                >
                  {bulkBusy === "labels" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Tag className="size-4" />
                  )}
                  מדבקות משלוח (PDF)
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ms-auto"
                  onClick={() => setSelected(new Set())}
                >
                  <X className="size-4" />
                  ביטול בחירה
                </Button>
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

      <CourierDialog
        orders={courierOrders}
        open={courierOrders.length > 0}
        onOpenChange={(open) => {
          if (!open) setCourierOrders([]);
        }}
        labelStore={labelStore}
        profiles={profiles}
        onChanged={() => {
          patchStatus(
            courierOrders.map((o) => o.id),
            "awaiting_courier",
          );
          setSelected(new Set());
        }}
      />

      <AlertDialog open={bulkShipOpen} onOpenChange={setBulkShipOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader className="text-right">
            <AlertDialogTitle>סימון כנשלחו</AlertDialogTitle>
            <AlertDialogDescription className="text-right">
              {shippableSelected.length === 1
                ? `הזמנה ${shippableSelected[0]?.order_number} תסומן כ"נשלחה".`
                : `${shippableSelected.length} הזמנות יסומנו כ"נשלחה".`}
              {selectedOrders.length > shippableSelected.length &&
                ` ${selectedOrders.length - shippableSelected.length} הזמנות אחרות שנבחרו (הצעות מחיר, מבוטלות, או שכבר נשלחו / נמסרו) לא ישתנו.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-3 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={notifyCustomers}
              onCheckedChange={(checked) => setNotifyCustomers(checked === true)}
            />
            <span>
              <span className="font-medium">שליחת מייל "ההזמנה יצאה למשלוח" לכל לקוח</span>
              <span className="block text-xs text-muted-foreground">
                עם רשימת הפריטים וכתובת המשלוח, מכתובת השולח של החנות. המייל נשמר גם ביומן המיילים
                בתיק הלקוח.
              </span>
            </span>
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy === "ship"}>ביטול</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkBusy === "ship"}
              onClick={(event) => {
                event.preventDefault();
                setBulkBusy("ship");
                void shipOrders(shippableSelected, notifyCustomers).finally(() => {
                  setBulkBusy(null);
                  setBulkShipOpen(false);
                });
              }}
            >
              {bulkBusy === "ship" ? <Loader2 className="size-4 animate-spin" /> : null}
              סימון כנשלחו
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
