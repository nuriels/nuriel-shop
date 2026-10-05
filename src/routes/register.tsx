import { useEffect, useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppFooter } from "@/components/AppFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { useServerFn } from "@tanstack/react-start";
import { useSubscription } from "@/hooks/useSubscription";
import { registerCustomer } from "@/lib/admin.functions";
import { checkCustomerInvite } from "@/lib/invite.functions";
import { GoogleSignInButton, OrDivider } from "@/components/GoogleSignInButton";
import { Mail } from "lucide-react";

type InviteState =
  | { status: "none" }
  | { status: "checking" }
  | { status: "valid"; email: string | null }
  | { status: "invalid"; reason: string };

export const Route = createFileRoute("/register")({
  ssr: false,
  // ?invite=... — קישור הזמנה ממנהל/סוכן
  validateSearch: (search: Record<string, unknown>): { invite?: string } =>
    typeof search["invite"] === "string" ? { invite: search["invite"] } : {},
  head: () => ({ meta: [{ title: "הרשמה כלקוח עסקי" }] }),
  component: RegisterPage,
});

function RegisterPage() {
  const googleLogin = useSubscription().can("googleLogin");
  const router = useRouter();
  const { settings } = useSiteSettings();
  // חלק 22: "ממתין לאישור" — רק בחנות B2B (דרגי מחיר פעילים); בחנות רגילה זה מרתיע
  const b2b = settings?.price_tiers_enabled === true;
  const register = useServerFn(registerCustomer);
  const checkInvite = useServerFn(checkCustomerInvite);
  const { invite: inviteToken } = Route.useSearch();
  const [invite, setInvite] = useState<InviteState>(
    inviteToken ? { status: "checking" } : { status: "none" },
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [taxId, setTaxId] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);

  const sellsAlcohol = settings?.sells_alcohol ?? true;

  useEffect(() => {
    if (!inviteToken) return;
    let cancelled = false;
    void checkInvite({ data: { token: inviteToken } })
      .then((result) => {
        if (cancelled) return;
        if (result.valid) {
          setInvite({ status: "valid", email: result.email });
          if (result.email) setEmail(result.email);
        } else {
          setInvite({ status: "invalid", reason: result.reason ?? "קישור ההזמנה לא תקין." });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setInvite({
            status: "invalid",
            reason: error instanceof Error ? error.message : "קישור ההזמנה לא תקין.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteToken]);

  const invitedEmail = invite.status === "valid" ? invite.email : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreed) {
      toast.error("יש לאשר את תנאי השימוש כדי להירשם");
      return;
    }
    setBusy(true);
    try {
      // ההרשמה מתבצעת בשרת: החשבון נוצר מאומת (אפשר להתחבר מיד), אימייל
      // כפול נחסם לפני היצירה, וטופס ההצטרפות נשלח אוטומטית.
      const result = await register({
        data: {
          email,
          password,
          businessName,
          businessAddress,
          taxId,
          contactName,
          phone,
          ...(invite.status === "valid" && inviteToken ? { inviteToken } : {}),
        },
      });

      // התחברות אוטומטית מיד אחרי ההרשמה, כדי שהלקוח לא יצטרך להקליד שוב
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInError) {
        toast.success("נרשמת בהצלחה! שלחנו למייל טופס הצטרפות לחתימה. אפשר להתחבר עכשיו.");
        router.navigate({ to: "/login" });
        return;
      }

      toast.success(
        result.approved || !b2b
          ? "החשבון נפתח ופעיל! שלחנו למייל טופס הצטרפות לחתימה."
          : "נרשמת בהצלחה! שלחנו למייל טופס הצטרפות לחתימה, והחשבון ממתין לאישור מנהל.",
      );
      router.navigate({ to: "/" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "ההרשמה נכשלה");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader role={null} email={null} />
      <div className="flex w-full flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-xl">
          <Card className="border-border shadow-soft">
            <CardContent className="pt-6">
              <h1 className="mb-1 text-xl font-bold text-foreground">הרשמה כלקוח עסקי</h1>
              <p className="mb-6 text-sm text-muted-foreground">
                כבר רשומים?{" "}
                <Link to="/login" className="font-medium text-primary hover:underline">
                  התחברות
                </Link>
              </p>
              {/* הרשמה עם Google — בחבילת פרימיום / ניסיון (חלק 13) */}
              {googleLogin && <GoogleSignInButton label="הרשמה עם Google" />}
              {/* הרשמה מהירה בלי סיסמה: קוד חד-פעמי למייל, ואז השלמת פרטי העסק */}
              <Button variant="outline" className="mt-2 w-full" asChild>
                <Link to="/login" search={{ mode: "code" }}>
                  <Mail className="size-4" />
                  הרשמה מהירה עם קוד למייל
                </Link>
              </Button>
              <p className="mt-2 text-center text-xs text-muted-foreground">
                {b2b
                  ? "אחרי הכניסה ממלאים את פרטי העסק, והחשבון ממתין לאישור שלנו"
                  : "כניסה בלי סיסמה — קוד חד-פעמי נשלח למייל"}
              </p>
              <OrDivider />
              {invite.status === "checking" && (
                <p className="mb-4 rounded-md bg-secondary p-3 text-sm text-muted-foreground">
                  בודקים את קישור ההזמנה...
                </p>
              )}
              {invite.status === "valid" && (
                <div className="mb-5 rounded-md border-s-4 border-accent bg-secondary p-3 text-sm">
                  <p className="font-semibold text-foreground">קיבלתם הזמנה לפתוח חשבון</p>
                  <p className="text-muted-foreground">
                    ממלאים את פרטי העסק ובוחרים סיסמה — והחשבון פעיל מיד, בלי לחכות לאישור.
                  </p>
                </div>
              )}
              {invite.status === "invalid" && (
                <div className="mb-5 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <p className="font-semibold text-foreground">{invite.reason}</p>
                  <p className="text-muted-foreground">
                    אפשר להמשיך בהרשמה רגילה — החשבון יחכה לאישור מנהל.
                  </p>
                </div>
              )}
              <form onSubmit={submit} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="business-name">שם העסק *</Label>
                    <Input
                      id="business-name"
                      required
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tax-id">ח.פ / עוסק מורשה *</Label>
                    <Input
                      id="tax-id"
                      dir="ltr"
                      required
                      value={taxId}
                      onChange={(e) => setTaxId(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="business-address">כתובת העסק *</Label>
                  <Input
                    id="business-address"
                    required
                    value={businessAddress}
                    onChange={(e) => setBusinessAddress(e.target.value)}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="contact-name">שם איש קשר *</Label>
                    <Input
                      id="contact-name"
                      required
                      value={contactName}
                      onChange={(e) => setContactName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">טלפון *</Label>
                    <Input
                      id="phone"
                      type="tel"
                      dir="ltr"
                      required
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="email">כתובת אימייל *</Label>
                    <Input
                      id="email"
                      type="email"
                      dir="ltr"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      readOnly={invitedEmail !== null}
                      className={invitedEmail !== null ? "bg-secondary" : undefined}
                      placeholder="name@example.com"
                    />
                    {invitedEmail !== null && (
                      <p className="text-xs text-muted-foreground">ההזמנה נשלחה לכתובת הזו.</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">סיסמה *</Label>
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
                </div>

                <label className="flex items-start gap-2 text-sm text-foreground">
                  <Checkbox
                    checked={agreed}
                    onCheckedChange={(v) => setAgreed(v === true)}
                    className="mt-0.5"
                    required
                  />
                  <span>
                    {sellsAlcohol && "אני מאשר/ת שגילי 18 ומעלה, ו"}
                    קראתי ואני מסכים/ה ל
                    <Link to="/terms" className="text-primary hover:underline">
                      תנאי השימוש
                    </Link>{" "}
                    ול
                    <Link to="/privacy" className="text-primary hover:underline">
                      מדיניות הפרטיות
                    </Link>
                    .
                  </span>
                </label>

                <Button type="submit" className="w-full" size="lg" disabled={busy}>
                  {busy ? "נרשם..." : "צור חשבון"}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  {invite.status === "valid"
                    ? "החשבון ייפתח פעיל מיד, ואפשר יהיה להתחיל להזמין."
                    : 'החשבון ייבדק ויאושר ע"י מנהל המערכת, ולאחר מכן ישויך אליך סוכן/ת מטפל/ת.'}
                </p>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
      <AppFooter />
    </div>
  );
}
