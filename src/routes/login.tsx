import { useEffect, useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, Mail } from "lucide-react";
import { cleanAscii, supabase } from "@/integrations/supabase/client";
import { loginWithIdentifier } from "@/lib/auth.functions";
import { AppFooter } from "@/components/AppFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { ForgotPasswordDialog } from "@/components/ForgotPasswordDialog";
import { EmailCodeLogin, type CodeLoginTokens } from "@/components/EmailCodeLogin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GOOGLE_RETURN_FLAG, GoogleSignInButton, OrDivider } from "@/components/GoogleSignInButton";

type LoginMode = "password" | "code";
type LoginSearch = { mode?: LoginMode; email?: string };

export const Route = createFileRoute("/login")({
  ssr: false,
  // ?mode=code — פתיחה ישירה בלשונית "קוד למייל" (למשל מ"שכחתי סיסמה" או מההרשמה)
  validateSearch: (search: Record<string, unknown>): LoginSearch => {
    const result: LoginSearch = {};
    if (search["mode"] === "code" || search["mode"] === "password") result.mode = search["mode"];
    if (typeof search["email"] === "string" && search["email"].length <= 254) {
      result.email = search["email"];
    }
    return result;
  },
  head: () => ({ meta: [{ title: "התחברות" }] }),
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const search = Route.useSearch();
  const [mode, setMode] = useState<LoginMode>(search.mode ?? "password");
  const [codeEmail, setCodeEmail] = useState(search.email ?? "");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const login = useServerFn(loginWithIdentifier);
  const [googleReturning, setGoogleReturning] = useState(false);

  // חזרה מ-Google: הדפדפן כבר קרא את הפרטים מהכתובת; בודקים שיש חיבור וממשיכים
  // לעמוד הראשי (שם: השלמת פרטים / ממתין לאישור / חסימה — כמו בהתחברות רגילה)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const error = params.get("error") ?? hash.get("error");
    const fromGoogle = params.get(GOOGLE_RETURN_FLAG) === "1";
    if (!fromGoogle && !error) return;
    const clean = () => window.history.replaceState(window.history.state, "", "/login");
    if (error) {
      console.error(
        "[google-login] returned with error",
        error,
        params.get("error_description") ?? hash.get("error_description"),
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

  /** החיבור שהשרת פתח (סיסמה או קוד) נשמר בדפדפן */
  const applySession = async (accessToken: string, refreshToken: string) => {
    const { error } = await supabase.auth.setSession({
      access_token: cleanAscii(accessToken, "access_token") ?? "",
      refresh_token: cleanAscii(refreshToken, "refresh_token") ?? "",
    });
    if (error) throw error;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      // ההתחברות מתבצעת בשרת: תרגום שם משתמש לאימייל, הודעת כישלון
      // אחידה שלא חושפת אם החשבון קיים, והגבלת קצב ניסיונות.
      const { accessToken, refreshToken } = await login({
        data: { identifier: identifier.trim().toLowerCase(), password },
      });
      await applySession(accessToken, refreshToken);
      toast.success("התחברת בהצלחה");
      router.navigate({ to: "/" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שגיאה בהתחברות");
    } finally {
      setBusy(false);
    }
  };

  const onCodeLogin = async ({ accessToken, refreshToken, isNew }: CodeLoginTokens) => {
    await applySession(accessToken, refreshToken);
    toast.success(isNew ? "החשבון נפתח! נשלים כמה פרטים על העסק" : "התחברת בהצלחה");
    await router.navigate({ to: "/" });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader role={null} email={null} />
      <div className="flex w-full flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <Card className="border-border shadow-soft">
            <CardContent className="pt-6">
              <h1 className="mb-1 text-xl font-bold text-foreground">התחברות לקוחות עסקיים</h1>
              <p className="mb-5 text-sm text-muted-foreground">
                אין לך חשבון עדיין?{" "}
                <Link to="/register" className="font-medium text-primary hover:underline">
                  הרשמה כלקוח חדש
                </Link>{" "}
                או כניסה עם קוד למייל.
              </p>

              <Tabs value={mode} onValueChange={(value) => setMode(value as LoginMode)} dir="rtl">
                <TabsList className="mb-5 grid w-full grid-cols-2">
                  <TabsTrigger value="password" className="gap-1.5">
                    <KeyRound className="size-4" aria-hidden="true" />
                    סיסמה
                  </TabsTrigger>
                  <TabsTrigger value="code" className="gap-1.5">
                    <Mail className="size-4" aria-hidden="true" />
                    קוד למייל
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="password" className="mt-0">
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
                        autoComplete="current-password"
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
                  <button
                    type="button"
                    onClick={() => setForgotOpen(true)}
                    className="mt-3 block w-full py-2 text-center text-sm font-medium text-primary hover:underline"
                  >
                    שכחת סיסמה?
                  </button>
                </TabsContent>

                <TabsContent value="code" className="mt-0">
                  <EmailCodeLogin
                    initialEmail={codeEmail}
                    disabled={googleReturning}
                    onSuccess={onCodeLogin}
                  />
                </TabsContent>
              </Tabs>

              <OrDivider />
              <GoogleSignInButton />
            </CardContent>
          </Card>
        </div>
      </div>
      <ForgotPasswordDialog
        open={forgotOpen}
        onOpenChange={setForgotOpen}
        onUseCode={(email) => {
          setForgotOpen(false);
          if (email) setCodeEmail(email);
          setMode("code");
        }}
      />
      <AppFooter />
    </div>
  );
}
