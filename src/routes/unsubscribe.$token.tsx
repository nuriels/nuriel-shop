import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CircleCheck, Loader2, MailX } from "lucide-react";
import { AppFooter } from "@/components/AppFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { StorefrontMain } from "@/components/layout/StorefrontMain";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuthState } from "@/hooks/useAuthState";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { unsubscribeMarketing } from "@/lib/marketing-consent.functions";

/**
 * חלק 40: הסרה מרשימת הדיוור — הקישור שבתחתית כל מייל שיווקי. ההסרה מתבצעת
 * מיד בכניסה לעמוד (בלי התחברות ובלי שאלות), והעמוד מאשר שהיא בוצעה.
 */
export const Route = createFileRoute("/unsubscribe/$token")({
  ssr: false,
  head: () => ({ meta: [{ title: "הסרה מרשימת הדיוור" }, { name: "robots", content: "noindex" }] }),
  component: UnsubscribePage,
});

function UnsubscribePage() {
  const { token } = Route.useParams();
  const { session, role } = useAuthState();
  const { settings } = useSiteSettings();
  const unsubscribe = useServerFn(unsubscribeMarketing);
  const [state, setState] = useState<"working" | "done" | "missing" | "error">("working");
  const ran = useRef(false);
  const storeName = settings?.business_name?.trim() || settings?.site_title?.trim() || "החנות";

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void unsubscribe({ data: { token } })
      .then((result) => setState(result.removed ? "done" : "missing"))
      .catch(() => setState("error"));
  }, [token, unsubscribe]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader
        role={role}
        email={session?.user.email ?? null}
        onSignOut={async () => {
          await supabase.auth.signOut();
        }}
      />
      <StorefrontMain width="5xl" className="py-8" contentClassName="space-y-4">
        <Card className="mx-auto max-w-xl" data-testid="unsubscribe-result" data-state={state}>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            {state === "working" ? (
              <>
                <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
                <p role="status">מסירים אותך מרשימת הדיוור…</p>
              </>
            ) : state === "done" ? (
              <>
                <CircleCheck className="size-10 text-emerald-600" aria-hidden="true" />
                <h1 className="text-xl font-bold">הוסרת מרשימת הדיוור</h1>
                <p role="status" className="text-sm text-muted-foreground">
                  לא נשלח לך יותר דיוור שיווקי מ{storeName}. הודעות על הזמנות שביצעת (אישור, משלוח)
                  ימשיכו להגיע.
                </p>
              </>
            ) : (
              <>
                <MailX className="size-10 text-muted-foreground" aria-hidden="true" />
                <h1 className="text-xl font-bold">
                  {state === "missing" ? "הקישור לא נמצא" : "ההסרה לא הצליחה"}
                </h1>
                <p role="alert" className="text-sm text-muted-foreground">
                  {state === "missing"
                    ? "ייתכן שהקישור שייך לחנות אחרת. אפשר גם להשיב למייל או לפנות אלינו, ונסיר אותך מיד."
                    : "נסו שוב בעוד רגע, או פנו אלינו ונסיר אותך מיד."}
                </p>
                <Button asChild variant="outline">
                  <Link to="/contact">צור קשר</Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </StorefrontMain>
      <AppFooter />
    </div>
  );
}
