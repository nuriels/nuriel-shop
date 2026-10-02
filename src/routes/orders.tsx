import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock,
  Loader2,
  Package,
  RefreshCw,
  RotateCcw,
  Truck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppFooter } from "@/components/AppFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { OrderDocumentButton } from "@/components/OrderDocumentButton";
import { OrdersByYear } from "@/components/OrdersByYear";
import { GroupSidebarLayout, type SideGroup } from "@/components/GroupSidebarLayout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatIls } from "@/lib/catalog";
import {
  ORDER_GROUPS,
  ORDER_SELECT_COLUMNS,
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABEL,
  formatOrderDate,
  orderGroupOf,
  type OrderGroup,
  type OrderRow,
} from "@/lib/orders";

const GROUP_ICON: Record<OrderGroup, typeof Clock> = {
  awaiting: Clock,
  approved: CheckCircle2,
  completed: Truck,
  cancelled: XCircle,
};
import { calculateVat } from "@/lib/vat";
import { useAuthState } from "@/hooks/useAuthState";
import { useCustomerProfile } from "@/hooks/useCustomerProfile";
import { OnboardingGate } from "@/components/OnboardingGate";
import { useServerFn } from "@tanstack/react-start";
import { reorderOrder } from "@/lib/orders.functions";
import { sendOrderEmails } from "@/lib/email.functions";

export const Route = createFileRoute("/orders")({
  ssr: false,
  head: () => ({ meta: [{ title: "ההזמנות שלי" }] }),
  component: OrdersPage,
});

function OrdersPage() {
  const { session, role, loading: authLoading, refreshRole } = useAuthState();
  const {
    profile,
    loading: profileLoading,
    refresh: refreshProfile,
  } = useCustomerProfile(role?.role === "customer" ? role.user_id : null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [chosenGroup, setChosenGroup] = useState<OrderGroup | null>(null);
  /** שמות הסוכנים בעברית להצגה ללקוח — דרך staff_display_names (בלי אימיילים) */
  const [agentNames, setAgentNames] = useState<Map<string, string>>(new Map());
  const [reordering, setReordering] = useState<string | null>(null);
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
    if (session) void load();
  }, [session, load]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

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
      void load();
      try {
        await sendEmails({ data: { orderId: result.orderId } });
      } catch {
        // כשל שליחת מייל אינו מבטל את ההזמנה
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שכפול ההזמנה נכשל");
    } finally {
      setReordering(null);
    }
  };

  // אותה חסימת כניסה ראשונה כמו בקטלוג, כדי שלא יעקפו אותה דרך הכתובת
  const needsOnboarding =
    role?.role === "customer" &&
    !role.is_blocked &&
    !profileLoading &&
    (role.must_change_password || profile === null || !profile.profile_completed);

  if (needsOnboarding && role) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <SiteHeader role={role} email={session?.user.email ?? null} onSignOut={signOut} />
        <OnboardingGate
          userId={role.user_id}
          email={role.email}
          mustChangePassword={role.must_change_password}
          onDone={() => {
            void refreshRole();
            void refreshProfile();
          }}
        />
        <AppFooter />
      </div>
    );
  }

  const groupCounts: Record<OrderGroup, number> = {
    awaiting: 0,
    approved: 0,
    completed: 0,
    cancelled: 0,
  };
  for (const order of orders) groupCounts[orderGroupOf(order.status)] += 1;
  // ברירת מחדל: הקבוצה הראשונה שיש בה הזמנות — קודם מה שעדיין בתהליך
  const group: OrderGroup =
    chosenGroup ??
    (["awaiting", "approved", "completed", "cancelled"] as OrderGroup[]).find(
      (id) => groupCounts[id] > 0,
    ) ??
    "awaiting";
  const groupInfo = ORDER_GROUPS.find((g) => g.id === group)!;
  const visibleOrders = orders.filter((order) => orderGroupOf(order.status) === group);
  // "מבוטלות" תמיד שורה נפרדת (אחרי קו מפריד), גם כשהיא ריקה
  const sideGroups: SideGroup<OrderGroup>[] = ORDER_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    count: groupCounts[g.id],
    icon: GROUP_ICON[g.id],
    attention: g.id === "awaiting",
    divider: g.id === "cancelled",
  }));

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader role={role} email={session?.user.email ?? null} onSignOut={signOut} />
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-5 px-3 py-8 sm:px-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl text-foreground">ההזמנות שלי</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              היסטוריית ההזמנות ובקשות הצעת המחיר שלך, כולל מסמך PDF להורדה
            </p>
          </div>
          {session && (
            <Button variant="outline" disabled={loading} onClick={() => void load()}>
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
              רענון נתונים
            </Button>
          )}
        </div>

        {authLoading ? null : !session ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-sm text-muted-foreground">
                יש להתחבר כדי לצפות בהיסטוריית ההזמנות
              </p>
              <Button asChild>
                <Link to="/login">התחברות</Link>
              </Button>
            </CardContent>
          </Card>
        ) : role?.role !== "customer" ? (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              עמוד זה מיועד ללקוחות עסקיים בלבד.
            </CardContent>
          </Card>
        ) : loading ? (
          <p className="text-sm text-muted-foreground">טוען הזמנות...</p>
        ) : orders.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <ClipboardList className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">עדיין לא ביצעת הזמנות</p>
              <Button asChild>
                <Link to="/">מעבר לקטלוג</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <GroupSidebarLayout
            title="ההזמנות שלי"
            groups={sideGroups}
            value={group}
            onChange={setChosenGroup}
          >
            <div>
              <h2 className="font-display text-xl text-foreground">{groupInfo.label}</h2>
              <p className="text-sm text-muted-foreground">{groupInfo.customerHint}</p>
            </div>
            <OrdersByYear
              items={visibleOrders}
              getDate={(order) => order.created_at}
              emptyText={`אין הזמנות ב"${groupInfo.label}"`}
              renderItem={(order) => {
                const isOpen = expanded === order.id;
                const isQuote = order.kind === "quote";
                const itemsTotal = order.order_items.reduce(
                  (sum, item) => sum + Number(item.unit_price) * item.quantity,
                  0,
                );
                const vat = calculateVat(itemsTotal, {
                  pricesIncludeVat: order.prices_include_vat ?? true,
                  vatRate: Number(order.vat_rate ?? 18),
                });

                return (
                  <Card key={order.id} className="shadow-card">
                    <CardContent className="space-y-3">
                      <button
                        type="button"
                        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-3 text-right"
                        aria-expanded={isOpen}
                        onClick={() => setExpanded(isOpen ? null : order.id)}
                      >
                        <div className="min-w-0">
                          <p
                            dir="ltr"
                            className="numeric truncate text-left font-bold text-foreground"
                          >
                            {order.order_number}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatOrderDate(order.created_at)}
                          </p>
                          {order.agent_id && agentNames.get(order.agent_id) && (
                            <p className="text-xs text-muted-foreground">
                              סוכן מטפל:{" "}
                              <span className="font-medium text-foreground">
                                {agentNames.get(order.agent_id)}
                              </span>
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {isQuote && <Badge variant="outline">הצעת מחיר</Badge>}
                          <Badge variant={ORDER_STATUS_BADGE[order.status]}>
                            {ORDER_STATUS_LABEL[order.status]}
                          </Badge>
                          <ChevronDown
                            className={`size-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                          />
                        </div>
                      </button>

                      {isOpen && (
                        <ul className="space-y-2 border-t border-border pt-3 text-sm">
                          {order.order_items.map((item) => (
                            <li key={item.id} className="flex items-center gap-3">
                              <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-secondary/60 p-1">
                                {item.product_image_url ? (
                                  <img
                                    src={item.product_image_url}
                                    alt=""
                                    loading="lazy"
                                    className="size-full object-contain mix-blend-multiply"
                                  />
                                ) : (
                                  <Package className="size-4 text-muted-foreground" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate">
                                  {item.product_name ?? "מוצר"} × {item.quantity}
                                </p>
                                {item.product_barcode && (
                                  <p
                                    dir="ltr"
                                    className="numeric text-right text-xs text-muted-foreground"
                                  >
                                    {item.product_barcode}
                                  </p>
                                )}
                              </div>
                              {!isQuote && (
                                <span className="numeric shrink-0 font-medium">
                                  {formatIls(Number(item.unit_price) * item.quantity)}
                                </span>
                              )}
                            </li>
                          ))}
                          <li className="pt-1 text-xs text-muted-foreground">
                            התמונות להמחשה בלבד
                          </li>
                        </ul>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                        <span className="text-sm text-muted-foreground">
                          {order.order_items.length} פריטים
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
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
                          <OrderDocumentButton
                            orderId={order.id}
                            variant="ghost"
                            label={isQuote ? "מסמך הבקשה" : "אישור הזמנה"}
                          />
                          {isQuote ? (
                            <span className="text-sm text-muted-foreground">ממתין להצעת מחיר</span>
                          ) : (
                            <div className="text-right">
                              <span className="numeric text-lg font-bold text-accent">
                                {formatIls(vat.gross)}
                              </span>
                              <p className="text-xs text-muted-foreground">
                                {vat.showBreakdown ? `כולל מע״מ ${vat.vatRate}%` : "כולל מע״מ"}
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              }}
            />
          </GroupSidebarLayout>
        )}
      </main>
      <AppFooter />
    </div>
  );
}
