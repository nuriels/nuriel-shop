import { useEffect, useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { AppFooter } from "@/components/AppFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { completePasswordReset, verifyPasswordResetToken } from "@/lib/password.functions";

type Search = { token?: string | undefined };

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({ meta: [{ title: "קביעת סיסמה חדשה" }] }),
  validateSearch: (search: Record<string, unknown>): Search =>
    typeof search["token"] === "string" ? { token: search["token"] } : {},
  component: ResetPasswordPage,
});

/**
 * קביעת סיסמה חדשה דרך קישור חד-פעמי מהמייל.
 * שם המשתמש מוצג לקריאה בלבד (אפור, לא ניתן לשינוי), ומתחתיו שדות סיסמה
 * חדשה ואימות עם כפתור הצגה/הסתרה.
 */
function ResetPasswordPage() {
  const { token } = Route.useSearch();
  const router = useRouter();
  const verifyToken = useServerFn(verifyPasswordResetToken);
  const completeReset = useServerFn(completePasswordReset);

  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState<string | null>(null);
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [invalidReason, setInvalidReason] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setInvalidReason("הקישור חסר או אינו תקין. יש לבקש קישור חדש מדף ההתחברות.");
      setChecking(false);
      return;
    }
    void (async () => {
      try {
        const result = await verifyToken({ data: { token } });
        setUsername(result.username);
        setMaskedEmail(result.maskedEmail);
      } catch (error) {
        setInvalidReason(error instanceof Error ? error.message : "הקישור אינו תקין");
      } finally {
        setChecking(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== confirmation) {
      toast.error("הסיסמאות אינן זהות");
      return;
    }
    if (password.length < 8) {
      toast.error("הסיסמה חייבת להכיל לפחות 8 תווים");
      return;
    }
    setBusy(true);
    try {
      await completeReset({ data: { token: token ?? "", password } });
      setDone(true);
      toast.success("הסיסמה שונתה. נשלח אליך מייל אישור.");
      setTimeout(() => router.navigate({ to: "/login" }), 2500);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "שינוי הסיסמה נכשל");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader role={null} email={null} />
      <div className="flex w-full flex-1 items-center justify-center px-4 py-12">
        <Card className="w-full max-w-md shadow-soft">
          <CardContent className="space-y-5 pt-6">
            <div className="space-y-1">
              <h1 className="font-display text-xl text-foreground">קביעת סיסמה חדשה</h1>
              <p className="text-sm text-muted-foreground">
                {maskedEmail
                  ? `הקישור נשלח אל ${maskedEmail}`
                  : "הקישור תקף לשלוש שעות ולשימוש חד-פעמי"}
              </p>
            </div>

            {checking ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                בודק את הקישור...
              </p>
            ) : invalidReason ? (
              <div className="space-y-4">
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-foreground">
                  {invalidReason}
                </p>
                <Button asChild className="w-full" size="lg">
                  <Link to="/login">חזרה לדף ההתחברות</Link>
                </Button>
              </div>
            ) : done ? (
              <div className="space-y-4">
                <p className="flex items-center gap-2 rounded-lg border border-border bg-secondary p-3 text-sm">
                  <ShieldCheck className="size-4 text-accent" />
                  הסיסמה שונתה בהצלחה. מעבירים אותך לדף ההתחברות.
                </p>
                <Button asChild className="w-full" size="lg">
                  <Link to="/login">התחברות עכשיו</Link>
                </Button>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="reset-username">שם המשתמש</Label>
                  <Input
                    id="reset-username"
                    dir="ltr"
                    value={username ?? ""}
                    readOnly
                    disabled
                    aria-readonly="true"
                    className="bg-muted text-muted-foreground"
                  />
                  <p className="text-xs text-muted-foreground">
                    שם המשתמש מקושר לקישור ואינו ניתן לשינוי כאן.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reset-password">סיסמה חדשה</Label>
                  <div className="relative">
                    <Input
                      id="reset-password"
                      dir="ltr"
                      type={visible ? "text" : "password"}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10"
                    />
                    <button
                      type="button"
                      onClick={() => setVisible((current) => !current)}
                      aria-label={visible ? "הסתרת הסיסמה" : "הצגת הסיסמה"}
                      className="absolute left-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">לפחות 8 תווים.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reset-confirm">אימות סיסמה</Label>
                  <Input
                    id="reset-confirm"
                    dir="ltr"
                    type={visible ? "text" : "password"}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                  {confirmation !== "" && confirmation !== password && (
                    <p className="text-xs text-destructive">הסיסמאות אינן זהות</p>
                  )}
                </div>

                <Button type="submit" size="lg" className="w-full" disabled={busy}>
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  {busy ? "שומר..." : "שמירת הסיסמה"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
      <AppFooter />
    </div>
  );
}
