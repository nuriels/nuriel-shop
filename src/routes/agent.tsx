import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppFooter } from "@/components/AppFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { AgentCustomersPanel } from "@/components/AgentCustomersPanel";
import { OrderManagementPanel } from "@/components/OrderManagementPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthState } from "@/hooks/useAuthState";

type Search = { tab?: string | undefined };

export const Route = createFileRoute("/agent")({
  ssr: false,
  head: () => ({ meta: [{ title: "פאנל סוכן" }] }),
  validateSearch: (search: Record<string, unknown>): Search =>
    typeof search["tab"] === "string" ? { tab: search["tab"] } : {},
  component: AgentPage,
});

function AgentPage() {
  const { session, role, loading } = useAuthState();
  // הלשונית נשלטת מה-URL (?tab=orders), כדי שהקישור המהיר בכותרת
  // יוכל לפתוח ישירות את לשונית ההזמנות
  const { tab } = Route.useSearch();
  const [activeTab, setActiveTab] = useState(tab ?? "customers");

  useEffect(() => {
    if (tab) setActiveTab(tab);
  }, [tab]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader role={role} email={session?.user.email ?? null} onSignOut={signOut} />
      <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-3 py-6 sm:px-4">
        {loading ? null : role?.role !== "agent" ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-sm text-muted-foreground">עמוד זה מיועד לסוכנים בלבד.</p>
              <Button asChild>
                <Link to="/">חזרה לקטלוג</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={(next) => setActiveTab(next)}
            dir="rtl"
            className="space-y-6"
          >
            <TabsList>
              <TabsTrigger value="customers">הלקוחות שלי</TabsTrigger>
              <TabsTrigger value="orders">הזמנות</TabsTrigger>
            </TabsList>
            <TabsContent value="customers">
              <AgentCustomersPanel agentId={role.user_id} />
            </TabsContent>
            <TabsContent value="orders">
              <OrderManagementPanel scope="agent" />
            </TabsContent>
          </Tabs>
        )}
      </main>
      <AppFooter />
    </div>
  );
}
