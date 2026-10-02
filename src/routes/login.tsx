import { useEffect, useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { cleanAscii, supabase } from "@/integrations/supabase/client";
import { loginWithIdentifier } from "@/lib/auth.functions";
import { AppFooter } from "@/components/AppFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { ForgotPasswordDialog } from "@/components/ForgotPasswordDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { GOOGLE_RETURN_FLAG, GoogleSignInButton, OrDivider } from "@/components/GoogleSignInButton";

export const Route = createFileRoute("/login")({
  ssr: false,
  head: () => ({ meta: [{ title: "התחברות" }] }),
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const login = useServerFn(loginWithIdentifier);
  const [googleReturning, setGoogleReturning] = useState(false);

  // חזרה מ-Google: הדפדפן כבר קרא את הפרטים מהכתובת; בודקים שיש חיבור וממשיכים
  // לעמוד הראשי (שם: השלמת פרטים / ממתין לאישור / חסימה — כמו בהתחברות רגילה)
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const error = search.get("error") ?? hash.get("error");
    const fromGoogle = search.get(GOOGLE_RETURN_FLAG) === "1";
    if (!fromGoogle && !error) return;
    const clean = () => window.history.replaceState(window.history.state, "", "/login");
    if (error) {
      console.error(
        "[google-login] returned with error",
        error,
        search.get("error_description") ?? hash.get("error_description"),
      );
      clean();
      toast.error(
        error === "access_denied"
          ? "ההתחברות עם Google בוטלה."
          : "לא הצלחנו להשלים את ההתחברות עם Google. אם כבר יש לכם חשבון עם המייל הזה — התחברו עם אימייל וסיסמה.",
        { duration: 10000 },
      );
      return;
    }
    setGoogleReturning(true);
    void supabase.auth.getSession().then(({ data }) => {
      clean();
      if (!data.session) {
        setGoogleReturning(false);
        toast.error("ההתחברות עם Google לא הושלמה. נסו שוב.");
        return;
      }
      toast.success("התחברת בהצלחה");
      void router.navigate({ to: "/" });
    });
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      // ההתחברות מתבצעת בשרת: תרגום שם משתמש לאימייל, הודעת כישלון
      // אחידה שלא חושפת אם החשבון קיים, והגבלת קצב ניסיונות.
      const { accessToken, refreshToken } = await login({
        data: { identifier: identifier.trim().toLowerCase(), password },
      });

      const { error } = await supabase.auth.setSession({
        access_token: cleanAscii(accessToken, "access_token") ?? "",
        refresh_token: cleanAscii(refreshToken, "refresh_token") ?? "",
      });
      if (error) throw error;

      toast.success("התחברת בהצלחה");
      router.navigate({ to: "/" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שגיאה בהתחברות");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader role={null} email={null} />
      <div className="flex w-full flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <Card className="border-border shadow-soft">
            <CardContent className="pt-6">
              <h1 className="mb-1 text-xl font-bold text-foreground">התחברות לקוחות עסקיים</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                אין לך חשבון עדיין?{" "}
                <Link to="/register" className="font-medium text-primary hover:underline">
                  הרשמה כלקוח חדש
                </Link>
              </p>
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="identifier">אימייל או שם משתמש</Label>
                  <Input
                    id="identifier"
                    dir="ltr"
                    required
                    autoComplete="username"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    placeholder="name@example.com או שם משתמש"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">סיסמה</Label>
                  <Input
                    id="password"
                    type="password"
                    dir="ltr"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  size="lg"
                  disabled={busy || googleReturning}
                >
                  {busy ? "רגע..." : googleReturning ? "מתחבר עם Google..." : "התחבר"}
                </Button>
              </form>
              <OrDivider />
              <GoogleSignInButton />
              <button
                type="button"
                onClick={() => setForgotOpen(true)}
                className="mt-4 block w-full py-2 text-center text-sm font-medium text-primary hover:underline"
              >
                שכחת סיסמה?
              </button>
            </CardContent>
          </Card>
        </div>
      </div>
      <ForgotPasswordDialog open={forgotOpen} onOpenChange={setForgotOpen} />
      <AppFooter />
    </div>
  );
}
