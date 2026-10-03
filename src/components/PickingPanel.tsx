import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ClipboardList, Loader2, Pause, RefreshCw } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PickingScreen } from "@/components/PickingScreen";
import { PickingStats } from "@/components/PickingStats";
import { sendPickedEmail } from "@/lib/picking.functions";
import {
  claimOrder,
  fetchPickingOrders,
  fetchPickingWorkers,
  setOrderUrgent,
  type PickingOrder,
  type PickingWorker,
  type Shortage,
} from "@/lib/picking";

const REFRESH_MS = 30_000;

/**
 * אזור הליקוט — למחסנאי (האזור שלו) ולמנהל (לשונית בניהול). לשוניות:
 * לליקוט (פנויות) · שלי (באמצע ליקוט / בהשהיה) · מי מלקט מה (לשונית לכל עובד) ·
 * הושלמו · הסטטיסטיקה שלי. המנהל יכול להיכנס להזמנה של עובד ולאשר במקומו.
 */
export function PickingPanel({
  meId,
  isAdmin,
  onChanged,
}: {
  meId: string;
  isAdmin: boolean;
  /** בתוך ניהול ההזמנות — לרענון הספירות בתפריט הצד */
  onChanged?: () => void;
}) {
  const [orders, setOrders] = useState<PickingOrder[] | null>(null);
  const [workers, setWorkers] = useState<PickingWorker[]>([]);
  const [tab, setTab] = useState("queue");
  const [workerTab, setWorkerTab] = useState<string>("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const sendEmail = useServerFn(sendPickedEmail);

  const load = useCallback(async () => {
    try {
      const [list, people] = await Promise.all([fetchPickingOrders(), fetchPickingWorkers()]);
      setOrders(list);
      setWorkers(people);
      setWorkerTab((current) => current || people[0]?.user_id || "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "טעינת הליקוט נכשלה");
      setOrders((current) => current ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const queue = useMemo(
    () => orders?.filter((o) => o.status === "picking" && !o.picker_id) ?? [],
    [orders],
  );
  const mine = useMemo(
    () => orders?.filter((o) => o.status === "picking" && o.picker_id === meId) ?? [],
    [orders, meId],
  );
  const done = useMemo(
    () =>
      orders?.filter((o) =>
        ["picked", "awaiting_courier", "shipped", "delivered"].includes(o.status),
      ) ?? [],
    [orders],
  );
  const open = openId ? (orders?.find((o) => o.id === openId) ?? null) : null;

  const claim = async (order: PickingOrder) => {
    setBusy(order.id);
    try {
      await claimOrder(order.id);
      toast.success(`הזמנה ${order.order_number} אצלך`);
      await load();
      setOpenId(order.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "לא הצלחנו לקחת את ההזמנה");
      void load();
    } finally {
      setBusy(null);
    }
  };

  const onApproved = (orderId: string, shortages: Shortage[], status: "picked" | "shipped") => {
    onChanged?.();
    if (status === "picked") {
      toast.success("הליקוט הועבר לאישור מנהל");
      return;
    }
    // המייל ללקוח (תמונות + PDF) נשלח מהשרת; כישלון במייל לא מבטל את האישור
    void sendEmail({ data: { orderId, shortages } })
      .then((result) => {
        if (!result.sent) toast.warning(result.reason ?? "המייל ללקוח לא נשלח");
        else toast.success("נשלח ללקוח מייל: ההזמנה בדרך");
      })
      .catch((error: unknown) =>
        toast.warning(error instanceof Error ? error.message : "המייל ללקוח לא נשלח"),
      );
  };

  if (open) {
    return (
      <PickingScreen
        order={open}
        meId={meId}
        isAdmin={isAdmin}
        onBack={() => setOpenId(null)}
        onChanged={() => void load()}
        onApproved={onApproved}
      />
    );
  }

  const OrderCard = ({
    order,
    action,
  }: {
    order: PickingOrder;
    action: "claim" | "open" | "view";
  }) => (
    <Card
      className={`shadow-card ${order.is_urgent && order.status === "picking" ? "border-destructive/60" : ""}`}
    >
      <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-bold text-foreground">
              <span className="numeric">{order.order_number}</span> · {order.customer_name}
            </p>
            {order.is_urgent && order.status === "picking" && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="size-3" /> דחוף
              </Badge>
            )}
            {order.picking_paused && (
              <Badge variant="secondary" className="gap-1">
                <Pause className="size-3" /> בהשהיה
              </Badge>
            )}
            {order.short_lines > 0 && <Badge variant="outline">חוסרים: {order.short_lines}</Badge>}
            {order.status === "picked" && (
              <Badge className="bg-accent text-accent-foreground">ממתינה לאישור מנהל</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {order.total_lines} שורות
            {order.picked_lines > 0 && order.status === "picking"
              ? ` · לוקטו ${order.picked_lines}/${order.total_lines}`
              : ""}
            {order.picker_name
              ? ` · ${order.status === "picking" ? "אצל" : "ליקט/ה"}: ${order.picker_name}`
              : ""}
            {order.approved_by_name && order.approved_by_name !== order.picker_name
              ? ` · אישר: ${order.approved_by_name}`
              : ""}
            {" · "}
            {new Date(order.picked_at ?? order.created_at).toLocaleString("he-IL", {
              dateStyle: "short",
              timeStyle: "short",
            })}
          </p>
          {order.customer_address && (
            <p className="text-xs text-muted-foreground">{order.customer_address}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && order.status === "picking" && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              דחוף
              <Switch
                checked={order.is_urgent}
                onCheckedChange={(next) =>
                  void setOrderUrgent(order.id, next)
                    .then(load)
                    .catch((error: unknown) =>
                      toast.error(error instanceof Error ? error.message : "לא נשמר"),
                    )
                }
              />
            </label>
          )}
          {action === "claim" && (
            <Button size="lg" disabled={busy !== null} onClick={() => void claim(order)}>
              {busy === order.id ? <Loader2 className="size-4 animate-spin" /> : null} לקחת לליקוט
            </Button>
          )}
          {action === "open" && (
            <Button size="lg" onClick={() => setOpenId(order.id)}>
              {order.picking_paused ? "המשך ליקוט" : "ליקוט"}
            </Button>
          )}
          {action === "view" && (
            <Button variant="outline" onClick={() => setOpenId(order.id)}>
              {isAdmin && order.status === "picking" ? "פתח / אשר במקום העובד" : "צפייה"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );

  const Empty = ({ text }: { text: string }) => (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
        <ClipboardList className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{text}</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-bold text-foreground">ליקוט הזמנות</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void load()}
          className="gap-1 text-muted-foreground"
        >
          <RefreshCw className="size-4" /> רענון
        </Button>
      </div>
      {orders === null ? (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> טוען...
        </p>
      ) : (
        <Tabs value={tab} onValueChange={setTab} dir="rtl" className="space-y-4">
          <TabsList className="h-auto w-full flex-wrap justify-start">
            <TabsTrigger value="queue" className="text-base">
              לליקוט {queue.length > 0 && <span className="numeric ms-1">({queue.length})</span>}
            </TabsTrigger>
            <TabsTrigger value="mine" className="text-base">
              שלי {mine.length > 0 && <span className="numeric ms-1">({mine.length})</span>}
            </TabsTrigger>
            <TabsTrigger value="workers" className="text-base">
              מי מלקט מה
            </TabsTrigger>
            <TabsTrigger value="done" className="text-base">
              הושלמו
            </TabsTrigger>
            <TabsTrigger value="stats" className="text-base">
              הסטטיסטיקה שלי
            </TabsTrigger>
          </TabsList>

          <TabsContent value="queue" className="space-y-3">
            {queue.length === 0 ? (
              <Empty text="אין הזמנות שממתינות לליקוט" />
            ) : (
              queue.map((o) => <OrderCard key={o.id} order={o} action="claim" />)
            )}
          </TabsContent>

          <TabsContent value="mine" className="space-y-3">
            {mine.length === 0 ? (
              <Empty text='אין לך הזמנות באמצע ליקוט — קחו אחת מ"לליקוט"' />
            ) : (
              mine.map((o) => <OrderCard key={o.id} order={o} action="open" />)
            )}
          </TabsContent>

          <TabsContent value="workers" className="space-y-3">
            {workers.length === 0 ? (
              <Empty text="אין עדיין עובדי מחסן" />
            ) : (
              <Tabs value={workerTab} onValueChange={setWorkerTab} dir="rtl" className="space-y-3">
                <TabsList className="h-auto w-full flex-wrap justify-start">
                  {workers.map((w) => (
                    <TabsTrigger key={w.user_id} value={w.user_id}>
                      {w.name}
                      {w.active_orders > 0 && (
                        <span className="numeric ms-1">({w.active_orders})</span>
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {workers.map((w) => {
                  const theirs = orders.filter(
                    (o) => o.status === "picking" && o.picker_id === w.user_id,
                  );
                  return (
                    <TabsContent key={w.user_id} value={w.user_id} className="space-y-3">
                      {theirs.length === 0 ? (
                        <Empty text={`${w.name} לא מלקט/ת כרגע`} />
                      ) : (
                        theirs.map((o) => (
                          <OrderCard
                            key={o.id}
                            order={o}
                            action={w.user_id === meId ? "open" : "view"}
                          />
                        ))
                      )}
                    </TabsContent>
                  );
                })}
              </Tabs>
            )}
          </TabsContent>

          <TabsContent value="done" className="space-y-3">
            {done.length === 0 ? (
              <Empty text="עוד לא הושלמו ליקוטים" />
            ) : (
              done.map((o) => <OrderCard key={o.id} order={o} action="view" />)
            )}
          </TabsContent>

          <TabsContent value="stats">
            <PickingStats title="הליקוטים שלי" />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
