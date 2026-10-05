import { createFileRoute, Link } from "@tanstack/react-router";
import { ClipboardList, LogIn, UserRound, UserRoundPen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppFooter } from "@/components/AppFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { AccountNotice } from "@/components/AccountNotice";
import { OnboardingGate } from "@/components/OnboardingGate";
import { CustomerOrdersTab } from "@/components/account/CustomerOrdersTab";
import { MyDetailsForm } from "@/components/account/MyDetailsForm";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuthState } from "@/hooks/useAuthState";
import { useCustomerProfile } from "@/hooks/useCustomerProfile";
import { usePriceTiersEnabled } from "@/hooks/usePriceTiers";

type AccountTab = "orders" | "details";
type Search = { tab?: AccountTab };

/**
 * האזור האישי של הלקוח: "היסטוריית הזמנות" (רשימה + פירוט / קבלה בחלון)
 * ו"הפרטים שלי" (ברירת המחדל בקופה). הלשונית נשמרת בכתובת (?tab=).
 */
export const Route = createFileRoute("/account")({
  ssr: false,
  head: () => ({ meta: [{ title: "האזור האישי" }] }),
  validateSearch: (search: Record<string, unknown>): Search =>
    search["tab"] === "details" || search["tab"] === "orders" ? { tab: search["tab"] } : {},
  component: AccountPage,
});

function AccountPage() {
  const { session, role, loading, refreshRole } = useAuthState();
  const isCustomer = role?.role === "customer";
  const { profile, refresh: refreshProfile } = useCustomerProfile(
    isCustomer ? (role?.user_id ?? null) : null,
  );
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const activeTab: AccountTab = tab ?? "orders";
  const email = session?.user.email ?? role?.email ?? "";
  // חנות B2B = דרגי מחיר פעילים: רק שם אישור המנהל משנה משהו ללקוח
  const b2b = usePriceTiersEnabled();

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  if (role?.is_blocked) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <SiteHeader role={null} email={null} />
        <AccountNotice variant="blocked" email={email} onSignOut={signOut} />
        <AppFooter />
      </div>
    );
  }
  if (isCustomer && role?.must_change_password) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <SiteHeader role={role} email={email} onSignOut={signOut} />
        <OnboardingGate
          userId={role.user_id}
          email={role.email}
          mustChangePassword
          onDone={() => void refreshRole()}
        />
        <AppFooter />
      </div>
    );
  }

  const greetingName = profile?.contact_name?.trim() || profile?.business_name?.trim() || "";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader role={role} email={session?.user.email ?? null} onSignOut={signOut} />
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-3 py-8 sm:px-4">
        {loading ? null : !session ? (
          <Card className="mx-auto max-w-lg border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <UserRound className="size-9 text-muted-foreground" aria-hidden="true" />
              <h1 className="text-lg font-bold text-foreground">האזור האישי</h1>
              <p className="text-sm text-muted-foreground">
                התחברו כדי לראות את היסטוריית ההזמנות ולעדכן פרטים. הזמנתם כאורח? אישור ההזמנה נשלח
                אליכם במייל.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button asChild>
                  <Link to="/login">
                    <LogIn className="size-4" />
                    התחברות
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/register">פתיחת חשבון</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : !isCustomer ? (
          <Card className="mx-auto max-w-lg border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-sm text-muted-foreground">האזור האישי מיועד ללקוחות החנות.</p>
              <Button asChild>
                <Link to={role?.role === "agent" ? "/agent" : "/admin"}>לפאנל העבודה</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="font-display text-2xl text-foreground sm:text-3xl">
                  {greetingName ? `שלום, ${greetingName}` : "האזור האישי"}
                </h1>
                <p dir="ltr" className="text-right text-sm text-muted-foreground">
                  {email}
                </p>
              </div>
              {/* רק בחנות B2B (דרגי מחיר פעילים) — ללקוח קמעונאי זה מרתיע */}
              {!role?.is_approved && b2b && (
                <p className="rounded-lg border border-accent/40 bg-accent/5 px-3 py-2 text-xs text-foreground">
                  החשבון ממתין לאישור מנהל — בינתיים מזמינים לפי המחירון הרגיל.
                </p>
              )}
            </div>

            <Tabs
              value={activeTab}
              onValueChange={(next) =>
                void navigate({ search: { tab: next as AccountTab }, resetScroll: false })
              }
              dir="rtl"
              className="space-y-5"
            >
              <TabsList className="h-auto w-full justify-start gap-1 p-1 sm:w-auto">
                <TabsTrigger value="orders" className="flex-1 gap-1.5 py-2 sm:flex-none sm:px-5">
                  <ClipboardList className="size-4" aria-hidden="true" />
                  היסטוריית הזמנות
                </TabsTrigger>
                <TabsTrigger value="details" className="flex-1 gap-1.5 py-2 sm:flex-none sm:px-5">
                  <UserRoundPen className="size-4" aria-hidden="true" />
                  הפרטים שלי
                </TabsTrigger>
              </TabsList>
              <TabsContent value="orders">
                <CustomerOrdersTab profile={profile} accountEmail={email || null} />
              </TabsContent>
              <TabsContent value="details">
                {role && (
                  <MyDetailsForm
                    userId={role.user_id}
                    email={email}
                    onSaved={() => void refreshProfile()}
                  />
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </main>
      <AppFooter />
    </div>
  );
}
