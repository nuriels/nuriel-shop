import { useCallback, useEffect, useMemo } from "react";
import { createFileRoute, Link, useLoaderData, useRouteContext } from "@tanstack/react-router";
import { AlertTriangle, Crown, Hourglass, Lock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppFooter } from "@/components/AppFooter";
import { SabbathStaffBanner } from "@/components/StorefrontGate";
import { GodModeBanner } from "@/components/GodModeBanner";
import { SiteHeader } from "@/components/SiteHeader";
import { OrderManagementPanel } from "@/components/OrderManagementPanel";
import { AdminDashboard } from "@/components/AdminDashboard";
import { AdminUsersPanel } from "@/components/AdminUsersPanel";
import { AgentPerformancePanel } from "@/components/AgentPerformancePanel";
import { AdminProductsPanel } from "@/components/AdminProductsPanel";
import { CategoryManagementPanel } from "@/components/CategoryManagerDialog";
import { PendingProductsPanel } from "@/components/PendingProductsPanel";
import { SiteSettingsPanel } from "@/components/SiteSettingsPanel";
import { SideBannerCard } from "@/components/marketing/SideBannerCard";
import { CartPromotionsPanel } from "@/components/sales/CartPromotionsPanel";
import { CouponsPanel } from "@/components/marketing/CouponsPanel";
import { AbandonedCartsPanel } from "@/components/marketing/AbandonedCartsPanel";
import { MarketingPanel } from "@/components/marketing/MarketingPanel";
import { HomeBannersPanel } from "@/components/HomeBannersPanel";
import { StockCountPanel } from "@/components/StockCountPanel";
import { PosPanel } from "@/components/pos/PosPanel";
import { BarcodeLabelsPanel } from "@/components/labels/BarcodeLabelsPanel";
import { StaffPanel } from "@/components/staff/StaffPanel";
import { ReviewsPanel } from "@/components/reviews/ReviewsPanel";
import { FulfillmentPanel } from "@/components/fulfillment/FulfillmentPanel";
import { PickingPanel } from "@/components/PickingPanel";
import { StockCheckPanel } from "@/components/StockCheckPanel";
import { EmailSettingsPanel } from "@/components/EmailSettingsPanel";
import { CustomDomainPanel } from "@/components/CustomDomainPanel";
import { OfflinePaymentMethodsCard } from "@/components/payments/OfflinePaymentMethodsCard";
import { ShippingMethodsPanel } from "@/components/ShippingMethodsPanel";
import { CustomPricesPanel } from "@/components/CustomPricesPanel";
import { BillingPanel } from "@/components/billing/BillingPanel";
import { AddonsStorePanel } from "@/components/billing/AddonsStorePanel";
import { LegalPagesPanel } from "@/components/legal/LegalPagesPanel";
import { PagesPanel } from "@/components/pages/PagesPanel";
import { CustomDomainSettingsCard } from "@/components/CustomDomainSettingsCard";
import { SiteInboxPanel, type InboxView } from "@/components/inbox/SiteInboxPanel";
import { PremiumLockCard } from "@/components/billing/PremiumLock";
import { SupportPanel, type SupportCompose } from "@/components/support/SupportPanel";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { AdminNav, EXPIRED_ALLOWED_TABS, adminSectionLabel } from "@/components/AdminNav";
import { TransfersPanel } from "@/components/TransfersPanel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthState } from "@/hooks/useAuthState";
import { useSubscription } from "@/hooks/useSubscription";
import { PLAN_LABELS, endingSoon, remainingLabel } from "@/lib/subscription";
import { usePlanCatalog } from "@/hooks/usePlanCatalog";
import type { PlanCatalog } from "@/lib/plan-catalog";
import {
  NO_PERMISSION_MESSAGE,
  STAFF_ROLE_LABEL,
  adminHomeTab,
  canEnterAdmin,
  canOpenAdminTab,
  effectiveStaffRole,
  staffCan,
} from "@/lib/permissions";

/** פניות מוכנות מראש (?compose=) — "לבחירת חבילה" ב"המנוי שלי" פותח פנייה לצוות */
const COMPOSE_KEYS = ["premium", "basic", "billing"] as const;

/** הנוסח עם המחיר העדכני מהעורך של מנהל הפלטפורמה (חלק 14) */
function composePresets(catalog: PlanCatalog): Record<string, SupportCompose> {
  const price = (plan: "basic" | "premium") =>
    catalog.plans[plan].monthlyPrice.toLocaleString("he-IL");
  return {
    premium: {
      subject: `בקשה למעבר ל${catalog.plans.premium.title}`,
      message: `שלום, נשמח לעבור ל${catalog.plans.premium.title} (${price("premium")} ₪ לחודש). נבקש לתאם את אופן התשלום — מראש לשנה או ב-12 תשלומים.`,
    },
    basic: {
      subject: `בקשה להצטרפות ל${catalog.plans.basic.title}`,
      message: `שלום, נשמח להצטרף ל${catalog.plans.basic.title} (${price("basic")} ₪ לחודש). נבקש לתאם את אופן התשלום — מראש לשנה או ב-12 תשלומים.`,
    },
    billing: { subject: "שאלה לגבי המנוי" },
  };
}

type Search = {
  /** לשונית ראשית בפאנל */
  tab?: string | undefined;
  /** מוצרים וקטגוריות: לשונית משנה (catalog / hidden / drafts) */
  ptab?: string | undefined;
  /** מוצרים וקטגוריות: הקטגוריה שנבחרה בעץ */
  pcat?: string | undefined;
  /** מחירי לקוחות מיוחדים: תיק הלקוח הפתוח */
  pcust?: string | undefined;
  /** הזמנות: הזמנה לפתוח ישירות ("צפה בהזמנה" מלוח הבקרה) */
  order?: string | undefined;
  /** תמיכה: הפנייה הפתוחה בצ'אט */
  ticket?: string | undefined;
  /** תמיכה: פנייה חדשה מוכנה מראש (premium / basic / billing) */
  compose?: string | undefined;
  /** פניות מהאתר (חלק 16א): contact / cancellations */
  inbox?: InboxView | undefined;
};

const pickString = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({ meta: [{ title: "ניהול המערכת" }] }),
  // המצב בכתובת: כל מעבר לשונית / קטגוריה נכנס להיסטוריה, ו"חזור" מחזיר אליו
  validateSearch: (search: Record<string, unknown>): Search => {
    const result: Search = {};
    const tab = pickString(search["tab"]);
    const ptab = pickString(search["ptab"]);
    const pcat = pickString(search["pcat"]);
    const pcust = pickString(search["pcust"]);
    const order = pickString(search["order"]);
    const ticket = pickString(search["ticket"]);
    const compose = pickString(search["compose"]);
    const inbox = search["inbox"];
    if (tab) result.tab = tab;
    if (inbox === "contact" || inbox === "cancellations") result.inbox = inbox;
    if (order && /^[0-9a-f-]{36}$/i.test(order)) result.order = order;
    if (ticket && /^[0-9a-f-]{36}$/i.test(ticket)) result.ticket = ticket;
    if (compose && (COMPOSE_KEYS as readonly string[]).includes(compose)) result.compose = compose;
    if (pcust) result.pcust = pcust;
    if (ptab) result.ptab = ptab;
    if (pcat) result.pcat = pcat;
    return result;
  },
  component: AdminPage,
});

function AdminPage() {
  const { session, role, loading } = useAuthState();
  // הלשונית נשמרת בכתובת (?tab=orders): כל מעבר נרשם בהיסטוריה, כך ש"חזור"
  // בדפדפן מחזיר ללשונית הקודמת במקום לצאת מהפאנל
  const { tab, ptab, pcat, pcust, order, ticket, compose, inbox } = Route.useSearch();
  const navigate = Route.useNavigate();

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  // חלק 33: התפקיד בצוות קובע מה פתוח בפאנל. בעלים / מנהל — הכל (מנהל: בלי
  // החבילה והתוספים); קופאי — הקופה; מחסנאי — ליקוט, משלוחים, מלאי ומדבקות
  const staffRole = effectiveStaffRole(role);
  const isAdmin = staffCan(staffRole, "admin");
  const canEnter = canEnterAdmin(staffRole);
  const homeTab = adminHomeTab(staffRole);
  // חנות שהוקפאה ע"י מנהל הפלטפורמה: הלקוחות רואים נעילה, והמנהל רואה כאן הסבר
  const { hostMode } = useRouteContext({ from: "__root__" });
  const site = useLoaderData({ from: "__root__" });
  const { subscription, can } = useSubscription();
  const { catalog } = usePlanCatalog();
  const presets = useMemo(() => composePresets(catalog), [catalog]);
  // המנוי פג: הפאנל נעול חוץ מ"המנוי שלי" ו"תמיכה ועזרה". מנהל-על (God Mode)
  // ממשיך לנהל — הוא זה שמאריך / מתעד תשלום.
  const godMode = role?.is_platform_admin === true && role.is_member === false;
  const expired = hostMode.lock === "expired";
  const locked = expired && !godMode;
  // המסך הראשון: מנהל — לוח הבקרה (ובחנות שהמנוי שלה פג — "המנוי שלי");
  // קופאי — הקופה; מחסנאי — הליקוט
  const requestedTab = tab ?? (locked && isAdmin ? "billing" : homeTab);
  // לשונית שאסורה לתפקיד (גם בכתובת ישירה) — חזרה למסך הבית שלו
  const permittedTab = canOpenAdminTab(staffRole, requestedTab) ? requestedTab : homeTab;
  const activeTab =
    locked && !EXPIRED_ALLOWED_TABS.includes(permittedTab) ? "billing" : permittedTab;
  // חנות שהמנוי שלה פג: לקופאי / מחסנאי אין "המנוי שלי" — הפאנל נעול עבורם
  const lockedForStaff = locked && !isAdmin;

  const goTab = useCallback(
    (next: string, extra: { compose?: string; ticket?: string } = {}) =>
      void navigate({
        search: (prev) => ({
          ...prev,
          tab: next,
          ticket: extra.ticket,
          compose: extra.compose,
        }),
      }),
    [navigate],
  );
  const setTicket = useCallback(
    (next: string | null) =>
      void navigate({
        search: (prev) => ({ ...prev, tab: "support", ticket: next ?? undefined }),
        resetScroll: false,
      }),
    [navigate],
  );
  // ניסיון גישה ללשונית חסומה (למשל קופאי ב-/admin/analytics) — הודעה + מסך הבית
  const deniedTab =
    !loading && canEnter && tab !== undefined && !canOpenAdminTab(staffRole, tab) ? tab : null;
  useEffect(() => {
    if (!deniedTab) return;
    toast.error(NO_PERMISSION_MESSAGE, {
      id: "admin-no-permission",
      description: `הועברת למסך "${adminSectionLabel(homeTab)}"`,
    });
    void navigate({
      search: (prev) => ({ ...prev, tab: homeTab, order: undefined }),
      replace: true,
    });
  }, [deniedTab, homeTab, navigate]);

  const clearCompose = useCallback(
    () =>
      void navigate({
        search: (prev) => ({ ...prev, compose: undefined }),
        replace: true,
        resetScroll: false,
      }),
    [navigate],
  );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <GodModeBanner role={role} />
      {isAdmin && site?.sabbath && <SabbathStaffBanner isAdmin />}
      <SiteHeader role={role} email={session?.user.email ?? null} onSignOut={signOut} />
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-3 py-6 sm:px-4">
        {hostMode.lock === "suspended" && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
            <p className="font-semibold text-destructive">האתר נעול זמנית ללקוחות</p>
            <p className="text-muted-foreground">
              החנות הוקפאה ע"י מנהל הפלטפורמה. הלקוחות רואים עמוד נעילה ולא יכולים להזמין, ופאנל
              הניהול ממשיך לעבוד. להסדרת המנוי פנו למנהל הפלטפורמה.
            </p>
          </div>
        )}
        {/* בלשונית "המנוי שלי" ההסבר כבר בראש העמוד — לא מציגים פעמיים */}
        {isAdmin && expired && activeTab !== "billing" && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
            <AlertTriangle className="size-5 shrink-0 text-destructive" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-destructive">
                {subscription?.plan === "trial" ? "תקופת הניסיון הסתיימה" : "המנוי של החנות הסתיים"}
              </p>
              <p className="text-muted-foreground">
                {godMode
                  ? 'מנהל-על: הפאנל פתוח לך. בעל החנות רואה רק את "המנוי שלי" ו"תמיכה ועזרה" עד לחידוש.'
                  : 'האתר סגור ללקוחות ופאנל הניהול נעול. בחרו חבילה ב"המנוי שלי" — והחנות חוזרת לפעילות מיד אחרי התשלום.'}
              </p>
            </div>
            {activeTab !== "billing" && (
              <Button size="sm" variant="destructive" onClick={() => goTab("billing")}>
                <Crown className="size-4" />
                למנוי שלי
              </Button>
            )}
          </div>
        )}
        {isAdmin &&
          subscription &&
          !expired &&
          (subscription.plan === "trial" || endingSoon(subscription)) &&
          activeTab !== "billing" && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
              <Hourglass className="size-4 shrink-0" aria-hidden="true" />
              <p className="min-w-0 flex-1">
                {subscription.plan === "trial"
                  ? `תקופת ניסיון — ${remainingLabel(subscription)}. כל הפיצ'רים של פרימיום פתוחים לכם.`
                  : `המנוי (${PLAN_LABELS[subscription.plan]}) — ${remainingLabel(subscription)}.`}
              </p>
              <button
                type="button"
                onClick={() => goTab("billing")}
                className="font-semibold underline-offset-4 hover:underline"
              >
                לבחירת חבילה
              </button>
            </div>
          )}
        {loading ? null : !canEnter ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-sm text-muted-foreground">עמוד זה מיועד לצוות החנות בלבד.</p>
              <Button asChild>
                <Link to="/">חזרה לקטלוג</Link>
              </Button>
            </CardContent>
          </Card>
        ) : lockedForStaff ? (
          <Card className="border-dashed" data-testid="staff-store-locked">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <Lock className="size-6 text-muted-foreground" aria-hidden="true" />
              <p className="font-semibold">המנוי של החנות הסתיים — הניהול נעול זמנית</p>
              <p className="max-w-md text-sm text-muted-foreground">
                {staffRole ? `${STAFF_ROLE_LABEL[staffRole]}: ` : ""}
                הגישה תחזור מיד כשבעל החנות יחדש את המנוי. בינתיים אפשר לפנות אליו.
              </p>
            </CardContent>
          </Card>
        ) : (
          // תפריט בצד ימין (במחשב) / מגירה (בטלפון). הלשונית נשארת בכתובת (?tab=),
          // כך ש"חזור" וקישורים ישירים ממשיכים לעבוד כמו קודם
          <div className="space-y-4 md:grid md:grid-cols-[15rem_minmax(0,1fr)] md:items-start md:gap-6 md:space-y-0">
            <AdminNav
              value={activeTab}
              onChange={(next) => goTab(next)}
              locked={locked}
              staffRole={staffRole}
            />
            <Tabs value={activeTab} dir="rtl" className="min-w-0">
              <TabsContent value="dashboard">
                <AdminDashboard
                  onOpenOrder={(orderId) =>
                    void navigate({
                      search: (prev) => ({ ...prev, tab: "orders", order: orderId }),
                    })
                  }
                  onOpenTab={(next) =>
                    void navigate({ search: (prev) => ({ ...prev, tab: next }) })
                  }
                />
              </TabsContent>
              <TabsContent value="orders">
                <OrderManagementPanel
                  scope="admin"
                  {...(role ? { meId: role.user_id } : {})}
                  openOrderId={order ?? null}
                  onOrderOpened={() =>
                    void navigate({
                      search: (prev) => ({ ...prev, order: undefined }),
                      replace: true,
                      resetScroll: false,
                    })
                  }
                />
              </TabsContent>
              {/* חלק 32: קופה מהירה — הזמנה טלפונית / מכירה בחנות (/admin/orders/new) */}
              <TabsContent value="pos">
                {/* קופאי לא רואה הזמנות (ההכנסות של החנות) — בלי "פתיחת ההזמנה" */}
                <PosPanel
                  {...(isAdmin
                    ? {
                        onOpenOrder: (orderId: string) =>
                          void navigate({
                            search: (prev) => ({ ...prev, tab: "orders", order: orderId }),
                          }),
                      }
                    : {})}
                />
              </TabsContent>
              {/* חלק 33: המסכים של המחסנאי — ליקוט, סטטוס משלוחים, בדיקת מלאי */}
              <TabsContent value="picking">
                {role && <PickingPanel meId={role.user_id} isAdmin={isAdmin} />}
              </TabsContent>
              <TabsContent value="fulfillment">
                <FulfillmentPanel />
              </TabsContent>
              <TabsContent value="stock-check">
                <StockCheckPanel />
              </TabsContent>
              {/* חלק 33: צוות והרשאות (/admin/settings/staff) */}
              <TabsContent value="staff">
                {role && <StaffPanel meId={role.user_id} myRole={staffRole} />}
              </TabsContent>
              <TabsContent value="inbox">
                <SiteInboxPanel
                  view={inbox ?? "contact"}
                  onViewChange={(next) =>
                    void navigate({
                      search: (prev) => ({ ...prev, inbox: next }),
                      resetScroll: false,
                    })
                  }
                  onOpenOrder={(orderId) =>
                    void navigate({
                      search: (prev) => ({
                        ...prev,
                        tab: "orders",
                        order: orderId,
                        inbox: undefined,
                      }),
                    })
                  }
                />
              </TabsContent>
              <TabsContent value="transfers">
                <TransfersPanel />
              </TabsContent>
              <TabsContent value="users">
                <AdminUsersPanel
                  isAdmin={isAdmin}
                  canManageManagers={staffCan(staffRole, "staff.managers")}
                />
              </TabsContent>
              <TabsContent value="custom-prices">
                <CustomPricesPanel
                  customerId={pcust ?? null}
                  onCustomerChange={(next) =>
                    void navigate({ search: (prev) => ({ ...prev, pcust: next ?? undefined }) })
                  }
                />
              </TabsContent>
              <TabsContent value="performance">
                <AgentPerformancePanel />
              </TabsContent>
              <TabsContent value="products">
                <AdminProductsPanel
                  tab={ptab}
                  onTabChange={(next) =>
                    void navigate({
                      search: (prev) => ({ ...prev, ptab: next }),
                      resetScroll: false,
                    })
                  }
                  category={pcat ?? null}
                  onCategoryChange={(next) =>
                    void navigate({
                      search: (prev) => ({ ...prev, pcat: next ?? undefined }),
                      resetScroll: false,
                    })
                  }
                />
              </TabsContent>
              <TabsContent value="stock">
                <StockCountPanel />
              </TabsContent>
              {/* חלק 32: מחולל מדבקות ברקוד (/admin/inventory/labels) */}
              <TabsContent value="labels">
                <BarcodeLabelsPanel />
              </TabsContent>
              <TabsContent value="categories">
                <CategoryManagementPanel />
              </TabsContent>
              <TabsContent value="pending">
                <PendingProductsPanel />
              </TabsContent>
              <TabsContent value="home">
                <HomeBannersPanel />
              </TabsContent>
              <TabsContent value="promotions">
                <CartPromotionsPanel />
              </TabsContent>
              <TabsContent value="coupons">
                <CouponsPanel />
              </TabsContent>
              <TabsContent value="abandoned">
                <AbandonedCartsPanel />
              </TabsContent>
              {/* חלק 34: ביקורות לקוחות (/admin/marketing/reviews) */}
              <TabsContent value="reviews">
                <ReviewsPanel />
              </TabsContent>
              <TabsContent value="shipping">
                <ShippingMethodsPanel />
              </TabsContent>
              <TabsContent value="site" className="space-y-6">
                <SiteSettingsPanel />
                {/* חלק 19: באנר צדדי למסכי מחשב */}
                <SideBannerCard />
                {/* חלק 30: דומיין אישי (המנגנון המלא — לשונית "דומיין פרטי") */}
                <CustomDomainSettingsCard onOpenDomainTab={() => goTab("domain")} />
                {/* חלק 17ב: אמצעי התשלום בקופה — טלפוני מול נציג / ביט */}
                <OfflinePaymentMethodsCard />
              </TabsContent>
              <TabsContent value="legal">
                <LegalPagesPanel />
              </TabsContent>
              <TabsContent value="pages">
                <PagesPanel />
              </TabsContent>
              <TabsContent value="marketing">
                <MarketingPanel />
              </TabsContent>
              <TabsContent value="email">
                <EmailSettingsPanel />
              </TabsContent>
              <TabsContent value="domain">
                {can("customDomain") ? (
                  <CustomDomainPanel />
                ) : (
                  <PremiumLockCard
                    title="חיבור דומיין אישי משלך"
                    description="כתובת משלכם (למשל www.my-shop.co.il) עם תעודת אבטחה אוטומטית — זמין בחבילת פרימיום, או כתוסף לחבילה הבסיסית. בינתיים החנות זמינה בסאב-דומיין היוקרתי שלה."
                    addon="custom_domain"
                  />
                )}
              </TabsContent>
              <TabsContent value="addons">
                <AddonsStorePanel canPurchase={staffCan(staffRole, "billing.manage")} />
              </TabsContent>
              <TabsContent value="billing">
                <BillingPanel
                  canManageBilling={staffCan(staffRole, "billing.manage")}
                  onChoosePlan={(plan) => goTab("support", { compose: plan })}
                  onContactSupport={() => goTab("support", { compose: "billing" })}
                />
              </TabsContent>
              <TabsContent value="support">
                <SupportPanel
                  ticketId={ticket ?? null}
                  onTicketChange={setTicket}
                  compose={compose ? (presets[compose] ?? null) : null}
                  onComposeHandled={clearCompose}
                />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </main>
      <AppFooter />
    </div>
  );
}
