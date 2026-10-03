import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useRouteContext, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { cleanAscii, supabase } from "@/integrations/supabase/client";
import { redeemStoreAdminHandoff } from "@/lib/handoff.functions";
import { PORTAL_STORE_SLUG } from "@/lib/portal";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * כניסה מפאנל הפלטפורמה לניהול החנות ("היכנס לניהול" — God Mode), או
 * משער הפלטפורמה לחנות של בעליה (#...&from=portal — חלק 12).
 * הכתובת מגיעה עם קוד חד-פעמי ב-fragment (#code=...): הקוד יוצא מהכתובת
 * מיד, נפדה בשרת תמורת חיבור רגיל באתר הזה, ומשם ישר לפאנל הניהול.
 */
export const Route = createFileRoute("/admin-handoff")({
  ssr: false,
  head: () => ({
    meta: [{ title: "כניסה לניהול החנות" }, { name: "robots", content: "noindex, nofollow" }],
  }),
  component: AdminHandoffPage,
});

function AdminHandoffPage() {
  const redeem = useServerFn(redeemStoreAdminHandoff);
  const router = useRouter();
  const { hostMode } = useRouteContext({ from: "__root__" });
  const [error, setError] = useState<string | null>(null);
  // הגיעו משער הפלטפורמה (בעלי החנות) או מפאנל הפלטפורמה (מנהל-על)?
  // (נקרא כבר ברינדור הראשון — לפני שהקוד יוצא מהכתובת — שלא יהבהב הטקסט של מנהל-על)
  const [fromPortal] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.hash.slice(1)).get("from") === "portal",
  );
  // הקוד חד-פעמי: לא לנסות פעמיים (StrictMode מריץ effect פעמיים בפיתוח)
  const started = useRef(false);
  const portalUrl = hostMode.baseDomain
    ? `https://${PORTAL_STORE_SLUG}.${hostMode.baseDomain}`
    : null;

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const params = new URLSearchParams(window.location.hash.slice(1));
    const code = params.get("code") ?? "";
    const portal = params.get("from") === "portal";
    // הקוד יוצא מהכתובת מיד — לא נשאר בהיסטוריה ולא בשורת הכתובת
    window.history.replaceState(null, "", window.location.pathname);
    if (!code) {
      setError(
        portal
          ? "קישור הכניסה חסר. חזרו לשער הפלטפורמה ובחרו שוב את החנות."
          : 'קישור הכניסה חסר. חזרו לפאנל הפלטפורמה ולחצו על "היכנס לניהול".',
      );
      return;
    }

    void (async () => {
      try {
        // חיבור קודם באתר הזה (למשל חשבון בדיקה) — מסתיים לפני הכניסה לניהול
        await supabase.auth.signOut({ scope: "local" });
        const { accessToken, refreshToken } = await redeem({ data: { code } });
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: cleanAscii(accessToken, "access_token") ?? "",
          refresh_token: cleanAscii(refreshToken, "refresh_token") ?? "",
        });
        if (sessionError) throw sessionError;
        await router.navigate({ to: "/admin", replace: true });
      } catch (thrown) {
        setError(thrown instanceof Error ? thrown.message : "הכניסה לניהול החנות נכשלה");
      }
    })();
  }, [redeem, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md shadow-soft">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          {error ? (
            <>
              <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <ShieldAlert className="size-6" aria-hidden="true" />
              </span>
              <div className="space-y-1">
                <h1 className="text-lg font-bold text-foreground">הכניסה לניהול לא הצליחה</h1>
                <p className="text-sm leading-6 text-muted-foreground">{error}</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {fromPortal && portalUrl ? (
                  <Button asChild>
                    <a href={portalUrl}>חזרה לשער הפלטפורמה</a>
                  </Button>
                ) : (
                  hostMode.platformUrl && (
                    <Button asChild>
                      <a href={hostMode.platformUrl}>חזרה לפאנל הפלטפורמה</a>
                    </Button>
                  )
                )}
                <Button asChild variant="outline">
                  <Link to="/login">התחברות רגילה</Link>
                </Button>
              </div>
            </>
          ) : (
            <>
              <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <ShieldCheck className="size-6" aria-hidden="true" />
              </span>
              <div className="space-y-1">
                <h1 className="text-lg font-bold text-foreground">
                  {fromPortal ? "נכנסים לניהול החנות שלכם…" : "נכנסים לניהול החנות…"}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {fromPortal
                    ? "מחברים אתכם לפאנל הניהול — רק עוד רגע"
                    : "מנהל-על — הרשאות מלאות לחנות הזו"}
                </p>
              </div>
              <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
