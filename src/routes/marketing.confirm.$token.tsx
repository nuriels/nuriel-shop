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
import { confirmMarketing } from "@/lib/marketing-consent.functions";

/**
 * SEC-H5 — אישור כפול לדיוור: הקישור במייל האישור. ההצטרפות נכנסת לתוקף בכניסה לעמוד
 * (האסימון החד-פעמי הוא ההוכחה שבעל הכתובת ביקש), ורק אז נשלחים "ברוכים הבאים" והקופון
 * שביקשו בחלון הקופץ.
 */
export const Route = createFileRoute("/marketing/confirm/$token")({
  ssr: false,
  head: () => ({
    meta: [{ title: "אישור הצטרפות לדיוור" }, { name: "robots", content: "noindex" }],
  }),
  component: ConfirmMarketingPage,
});

type State = "working" | "done" | "missing" | "error";

function ConfirmMarketingPage() {
  const { token } = Route.useParams();
  const { session, role } = useAuthState();
  const { settings } = useSiteSettings();
  const confirm = useServerFn(confirmMarketing);
  const [state, setState] = useState<State>("working");
  const [couponSent, setCouponSent] = useState(false);
  const ran = useRef(false);
  const storeName = settings?.business_name?.trim() || settings?.site_title?.trim() || "החנות";

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void confirm({ data: { token } })
      .then((result) => {
        setCouponSent(result.coupon === "sent" || result.coupon === "already_sent");
        setState(result.confirmed ? "done" : "missing");
      })
      .catch(() => setState("error"));
  }, [token, confirm]);

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
        <Card
          className="mx-auto max-w-xl"
          data-testid="marketing-confirm-result"
          data-state={state}
        >
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            {state === "working" ? (
              <>
                <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden="true" />
                <p role="status">מאשרים את ההצטרפות…</p>
              </>
            ) : state === "done" ? (
              <>
                <CircleCheck className="size-10 text-emerald-600" aria-hidden="true" />
                <h1 className="text-xl font-bold">ההצטרפות לדיוור אושרה</h1>
                <p role="status" className="text-sm text-muted-foreground">
                  מעכשיו תקבלו מ{storeName} עדכונים והטבות במייל.
                  {couponSent ? " הקופון שביקשתם בדרך אליכם במייל." : ""} אפשר להסיר את עצמכם בכל עת
                  בקישור שבתחתית כל מייל.
                </p>
                <Button asChild>
                  <Link to="/">לחנות</Link>
                </Button>
              </>
            ) : (
              <>
                <MailX className="size-10 text-muted-foreground" aria-hidden="true" />
                <h1 className="text-xl font-bold">
                  {state === "missing" ? "הקישור לא בתוקף" : "האישור לא הצליח"}
                </h1>
                <p role="alert" className="text-sm text-muted-foreground">
                  {state === "missing"
                    ? "ייתכן שהקישור כבר שומש, שעברו יותר מ-7 ימים, או שהוא שייך לחנות אחרת. אפשר לבקש קישור חדש מהאתר."
                    : "נסו שוב בעוד רגע."}
                </p>
                <Button asChild variant="outline">
                  <Link to="/">לחנות</Link>
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
