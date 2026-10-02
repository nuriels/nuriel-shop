import { createFileRoute, Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppFooter } from "@/components/AppFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { PickingPanel } from "@/components/PickingPanel";
import { StockCheckPanel } from "@/components/StockCheckPanel";
import { TransfersPanel } from "@/components/TransfersPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthState } from "@/hooks/useAuthState";

export const Route = createFileRoute("/warehouse")({
  ssr: false,
  head: () => ({ meta: [{ title: "ליקוט הזמנות" }] }),
  component: WarehousePage,
});

/** אזור המחסנאי: רק ליקוט. המנהל יכול להיכנס גם הוא (אותו מסך כמו בניהול) */
function WarehousePage() {
  const { session, role, loading } = useAuthState();
  const allowed = role?.role === "warehouse" || role?.role === "admin";
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader
        role={role}
        email={session?.user.email ?? null}
        onSignOut={() => void supabase.auth.signOut()}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-3 py-6 sm:px-4">
        {loading ? null : !allowed ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <p className="text-sm text-muted-foreground">עמוד זה מיועד לעובדי המחסן בלבד.</p>
              <Button asChild>
                <Link to="/">חזרה לקטלוג</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="picking" dir="rtl" className="space-y-4">
            <TabsList className="grid h-auto w-full grid-cols-3">
              <TabsTrigger value="picking" className="py-2 text-base">
                ליקוט
              </TabsTrigger>
              <TabsTrigger value="stock" className="py-2 text-base">
                בדיקת מלאי
              </TabsTrigger>
              <TabsTrigger value="transfers" className="py-2 text-base">
                העברה בין איתורים
              </TabsTrigger>
            </TabsList>
            <TabsContent value="picking">
              <PickingPanel meId={role!.user_id} isAdmin={role!.role === "admin"} />
            </TabsContent>
            <TabsContent value="stock">
              <StockCheckPanel />
            </TabsContent>
            <TabsContent value="transfers">
              <TransfersPanel />
            </TabsContent>
          </Tabs>
        )}
      </main>
      <AppFooter />
    </div>
  );
}
