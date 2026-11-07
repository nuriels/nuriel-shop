// כניסה לאזור הניהול: קוד במייל או סיסמה — אותן פונקציות קיימות של הפלטפורמה.
// שלב א' 3: Google — רק דרך השער של Nuriel (הכניסה המרכזית): ה-OAuth חוזר לכתובת של Nuriel ולא לכתובת
// של האתר (docs/security/oauth-pkce-analysis.md), ומשם קוד חד-פעמי חזרה לכאן. בעמוד הזה לא מתחיל OAuth.
// "שכחתי סיסמה" — קוד חד-פעמי למייל וסיסמה חדשה, באותו חשבון.
// אחרי הכניסה, ההרשאה נבדקת במסד; חשבון בלי הרשאה רואה "אין גישה".
// שלב F4: מסך מותג (צד כהה במחשב, כותרת קטנה בטלפון) — אותם שדות, לשוניות וטקסטים.
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { applyServerSession } from "@/platform/auth/browser-session";
import { loginWithIdentifier, requestLoginCode, verifyLoginCode } from "@/platform/auth/login";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/platform/ui";
import {
  hospitalityCentralLogin,
  hospitalityManagementContext,
  hospitalityResetPassword,
} from "../../api/management.functions";
import { PASSWORD_MIN, passwordProblem } from "../../validation/manage-login";
import { manageKeys } from "../lib/query-keys";

const errorText = (error: unknown) =>
  error instanceof Error && error.message ? error.message : "הכניסה נכשלה. נסו שוב.";

export function ManageLogin() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const enter = async (tokens: { accessToken: string; refreshToken: string }) => {
    await applyServerSession(tokens.accessToken, tokens.refreshToken);
    // A3: התשובה "לא מחובר" מהביקור הקודם ב-/manage נשארת במטמון (invalidate לא מוחק אותה), והמעטפת
    // הציגה אותה מיד והחזירה לכאן — "נכנסתם" ונשארים במסך הכניסה. לכן: מוחקים את המטמון של אזור
    // הניהול, בודקים בשרת עם החיבור החדש, ורק אז עוברים.
    queryClient.removeQueries({ queryKey: manageKeys.all });
    const access = await queryClient.fetchQuery({
      queryKey: manageKeys.context,
      queryFn: () => hospitalityManagementContext(),
      staleTime: 0,
    });
    if (access.state === "signed_out") {
      // הקוד / הסיסמה אומתו, אבל השרת לא מזהה את החיבור — לא עוברים (אחרת לולאה) ומסבירים
      throw new Error(
        "הפרטים אומתו, אבל החיבור לא נשמר בדפדפן. רעננו את הדף ונסו שוב. אם זה חוזר — נסו דפדפן אחר או אפשרו שמירת נתוני אתרים.",
      );
    }
    toast.success("נכנסתם לניהול העסק");
    await navigate({ to: "/manage", replace: true });
  };

  return (
    <main
      id="main-content"
      className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]"
    >
      {/* שלב F4: צד המותג (מחשב) — "Deep Lagoon & Champagne" */}
      <div className="relative hidden overflow-hidden bg-[var(--hm-lagoon-900)] text-[var(--hm-sidebar-text)] lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -start-40 -top-40 size-[34rem] rounded-full bg-[radial-gradient(closest-side,rgb(216_184_122/0.22),transparent)]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-48 -end-32 size-[30rem] rounded-full bg-[radial-gradient(closest-side,rgb(31_111_107/0.45),transparent)]"
        />
        <p className="relative flex items-center gap-3">
          <span
            aria-hidden="true"
            className="inline-flex size-10 items-center justify-center rounded-xl bg-[var(--hm-champagne-500)] font-display text-xl font-bold text-[var(--hm-lagoon-900)]"
          >
            N
          </span>
          <span className="leading-tight">
            <span className="block font-bold text-white" dir="ltr">
              Nuriel Hospitality
            </span>
            <span className="block text-sm text-[var(--hm-sidebar-muted)]">מבית נוריאל מחשבים</span>
          </span>
        </p>
        <div className="relative max-w-md">
          <p className="font-display text-[2.6rem] leading-tight text-white">
            כל מקום האירוח שלכם — במקום אחד.
          </p>
          <ul className="mt-8 flex flex-col gap-3 text-[15px]">
            {[
              "הזמנות, יומן ותפוסה — כולל Airbnb ו-Booking",
              "אתר הזמנות משלכם, בעברית ובנגישות מלאה",
              "תמונה ברורה של העסק בכל בוקר",
            ].map((line) => (
              <li key={line} className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full bg-[var(--hm-champagne-500)]"
                />
                {line}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-[var(--hm-sidebar-muted)]">
          החיבור מאובטח. אחרי הכניסה ההרשאות נבדקות בשרת.
        </p>
      </div>

      <div className="flex items-start justify-center px-4 py-10 md:items-center">
        <div className="w-full max-w-md">
          <p className="mb-6 flex items-center justify-center gap-2.5 lg:hidden">
            <span
              aria-hidden="true"
              className="inline-flex size-9 items-center justify-center rounded-xl bg-[var(--hm-lagoon-900)] font-display text-lg font-bold text-[var(--hm-champagne-500)]"
            >
              N
            </span>
            <span className="font-bold text-[var(--hm-lagoon-900)]" dir="ltr">
              Nuriel Hospitality
            </span>
          </p>
          <Card className="w-full rounded-2xl shadow-[var(--hm-shadow-lift)]">
            <CardHeader>
              <CardTitle>
                <h1 className="text-[1.6rem] font-bold text-[var(--hm-lagoon-900)]">
                  כניסה לניהול העסק
                </h1>
              </CardTitle>
              <CardDescription>לבעלי העסק ולמנהלים שקיבלו הרשאה.</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="code" dir="rtl">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="code" className="min-h-10">
                    קוד למייל
                  </TabsTrigger>
                  <TabsTrigger value="password" className="min-h-10">
                    סיסמה
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="code" className="pt-4">
                  <CodeLogin onTokens={enter} />
                </TabsContent>
                <TabsContent value="password" className="pt-4">
                  <PasswordLogin onTokens={enter} />
                </TabsContent>
              </Tabs>
              <GoogleViaPortal />
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}

type Tokens = { accessToken: string; refreshToken: string };

function CodeLogin({ onTokens }: { onTokens: (t: Tokens) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await requestLoginCode({ data: { email } });
      setSentTo(result.maskedEmail);
      setCode("");
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onTokens(await verifyLoginCode({ data: { email, code } }));
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  if (!sentTo) {
    return (
      <form onSubmit={send} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="manage-email">אימייל</Label>
          <Input
            id="manage-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            dir="ltr"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="min-h-11 text-start"
          />
        </div>
        <Button type="submit" disabled={busy || email.trim() === ""} className="min-h-11">
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          שליחת קוד
        </Button>
      </form>
    );
  }
  return (
    <form onSubmit={verify} className="flex flex-col gap-4" noValidate>
      <p className="text-sm" role="status">
        שלחנו קוד בן 6 ספרות אל <span dir="ltr">{sentTo}</span>.
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="manage-code">הקוד מהמייל</Label>
        <Input
          id="manage-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          dir="ltr"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          className="min-h-11 text-center text-lg tracking-[0.4em]"
        />
      </div>
      <Button type="submit" disabled={busy || code.length !== 6} className="min-h-11">
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        כניסה
      </Button>
      <Button type="button" variant="ghost" className="min-h-11" onClick={() => setSentTo(null)}>
        שינוי כתובת או שליחה מחדש
      </Button>
    </form>
  );
}

function PasswordLogin({ onTokens }: { onTokens: (t: Tokens) => Promise<void> }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  if (resetting) return <PasswordReset onTokens={onTokens} onBack={() => setResetting(false)} />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onTokens(await loginWithIdentifier({ data: { identifier, password } }));
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="manage-identifier">אימייל או שם משתמש</Label>
        <Input
          id="manage-identifier"
          autoComplete="username"
          dir="ltr"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          className="min-h-11 text-start"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="manage-password">סיסמה</Label>
        <Input
          id="manage-password"
          type="password"
          autoComplete="current-password"
          dir="ltr"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="min-h-11 text-start"
        />
      </div>
      <Button
        type="submit"
        disabled={busy || identifier.trim() === "" || password === ""}
        className="min-h-11"
      >
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        כניסה
      </Button>
      <Button
        type="button"
        variant="link"
        className="min-h-11 self-start px-0"
        onClick={() => setResetting(true)}
      >
        שכחתי סיסמה
      </Button>
    </form>
  );
}

/**
 * שלב א' 3: איפוס סיסמה — קוד חד-פעמי למייל (אותו קוד כמו בכניסה בקוד), ואז סיסמה חדשה. השרת בודק את
 * הקוד ואת ההרשאה לניהול באתר הזה באותה בקשה, שומר את הסיסמה ומכניס.
 */
function PasswordReset({
  onTokens,
  onBack,
}: {
  onTokens: (t: Tokens) => Promise<void>;
  onBack: () => void;
}) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const problem = password ? passwordProblem(password) : null;
  const mismatch = again !== "" && again !== password;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await requestLoginCode({ data: { email } });
      setSentTo(result.maskedEmail);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const tokens = await hospitalityResetPassword({ data: { email, code, password } });
      toast.success("הסיסמה החדשה נשמרה");
      await onTokens(tokens);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  if (!sentTo) {
    return (
      <form onSubmit={send} className="flex flex-col gap-4" noValidate>
        <p className="text-sm text-muted-foreground">
          נשלח קוד חד-פעמי לאימייל של החשבון, ואז תבחרו סיסמה חדשה.
        </p>
        <div className="flex flex-col gap-2">
          <Label htmlFor="reset-email">אימייל</Label>
          <Input
            id="reset-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            dir="ltr"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="min-h-11 text-start"
          />
        </div>
        <Button type="submit" disabled={busy || email.trim() === ""} className="min-h-11">
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          שליחת קוד לאיפוס
        </Button>
        <Button type="button" variant="ghost" className="min-h-11" onClick={onBack}>
          חזרה לכניסה עם סיסמה
        </Button>
      </form>
    );
  }
  return (
    <form onSubmit={save} className="flex flex-col gap-4" noValidate>
      <p className="text-sm" role="status">
        שלחנו קוד בן 6 ספרות אל <span dir="ltr">{sentTo}</span>.
      </p>
      <div className="flex flex-col gap-2">
        <Label htmlFor="reset-code">הקוד מהמייל</Label>
        <Input
          id="reset-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          dir="ltr"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          className="min-h-11 text-center text-lg tracking-[0.4em]"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="reset-password">סיסמה חדשה</Label>
        <Input
          id="reset-password"
          type="password"
          autoComplete="new-password"
          dir="ltr"
          value={password}
          aria-describedby="reset-password-hint"
          aria-invalid={problem ? true : undefined}
          onChange={(e) => setPassword(e.target.value)}
          className="min-h-11 text-start"
        />
        <p id="reset-password-hint" className="text-xs text-muted-foreground">
          {problem ?? `לפחות ${PASSWORD_MIN} תווים.`}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="reset-again">שוב, לאימות</Label>
        <Input
          id="reset-again"
          type="password"
          autoComplete="new-password"
          dir="ltr"
          value={again}
          aria-invalid={mismatch ? true : undefined}
          onChange={(e) => setAgain(e.target.value)}
          className="min-h-11 text-start"
        />
        {mismatch && (
          <p role="alert" className="text-xs text-destructive">
            הסיסמאות לא זהות
          </p>
        )}
      </div>
      <Button
        type="submit"
        disabled={busy || code.length !== 6 || !password || !!problem || again !== password}
        className="min-h-11"
      >
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        שמירת הסיסמה וכניסה
      </Button>
      <Button type="button" variant="ghost" className="min-h-11" onClick={() => setSentTo(null)}>
        שינוי כתובת או שליחה מחדש
      </Button>
    </form>
  );
}

/** הלוגו של Google (הצבעים הרשמיים) — דקורטיבי */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.96 10.96 0 0 0 12 1 11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

/**
 * שלב א' 3: Google — דרך השער של Nuriel. שם נכנסים עם Google (או קוד), בוחרים את העסק, וחוזרים לכאן
 * מחוברים לאותו חשבון. בעמוד הזה עצמו לא מתחיל OAuth.
 */
function GoogleViaPortal() {
  const central = useQuery({
    queryKey: ["hospitality", "manage", "central-login"],
    queryFn: () => hospitalityCentralLogin(),
    staleTime: Infinity,
    retry: false,
  });
  const url = central.data?.url;
  if (!url) return null;
  return (
    <div className="mt-5 flex flex-col gap-2 border-t border-border pt-5">
      <a
        href={url}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-muted"
        data-testid="manage-google"
      >
        <GoogleMark />
        כניסה עם Google
      </a>
      <p className="text-center text-xs text-muted-foreground">
        הכניסה עם Google נעשית בכניסה המרכזית של Nuriel (לאבטחת החשבון). אחרי הכניסה בחרו את העסק —
        ותחזרו לכאן מחוברים.
      </p>
    </div>
  );
}
