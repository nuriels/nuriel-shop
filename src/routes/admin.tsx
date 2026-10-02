import { createFileRoute, Link, useLoaderData, useRouteContext } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppFooter } from "@/components/AppFooter";
import { SabbathStaffBanner } from "@/components/StorefrontGate";
import { SiteHeader } from "@/components/SiteHeader";
import { OrderManagementPanel } from "@/components/OrderManagementPanel";
import { AdminUsersPanel } from "@/components/AdminUsersPanel";
import { AgentPerformancePanel } from "@/components/AgentPerformancePanel";
import { AdminProductsPanel } from "@/components/AdminProductsPanel";
import { CategoryManagementPanel } from "@/components/CategoryManagerDialog";
import { PendingProductsPanel } from "@/components/PendingProductsPanel";
import { SiteSettingsPanel } from "@/components/SiteSettingsPanel";
import { HomeBannersPanel } from "@/components/HomeBannersPanel";
import { StockCountPanel } from "@/components/StockCountPanel";
import { EmailSettingsPanel } from "@/components/EmailSettingsPanel";
import { CustomPricesPanel } from "@/components/CustomPricesPanel";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { AdminNav } from "@/components/AdminNav";
import { TransfersPanel } from "@/components/TransfersPanel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthState } from "@/hooks/useAuthState";

type Search = {
  /** לשונית ראשית בפאנל */
  tab?: string | undefined;
  /** מוצרים וקטגוריות: לשונית משנה (catalog / hidden / drafts) */
  ptab?: string | undefined;
  /** מוצרים וקטגוריות: הקטגוריה שנבחרה בעץ */
  pcat?: string | undefined;
  /** מחירי לקוחות מיוחדים: תיק הלקוח הפתוח */
  pcust?: string | undefined;
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
    if (tab) result.tab = tab;
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
  const { tab, ptab, pcat, pcust } = Route.useSearch();
  const navigate = Route.useNavigate();
  const activeTab = tab ?? "orders";

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const isAdmin = role?.role === "admin";
  // חנות שהוקפאה ע"י מנהל הפלטפורמה: הלקוחות רואים נעילה, והמנהל רואה כאן הסבר
  const { hostMode } = useRouteContext({ from: "__root__" });
  const site = useLoaderData({ from: "__root__" });

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {isAdmin && site?.sabbath && <SabbathStaffBanner isAdmin />}
      <SiteHeader role={role} email={session?.user.email ?? null} onSignOut={signOut} />
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-6 px-3 py-6 sm:px-4">
        {hostMode.suspended && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
            <p className="font-semibold text-destructive">האתר נעול זמנית ללקוחות</p>
            <p className="text-muted-foreground">
              החנות הוקפאה ע"י מנהל הפלטפורמה. הלקוחות רואים עמוד נעילה ולא יכולים להזמין, ופאנל
              הניהול ממשיך לעבוד. להסדרת המנוי פנו למנהל הפלטפורמה.
            </p>
          </div>
        )}
        {loading ? null : !isAdmin ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-sm text-muted-foreground">עמוד זה מיועד למנהלי המערכת בלבד.</p>
              <Button asChild>
                <Link to="/">חזרה לקטלוג</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          // תפריט בצד ימין (במחשב) / מגירה (בטלפון). הלשונית נשארת בכתובת (?tab=),
          // כך ש"חזור" וקישורים ישירים ממשיכים לעבוד כמו קודם
          <div className="space-y-4 md:grid md:grid-cols-[15rem_minmax(0,1fr)] md:items-start md:gap-6 md:space-y-0">
            <AdminNav
              value={activeTab}
              onChange={(next) => void navigate({ search: (prev) => ({ ...prev, tab: next }) })}
            />
            <Tabs value={activeTab} dir="rtl" className="min-w-0">
              <TabsContent value="orders">
                <OrderManagementPanel scope="admin" meId={role?.user_id} />
              </TabsContent>
              <TabsContent value="transfers">
                <TransfersPanel />
              </TabsContent>
              <TabsContent value="users">
                <AdminUsersPanel isAdmin={isAdmin} />
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
              <TabsContent value="categories">
                <CategoryManagementPanel />
              </TabsContent>
              <TabsContent value="pending">
                <PendingProductsPanel />
              </TabsContent>
              <TabsContent value="home">
                <HomeBannersPanel />
              </TabsContent>
              <TabsContent value="site">
                <SiteSettingsPanel />
              </TabsContent>
              <TabsContent value="email">
                <EmailSettingsPanel />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </main>
      <AppFooter />
    </div>
  );
}
